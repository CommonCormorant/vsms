// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// ui.go: the bubbletea terminal UI.
//
// Layout, top to bottom:
//   - live row: the people in the room, as names. Your own name is left
//     out, like the JS status bar; alone it reads "Just you". Click a
//     name (or Tab to the row, arrows, Enter) and a dropdown opens.
//   - dropdown: the JS status bar's menu, as a bordered box under the
//     row. Picking an item only composes text into the input, the same
//     compose-only rule as the JS version; nothing sends until Enter.
//   - messages: a scrolling viewport.
//   - input: the compose line, always at the bottom.
//   - status: nickname, session, connection state.
//
// Colors are retro-terminal green on black. Mouse reporting is on, so
// the live row and the dropdown work by click as well as by keyboard.
// On a phone the tap targets are small, so keyboard navigation exists
// alongside click for everything.
package main

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/reflow/wordwrap"
)

const (
	focusInput = iota
	focusRow
	focusDropdown
)

// ddItems is the dropdown menu, in the JS status bar's order. The
// separator is shown but is not selectable.
type ddItem struct {
	label      string
	selectable bool
}

var ddItems = []ddItem{
	{"Private/instant message", true},
	{"Mail/message", true},
	{"- Peer-to-peer -", false},
	{"Image", true},
}

// ddHeight is the dropdown's line count: top border, name header, four
// item lines, bottom border. The rendering must produce exactly this
// many lines, or the layout math drifts.
const ddHeight = 7

type nameSpan struct {
	name string
	x0   int // visible column where the name starts (inclusive)
	x1   int // visible column where the name ends (exclusive)
}

type model struct {
	c         *client
	sessionID string
	baseURL   string
	myNick    string
	online    []string // everyone in the room, including self
	lines     []string // rendered message lines
	viewport  viewport.Model
	input     textinput.Model
	width     int
	height    int
	focus     int
	rowSel    int
	ddOpen    bool
	ddName    string
	ddIdx     int
	status    string
	quitting  bool
	errMsg    string
	spans     []nameSpan // name click targets from the last render
	ready     bool
	startTime time.Time // session start, for /uptime
	profile   string    // profile bio, for /profile
}

type wsMsg struct{ cm chatMessage }
type wsErr struct{ err error }
type tickMsg time.Time

var (
	styleMsg  = lipgloss.NewStyle().Foreground(lipgloss.Color("10")) // bright green
	styleOwn  = lipgloss.NewStyle().Foreground(lipgloss.Color("14")) // cyan
	styleSys  = lipgloss.NewStyle().Foreground(lipgloss.Color("11")) // yellow
	styleErr  = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))  // red
	styleName = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	styleSel  = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("14"))
	styleDim  = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	styleBox  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("14"))
)

func newModel(c *client, sessionID, baseURL, nick string, early, history []chatMessage) model {
	ti := textinput.New()
	ti.Prompt = "> "
	ti.Placeholder = "type a message, /help for commands"
	ti.CharLimit = 2000
	ti.Focus()
	ti.PromptStyle = styleMsg
	ti.TextStyle = styleMsg

	vp := viewport.New(80, 20)
	vp.SetContent("")

	m := model{
		c:         c,
		sessionID: sessionID,
		baseURL:   baseURL,
		myNick:    nick,
		viewport:  vp,
		input:     ti,
		focus:     focusInput,
		rowSel:    0,
		status:    "connecting…",
		startTime: time.Now(),
		profile:   loadProfile(),
	}
	m.addLine(styleSys.Render("Real-time connection established."))
	m.addLine(styleSys.Render("You are now known as " + nick + "."))
	// Early messages (WELCOME can arrive before REGISTERED) and the
	// 15-minute history, in order, MAIL| rows filtered like the JS.
	for _, cm := range early {
		m.handleIncoming(cm, true)
	}
	if len(history) > 0 {
		m.addLine(styleSys.Render("--- Start of History ---"))
		for _, cm := range history {
			if strings.HasPrefix(cm.Message, "MAIL|") {
				continue
			}
			m.handleIncoming(cm, true)
		}
		m.addLine(styleSys.Render("--- End of History ---"))
	}
	m.status = "connected"
	return m
}

func (m model) Init() tea.Cmd {
	return tickHeartbeat()
}

func tickHeartbeat() tea.Cmd {
	return tea.Tick(30*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

// layout recomputes the viewport height and input width from the
// window size and whether the dropdown is open.
func (m *model) layout() {
	// Lines taken: live row 1, dropdown ddHeight or 0, input 1, status 1.
	used := 1 + 1 + 1
	if m.ddOpen {
		used += ddHeight
	}
	h := m.height - used
	if h < 1 {
		h = 1
	}
	m.viewport.Height = h
	m.viewport.Width = m.width
	m.input.Width = m.width - len(m.input.Prompt) - 1
	if m.input.Width < 10 {
		m.input.Width = 10
	}
}

// addLine appends a rendered line and keeps the viewport pinned to the
// bottom unless the user has scrolled up to read. Each line is wrapped
// to the viewport width first, so a long message wraps onto the next
// line instead of running off the edge or overwriting the line start
// when the screen fills up.
func (m *model) addLine(s string) {
	atBottom := m.viewport.AtBottom()
	w := m.viewport.Width
	if w < 1 {
		w = 80
	}
	// wordwrap is ANSI-aware, so styled lines keep their colour across
	// the wrap. A line that fits is left untouched.
	for _, ln := range strings.Split(wordwrap.String(s, w), "\n") {
		m.lines = append(m.lines, ln)
	}
	m.viewport.SetContent(strings.Join(m.lines, "\n"))
	if atBottom {
		m.viewport.GotoBottom()
	}
}

func (m *model) sendRaw(s string) {
	if m.c == nil {
		return
	}
	if err := m.c.sendText(s); err != nil {
		m.addLine(styleErr.Render("send failed: " + err.Error()))
	}
}

// others returns the room's people minus self, in server order.
func (m model) others() []string {
	var out []string
	for _, n := range m.online {
		if !strings.EqualFold(n, m.myNick) {
			out = append(out, n)
		}
	}
	return out
}

// renderLiveRow builds the top row and records the click span of every
// name. The row is line 0 of the view, so a mouse click at y=0 maps
// straight onto these spans.
func (m *model) renderLiveRow() string {
	others := m.others()
	var b strings.Builder
	b.WriteString(styleDim.Render("Room: "))
	x := utf8.RuneCountInString("Room: ")
	m.spans = m.spans[:0]
	if len(others) == 0 {
		b.WriteString(styleDim.Render("Just you"))
		return b.String()
	}
	for i, name := range others {
		x0 := x
		w := utf8.RuneCountInString(name)
		x1 := x0 + w
		m.spans = append(m.spans, nameSpan{name: name, x0: x0, x1: x1})
		if m.focus == focusRow && i == m.rowSel {
			b.WriteString(styleSel.Render(name))
		} else {
			b.WriteString(styleName.Render(name))
		}
		x = x1 + 1
		if i < len(others)-1 {
			b.WriteString(" ")
		}
	}
	return b.String()
}

// renderDropdown builds the bordered menu for ddName. It must produce
// exactly ddHeight lines.
func (m model) renderDropdown() string {
	var lines []string
	lines = append(lines, styleOwn.Render(m.ddName))
	for i, it := range ddItems {
		if !it.selectable {
			lines = append(lines, styleDim.Render(it.label))
			continue
		}
		if i == m.ddIdx {
			lines = append(lines, styleSel.Render(it.label))
		} else {
			lines = append(lines, styleName.Render(it.label))
		}
	}
	return styleBox.Render(strings.Join(lines, "\n"))
}

// openDropdown opens the menu for name, selecting the first item.
func (m *model) openDropdown(name string) {
	m.ddName = name
	m.ddIdx = 0
	// Skip a leading separator, if one ever leads.
	for m.ddIdx < len(ddItems) && !ddItems[m.ddIdx].selectable {
		m.ddIdx++
	}
	m.ddOpen = true
	m.focus = focusDropdown
	m.layout()
}

func (m *model) closeDropdown() {
	m.ddOpen = false
	m.focus = focusInput
	m.input.Focus()
	m.layout()
}

// ddMove moves the dropdown selection, skipping the separator.
func (m *model) ddMove(d int) {
	for {
		m.ddIdx += d
		if m.ddIdx < 0 {
			m.ddIdx = 0
			return
		}
		if m.ddIdx >= len(ddItems) {
			m.ddIdx = len(ddItems) - 1
			return
		}
		if ddItems[m.ddIdx].selectable {
			return
		}
	}
}

// pickDropdown composes the selected item's text into the input, the
// same compose-only rule as the JS status bar. Nothing is sent.
func (m *model) pickDropdown() {
	if !m.ddOpen || m.ddIdx < 0 || m.ddIdx >= len(ddItems) {
		return
	}
	it := ddItems[m.ddIdx]
	if !it.selectable {
		return
	}
	var text string
	switch it.label {
	case "Private/instant message":
		text = "!" + m.ddName + ", "
	case "Mail/message":
		text = "@" + m.ddName + ", "
	case "Image":
		text = ">" + m.ddName + ", image"
	}
	m.input.SetValue(text)
	m.input.CursorEnd()
	m.closeDropdown()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.layout()
		// Do NOT re-focus here. A resize is also how the phone tells
		// us the keyboard was shown or hidden, and re-focusing on
		// every resize pops the keyboard straight back up after the
		// user dismissed it. Focus is controlled by taps, below.
		return m, nil

	case tickMsg:
		// Heartbeat, the same PING|nick the JS client sends.
		m.sendRaw("PING|" + m.myNick)
		return m, tickHeartbeat()

	case wsMsg:
		m.handleIncoming(msg.cm, false)
		return m, nil

	case wsErr:
		m.errMsg = msg.err.Error()
		m.addLine(styleErr.Render("connection lost: " + msg.err.Error()))
		m.status = "disconnected"
		return m, nil

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	// Let the viewport and input see anything not handled above.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	// In bubbletea v1.3 the event kind is msg.Type (MouseEventType);
	// msg.Button is the raw button (MouseButtonLeft, ...).
	if msg.Type != tea.MouseLeft || msg.Action != tea.MouseActionPress {
		// Wheel scrolls the messages.
		if msg.Type == tea.MouseWheelUp || msg.Type == tea.MouseWheelDown {
			var cmd tea.Cmd
			m.viewport, cmd = m.viewport.Update(msg)
			return m, cmd
		}
		return m, nil
	}
	x, y := msg.X, msg.Y
	// Click on the live row (line 0): open the dropdown for that name.
	if y == 0 {
		for _, sp := range m.spans {
			if x >= sp.x0 && x < sp.x1 {
				if m.ddOpen && m.ddName == sp.name {
					m.closeDropdown()
				} else {
					m.openDropdown(sp.name)
				}
				return m, nil
			}
		}
		// Clicked the row but not a name: close any dropdown.
		if m.ddOpen {
			m.closeDropdown()
		}
		return m, nil
	}
	// Click inside the dropdown: line 1 is the top border, line 2 the
	// name header, lines 3..6 the items, line 7 the bottom border.
	if m.ddOpen && y >= 3 && y <= 6 {
		idx := y - 3
		if idx >= 0 && idx < len(ddItems) && ddItems[idx].selectable {
			m.ddIdx = idx
			m.pickDropdown()
		}
		return m, nil
	}
	// Click anywhere else: the input line is right above the status
	// line, at 1 + (dropdown ? 7 : 0) + viewport height. A tap on it
	// focuses the input so the phone keyboard comes back; a tap on
	// the messages blurs it so the keyboard dismisses and the user
	// can read. Either way the dropdown closes.
	inputY := 1 + m.viewport.Height
	if m.ddOpen {
		inputY += ddHeight
	}
	if m.ddOpen {
		m.closeDropdown()
	}
	if y == inputY {
		m.focus = focusInput
		m.input.Focus()
	} else {
		m.input.Blur()
	}
	return m, nil
}

func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c", "ctrl+q":
		m.quitting = true
		return m, tea.Quit
	}

	switch m.focus {
	case focusDropdown:
		switch msg.String() {
		case "up", "k":
			m.ddMove(-1)
		case "down", "j":
			m.ddMove(1)
		case "enter":
			m.pickDropdown()
		case "esc", "tab":
			m.closeDropdown()
		}
		return m, nil

	case focusRow:
		others := m.others()
		switch msg.String() {
		case "left", "h":
			if m.rowSel > 0 {
				m.rowSel--
			}
		case "right", "l":
			if m.rowSel < len(others)-1 {
				m.rowSel++
			}
		case "enter":
			if m.rowSel >= 0 && m.rowSel < len(others) {
				m.openDropdown(others[m.rowSel])
			}
		case "esc", "tab":
			m.focus = focusInput
			m.input.Focus()
		}
		return m, nil

	default: // focusInput
		switch msg.String() {
		case "tab":
			if len(m.others()) > 0 {
				m.focus = focusRow
				if m.rowSel >= len(m.others()) {
					m.rowSel = 0
				}
				m.input.Blur()
			}
			return m, nil
		case "up", "down", "pgup", "pgdown":
			var cmd tea.Cmd
			m.viewport, cmd = m.viewport.Update(msg)
			return m, cmd
		case "enter":
			text := m.input.Value()
			m.input.SetValue("")
			if strings.TrimSpace(text) == "" {
				return m, nil
			}
			m.handleInput(text)
			if m.quitting {
				// /quit sets quitting but must also tell bubbletea
				// to exit, or the program sits in the alt screen
				// showing nothing and the terminal never comes back.
				return m, tea.Quit
			}
			return m, nil
		}
	}

	// Anything else goes to the input.
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return m, cmd
}

func (m model) View() string {
	if m.quitting {
		return ""
	}
	if !m.ready {
		return "connecting…"
	}
	var b strings.Builder
	b.WriteString(m.renderLiveRow())
	b.WriteString("\n")
	if m.ddOpen {
		b.WriteString(m.renderDropdown())
		b.WriteString("\n")
	}
	b.WriteString(m.viewport.View())
	b.WriteString("\n")
	b.WriteString(m.input.View())
	b.WriteString("\n")
	status := fmt.Sprintf("%s · %s · %s", m.myNick, m.sessionID, m.status)
	if m.errMsg != "" {
		status += " · " + m.errMsg
	}
	b.WriteString(styleDim.Render(status))
	return b.String()
}
