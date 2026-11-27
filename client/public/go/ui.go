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
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/charmbracelet/bubbles/filepicker"
	"github.com/charmbracelet/bubbles/key"
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
	c            *client
	sessionID    string
	baseURL      string
	myNick       string
	online       []string          // everyone in the room, including self
	flags        map[string]string // nick -> flag emoji ("" = none); flagFetching = fetch in flight
	peer         *peerState        // in-progress file transfers, both directions (WebRTC)
	picker       filepicker.Model  // the /send file picker, when open
	picking      bool              // the file picker modal is open
	pickTo       string            // recipient for the pending image send
	promptSender string            // nick with a pending incoming-image prompt ("" = none)
	promptSeq    int               // prompt generation; stale timeout ticks carry an old seq
	lines        []string          // rendered message lines
	viewport     viewport.Model
	input        textinput.Model
	width        int
	height       int
	focus        int
	rowSel       int
	ddOpen       bool
	ddName       string
	ddIdx        int
	status       string
	quitting     bool
	errMsg       string
	spans        []nameSpan // name click targets from the last render
	ready        bool
	startTime    time.Time // session start, for /uptime
	profile      string    // profile bio, for /profile
	welcomed     bool      // true after the first WELCOME; later ones are silent roster resyncs
	encLevel     int       // remembered /enc level (0 = plain IMs); /enc 0 turns auto-encryption off
	nightMode    bool      // true = dark theme (black bg, bright text, the Termux look); false = light theme (white bg, darker text, the JS day mode)
}

type wsMsg struct{ cm chatMessage }
type wsErr struct{ err error }
type tickMsg time.Time

// flagFetching marks a nick whose /whois flag fetch is in flight, so a
// second roster change doesn't re-fetch it before the first returns.
const flagFetching = "\x00fetching"

// flagsMsg carries the /whois flags fetched for the live room row.
type flagsMsg struct{ flags map[string]string }

var (
	// The styles below are the DARK palette (night mode): bright
	// text on black, the Termux look. applyTheme reassigns them to
	// the LIGHT palette (darker text on white) when night mode is
	// off. All renders happen on the Bubble Tea goroutine, so
	// reassigning these package vars from Update is safe — pion
	// callbacks never render a style directly (they go through the
	// peerNotice ECHO path).
	// Every style carries the theme background, not just styleBg:
	// View wraps the whole screen in styleBg, but each inner
	// Render ends with a reset (\x1b[0m) that clears the
	// background, so text would render on the terminal's default
	// background instead of the painted one. On xterm (white
	// terminal bg) that made the dark theme's bright text nearly
	// invisible — the live-row names washed out and the header
	// looked gone. With the bg on each style, every span
	// re-asserts it.
	styleMsg  = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Background(lipgloss.Color("0")) // bright green
	styleOwn  = lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Background(lipgloss.Color("0")) // cyan
	styleSys  = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Background(lipgloss.Color("0")) // yellow
	styleErr  = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Background(lipgloss.Color("0"))  // red
	styleName = lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Background(lipgloss.Color("0"))
	styleSel  = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("14"))
	styleDim  = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Background(lipgloss.Color("0"))
	styleBox  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("14")).Background(lipgloss.Color("0"))
	styleEnc  = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Background(lipgloss.Color("0")) // green, for decrypted /enc messages
	// styleBg paints the whole screen: black in night mode, white
	// in day mode, so the client reads the same in any terminal
	// (Termux and xterm). Set by applyTheme.
	styleBg = lipgloss.NewStyle().Background(lipgloss.Color("0"))
)

// applyTheme reassigns the package styles to the dark or light
// palette. The dark palette is the current bright-on-black set.
// The light palette is the ANSI equivalent of the JS client's day
// mode: a white background means every color needs its darker
// version (green becomes dark green, and so on), matching the JS
// day /enc green #006400. Called at startup and on every
// /nightmode toggle; the caller re-applies the input styles after.
func applyTheme(night bool) {
	// Every style carries the theme background (see the var block
	// above): the outer styleBg wrap alone does not survive the
	// inner Renders' resets. styleSel keeps its own highlight
	// background in both themes.
	if night {
		styleMsg = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Background(lipgloss.Color("0")) // bright green
		styleOwn = lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Background(lipgloss.Color("0")) // cyan
		styleSys = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Background(lipgloss.Color("0")) // yellow
		styleErr = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Background(lipgloss.Color("0"))  // red
		styleName = lipgloss.NewStyle().Foreground(lipgloss.Color("14")).Background(lipgloss.Color("0"))
		styleSel = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("14"))
		styleDim = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Background(lipgloss.Color("0"))
		styleBox = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("14")).Background(lipgloss.Color("0"))
		styleEnc = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Background(lipgloss.Color("0"))
		styleBg = lipgloss.NewStyle().Background(lipgloss.Color("0"))
		return
	}
	// Light: white background, darker versions of every color.
	styleMsg = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Background(lipgloss.Color("15"))                                        // dark green, JS day /enc #006400
	styleOwn = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Background(lipgloss.Color("15"))                                        // dark cyan
	styleSys = lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Background(lipgloss.Color("15"))                                        // dark yellow
	styleErr = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Background(lipgloss.Color("15"))                                        // dark red
	styleName = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Background(lipgloss.Color("15"))                                       // dark cyan
	styleSel = lipgloss.NewStyle().Foreground(lipgloss.Color("15")).Background(lipgloss.Color("6"))                                        // white on dark cyan
	styleDim = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Background(lipgloss.Color("15"))                                        // unchanged, reads on white
	styleBox = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("6")).Background(lipgloss.Color("15")) // dark cyan
	styleEnc = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Background(lipgloss.Color("15"))                                        // unchanged, already dark green
	styleBg = lipgloss.NewStyle().Background(lipgloss.Color("15"))
}

// Inline Markdown, matching the JS client (script.js renderMarkdown):
// **bold** → ANSI bold (SGR 1), _under_ → ANSI underline (SGR 4),
// *italic* → /slashes/ — plain text, no ANSI italic (the user does
// not want italic). Order is bold, then italic, then underline (the
// JS order), so **text** is caught by bold before the italic pattern
// sees it. No code (`text`) handling. The bold/underline styles
// derive from the active theme's base style (same foreground +
// Bold/Underline), so they read in both themes. Unmatched markers
// are left literal — the italic pattern needs at least one
// non-asterisk character, so a lone ** is never eaten by it.
var (
	mdBoldRe   = regexp.MustCompile(`\*\*(.*?)\*\*`)
	mdItalicRe = regexp.MustCompile(`\*([^*]+)\*`)
	mdUnderRe  = regexp.MustCompile(`_(.*?)_`)
)

// renderInline applies the inline Markdown to chat message text.
// Bold is split out first, globally (JS order), so **text** is
// caught by bold before the italic pattern sees it. Italic and
// underline still apply inside a bold span (JS nests them inside
// <b>), with the bold style as the base. Each segment is rendered
// exactly once, so ANSI codes never nest (a nested Render would
// reset the outer color). The sender prefix is rendered separately
// by the caller and is not passed through here.
func renderInline(text string, base lipgloss.Style) string {
	locs := mdBoldRe.FindAllStringSubmatchIndex(text, -1)
	if len(locs) == 0 {
		return renderNoBold(text, base)
	}
	var b strings.Builder
	last := 0
	for _, loc := range locs {
		b.WriteString(renderNoBold(text[last:loc[0]], base))
		b.WriteString(renderNoBold(text[loc[2]:loc[3]], base.Bold(true)))
		last = loc[1]
	}
	b.WriteString(renderNoBold(text[last:], base))
	return b.String()
}

// renderNoBold renders a segment with no bold spans: *...* becomes
// /.../ (plain slashes, no ANSI italic) and _..._ becomes
// underline. The two can nest inside each other (JS applies italic,
// then underline), so each span's inner is processed for the other
// marker. Each piece is rendered once.
func renderNoBold(text string, base lipgloss.Style) string {
	var b strings.Builder
	i := 0
	for i < len(text) {
		switch text[i] {
		case '*':
			// Italic: *...* → /.../. Content must be 1+ non-*
			// chars, so a lone ** is never eaten.
			if j := strings.Index(text[i+1:], "*"); j > 0 {
				inner := text[i+1 : i+1+j]
				b.WriteString(base.Render("/"))
				b.WriteString(renderUnderOnly(inner, base))
				b.WriteString(base.Render("/"))
				i += 1 + j + 1
				continue
			}
			b.WriteString(base.Render("*"))
			i++
		case '_':
			if j := strings.Index(text[i+1:], "_"); j >= 0 {
				inner := text[i+1 : i+1+j]
				b.WriteString(renderItalicOnly(inner, base.Underline(true)))
				i += 1 + j + 1
				continue
			}
			b.WriteString(base.Render("_"))
			i++
		default:
			j := strings.IndexAny(text[i:], "*_")
			var run string
			if j < 0 {
				run, i = text[i:], len(text)
			} else {
				run, i = text[i:i+j], i+j
			}
			b.WriteString(base.Render(run))
		}
	}
	return b.String()
}

// renderUnderOnly renders _..._ spans as underline; everything else
// uses base. Used for the inside of an italic span (JS applies
// underline after italic).
func renderUnderOnly(text string, base lipgloss.Style) string {
	under := base.Underline(true)
	var b strings.Builder
	last := 0
	for _, loc := range mdUnderRe.FindAllStringSubmatchIndex(text, -1) {
		b.WriteString(base.Render(text[last:loc[0]]))
		b.WriteString(under.Render(text[loc[2]:loc[3]]))
		last = loc[1]
	}
	b.WriteString(base.Render(text[last:]))
	return b.String()
}

// renderItalicOnly renders *...* spans as /.../ (plain slashes);
// everything else uses base. Used for the inside of an underline
// span (JS applies italic before underline).
func renderItalicOnly(text string, base lipgloss.Style) string {
	var b strings.Builder
	last := 0
	for _, loc := range mdItalicRe.FindAllStringSubmatchIndex(text, -1) {
		b.WriteString(base.Render(text[last:loc[0]]))
		b.WriteString(base.Render("/" + text[loc[2]:loc[3]] + "/"))
		last = loc[1]
	}
	b.WriteString(base.Render(text[last:]))
	return b.String()
}

func newModel(c *client, sessionID, baseURL, nick string, early, history []chatMessage) model {
	// Apply the remembered theme first, so the input styles below
	// (and every line added after) use the right palette.
	night := loadNightMode()
	applyTheme(night)

	// Single-line input, like the JS client: it starts on one line
	// and scrolls left/right as you type past the edge. The input
	// is NOT where wrapping belongs — the output/chat area is.
	ti := textinput.New()
	ti.Prompt = "> "
	ti.Placeholder = "type a message, /help for commands"
	ti.CharLimit = 2000
	ti.Focus()
	ti.PromptStyle = styleMsg
	ti.TextStyle = styleMsg
	// The placeholder needs a theme style too, or it renders in
	// the terminal default colors in an unpainted gap (invisible
	// on xterm's white in the dark theme, like the live row was).
	ti.PlaceholderStyle = styleDim

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
		encLevel:  loadEncLevel(),
		nightMode: night,
		flags:     make(map[string]string),
		peer:      newPeerState(),
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

// wrapOutput wraps a rendered output line to the viewport width.
// It wraps at word boundaries first (wordwrap, with breakpoints
// added for URL characters so a long link breaks at / ? = & .),
// then hard-breaks any line that is STILL too long — a long
// unbroken token like a hex session id has no breakpoint at all,
// and without the hard break it runs off the right edge of the
// screen and is invisible unless the user shrinks the terminal.
// The hard break is ANSI-aware: escape sequences are copied
// through without counting toward the width or being split.
func wrapOutput(s string, w int) string {
	ww := wordwrap.NewWriter(w)
	ww.Breakpoints = []rune{'-', '/', '?', '=', '&', '.', '_', ':', '#'}
	ww.KeepNewlines = true
	ww.Write([]byte(s))
	ww.Close()
	var out []string
	for _, ln := range strings.Split(ww.String(), "\n") {
		out = append(out, hardWrapLine(ln, w)...)
	}
	return strings.Join(out, "\n")
}

// hardWrapLine splits a single line into width-sized chunks, counting
// only printable runes (ANSI escape sequences pass through whole).
// A line that already fits is returned untouched.
func hardWrapLine(s string, w int) []string {
	if w < 1 {
		return []string{s}
	}
	// Fast path: measure the printable width.
	printable := 0
	inEsc := false
	for _, r := range s {
		if inEsc {
			if r >= '@' && r <= '~' {
				inEsc = false
			}
			continue
		}
		if r == '\x1b' {
			inEsc = true
			continue
		}
		printable++
	}
	if printable <= w {
		return []string{s}
	}
	var lines []string
	var cur strings.Builder
	count := 0
	inEsc = false
	for _, r := range s {
		if inEsc {
			cur.WriteRune(r)
			if r >= '@' && r <= '~' {
				inEsc = false
			}
			continue
		}
		if r == '\x1b' {
			inEsc = true
			cur.WriteRune(r)
			continue
		}
		if count >= w {
			lines = append(lines, cur.String())
			cur.Reset()
			count = 0
		}
		cur.WriteRune(r)
		count++
	}
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	return lines
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
	for _, ln := range strings.Split(wrapOutput(s, w), "\n") {
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

// roomFlag returns the emoji to show after name in the live row: the
// person's flag, or the black circle when they have none or the fetch
// hasn't returned yet.
func (m model) roomFlag(name string) string {
	if f, ok := m.flags[name]; ok && f != "" && f != flagFetching {
		return f
	}
	return "⚫"
}

// fetchRoomFlags returns a Cmd that fetches /whois flags for every
// room member not yet in m.flags. Nicks are pre-marked as fetching so
// a second roster change while one is in flight doesn't re-fetch
// them. Returns nil when there is nothing to fetch.
func (m *model) fetchRoomFlags() tea.Cmd {
	var todo []string
	for _, n := range m.online {
		if strings.EqualFold(n, m.myNick) {
			continue
		}
		if _, ok := m.flags[n]; ok {
			continue
		}
		m.flags[n] = flagFetching
		todo = append(todo, n)
	}
	if len(todo) == 0 {
		return nil
	}
	baseURL, sessionID := m.baseURL, m.sessionID
	return func() tea.Msg {
		out := make(map[string]string)
		for _, nick := range todo {
			out[nick] = fetchFlag(baseURL, sessionID, nick)
		}
		return flagsMsg{flags: out}
	}
}

// renderLiveRow builds the top row and records the click span of every
// name. The row is line 0 of the view, so a mouse click at y=0 maps
// straight onto these spans. Each name is followed by the person's
// flag (black circle when they have none); the span covers the name
// and the flag, so clicking either opens the dropdown, the same as
// the JS status bar.
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
		flag := m.roomFlag(name)
		x0 := x
		w := utf8.RuneCountInString(name) + 1 + lipgloss.Width(flag)
		x1 := x0 + w
		m.spans = append(m.spans, nameSpan{name: name, x0: x0, x1: x1})
		if m.focus == focusRow && i == m.rowSel {
			b.WriteString(styleSel.Render(name + " " + flag))
		} else {
			b.WriteString(styleName.Render(name))
			b.WriteString(" ")
			// The flag is styled, not raw: a raw flag sits in an
			// unpainted gap (terminal default fg/bg) between the
			// styled name spans. styleName gives it the theme
			// background and a visible foreground — the black
			// circle needs a light fg on black, a dark fg on
			// white — and color emoji ignore the fg anyway.
			b.WriteString(styleName.Render(flag))
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
		if m.picking {
			m.picker.SetHeight(m.pickerListHeight())
		}
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
		cmd := m.handleIncoming(msg.cm, false)
		// The roster may have changed; fetch flags for anyone new.
		return m, tea.Batch(cmd, m.fetchRoomFlags())

	case peerPromptTimeoutMsg:
		m.peerPromptTimeout(msg.sender, msg.seq)
		return m, nil

	case flagsMsg:
		for nick, flag := range msg.flags {
			m.flags[nick] = flag
		}
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

	// While the file picker is open, messages the switch above
	// didn't take go to it — this is how its directory reads
	// (readDirMsg) arrive. Anything else is ignored by it.
	if m.picking {
		var cmd tea.Cmd
		m.picker, cmd = m.picker.Update(msg)
		return m, cmd
	}

	// Let the viewport and input see anything not handled above.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	// While the file picker is open it owns the screen; clicks
	// behind the modal must not open dropdowns or move focus.
	if m.picking {
		return m, nil
	}
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

	// The file picker owns every key while it is open.
	if m.picking {
		return m.handlePickerKey(msg)
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
		// Recovery from the stuck state: handleMouse blurs the
		// input when the user taps the messages (to dismiss the
		// phone keyboard), but it leaves m.focus on focusInput, so
		// a blurred input silently swallows keystrokes and the user
		// cannot type at all — the client's one job. Any printable
		// key, or Enter, refocuses first, so the keystroke lands in
		// the input instead of being lost. Tab, arrows, pgup/pgdown
		// and esc keep their current meaning and do not refocus.
		if !m.input.Focused() && (msg.Type == tea.KeyRunes || msg.Type == tea.KeyEnter) {
			m.input.Focus()
		}
		// A pending image prompt answers y/n (or Enter for yes,
		// the default) when the input is empty, so a keypress
		// never eats a letter the user is typing into a message.
		// With text in the input, keys behave as normal and the
		// prompt waits for the 80-second timeout.
		if m.promptSender != "" && m.input.Value() == "" {
			switch msg.String() {
			case "y", "Y", "enter":
				m.peerPromptAccept()
				return m, nil
			case "n", "N":
				m.peerPromptDecline()
				return m, nil
			}
		}
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
			cmd := m.handleInput(text)
			if m.quitting {
				// /quit sets quitting but must also tell bubbletea
				// to exit, or the program sits in the alt screen
				// showing nothing and the terminal never comes back.
				return m, tea.Quit
			}
			return m, cmd
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
	// The file picker is a modal over the chat: the chat is hidden
	// behind it while it is open and returns when it closes.
	if m.picking {
		return m.renderPickerModal()
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
	out := b.String()
	// Both themes paint their background full-screen, so the client
	// reads the same in any terminal: black in night mode, white in
	// day mode. The style is sized to the terminal so the background
	// covers the entire area, not just behind the text. The file
	// picker modal is returned above and keeps its own QuickBASIC
	// blue, unaffected.
	return styleBg.Width(m.width).Height(m.height).Render(out)
}

// ------------------------------------------------------------------
// File picker: the /send image chooser.
//
// QuickBASIC look, per spec: blue background (#0000AA), gray default
// text (#AAAAAA), allowed images white and bold, folders just white.
// The picker is a centered modal over the chat; the chat is hidden
// behind it while it is open and returns when it closes.
// ------------------------------------------------------------------

var (
	qbBlue  = lipgloss.Color("#0000AA") // QuickBASIC blue background
	qbGray  = lipgloss.Color("#AAAAAA") // QuickBASIC gray text
	qbWhite = lipgloss.Color("#FFFFFF")

	stylePickerTitle = lipgloss.NewStyle().Foreground(qbWhite).Bold(true).Background(qbBlue)
	stylePickerHint  = lipgloss.NewStyle().Foreground(qbGray).Background(qbBlue)
	stylePickerBox   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("14")).Background(qbBlue).Padding(0, 1)
)

// pickerImageTypes are the only selectable files. The filepicker's
// canSelect is a case-sensitive suffix match, so both cases are
// listed — a camera file named IMG_1234.JPG must be pickable.
var pickerImageTypes = []string{
	".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG",
	".webp", ".WEBP", ".svg", ".SVG",
}

// pickerKeyMap is the filepicker default, plus home/end for first and
// last, and with esc taken off Back — esc cancels the picker instead
// of going up a directory (h, backspace and left still do that).
func pickerKeyMap() filepicker.KeyMap {
	km := filepicker.DefaultKeyMap()
	km.GoToTop = key.NewBinding(key.WithKeys("g", "home"), key.WithHelp("g", "first"))
	km.GoToLast = key.NewBinding(key.WithKeys("G", "end"), key.WithHelp("G", "last"))
	km.Back = key.NewBinding(key.WithKeys("h", "backspace", "left"), key.WithHelp("h", "back"))
	return km
}

// pickerStyles paints every picker line QuickBASIC blue, with images
// white and bold and folders just white. Non-allowed files are gray.
func pickerStyles() filepicker.Styles {
	st := filepicker.DefaultStyles()
	blue := func(s lipgloss.Style) lipgloss.Style { return s.Background(qbBlue) }
	st.Cursor = blue(lipgloss.NewStyle().Foreground(qbWhite).Bold(true))
	st.DisabledCursor = blue(lipgloss.NewStyle().Foreground(qbGray))
	st.Symlink = blue(lipgloss.NewStyle().Foreground(qbWhite))
	st.Directory = blue(lipgloss.NewStyle().Foreground(qbWhite))
	st.File = blue(lipgloss.NewStyle().Foreground(qbWhite).Bold(true))
	st.DisabledFile = blue(lipgloss.NewStyle().Foreground(qbGray))
	st.Permission = blue(lipgloss.NewStyle().Foreground(qbGray))
	st.Selected = blue(lipgloss.NewStyle().Foreground(qbWhite).Bold(true))
	st.DisabledSelected = blue(lipgloss.NewStyle().Foreground(qbGray))
	st.FileSize = blue(lipgloss.NewStyle().Foreground(qbGray))
	st.EmptyDirectory = blue(lipgloss.NewStyle().Foreground(qbGray))
	return st
}

// pickerListHeight is the file list height inside the modal: the
// modal is ~70% of the terminal, less the border, title and hint.
func (m model) pickerListHeight() int {
	h := m.height*70/100 - 4
	if h < 3 {
		h = 3
	}
	return h
}

// openPicker opens the file picker modal for sending an image to
// recipient. It starts in the home directory. Returns the picker's
// Init command, which reads that directory.
func (m *model) openPicker(recipient string) tea.Cmd {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	fp := filepicker.New()
	fp.CurrentDirectory = home
	fp.AllowedTypes = pickerImageTypes
	fp.ShowPermissions = false
	fp.ShowSize = true
	fp.ShowHidden = false
	fp.DirAllowed = false
	fp.FileAllowed = true
	fp.AutoHeight = false
	fp.KeyMap = pickerKeyMap()
	fp.Styles = pickerStyles()
	fp.SetHeight(m.pickerListHeight())
	m.picker = fp
	m.picking = true
	m.pickTo = recipient
	m.input.Blur()
	return fp.Init()
}

// handlePickerKey routes keys while the picker is open. Esc cancels
// without sending; anything else goes to the picker, and a selection
// closes the modal and starts the send.
func (m model) handlePickerKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "esc" {
		m.picking = false
		m.pickTo = ""
		m.input.Focus()
		return m, nil
	}
	var cmd tea.Cmd
	m.picker, cmd = m.picker.Update(msg)
	if ok, path := m.picker.DidSelectFile(msg); ok {
		recipient := m.pickTo
		m.picking = false
		m.pickTo = ""
		m.input.Focus()
		m.peerSendStart(recipient, path)
		return m, nil
	}
	return m, cmd
}

// renderPickerModal centers the picker in a bordered box, about 70%
// of the terminal, with a title and a key hint. The box background
// is QuickBASIC blue, so the whole modal is blue, not just the text.
func (m model) renderPickerModal() string {
	if m.width < 24 || m.height < 10 {
		return m.picker.View()
	}
	boxW := m.width * 70 / 100
	inner := stylePickerTitle.Render("Send image — pick a file") + "\n" +
		m.picker.View() +
		stylePickerHint.Render("↑↓ move · enter open/select · h back · esc cancel")
	box := stylePickerBox.Width(boxW - 2).Render(inner)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, box)
}
