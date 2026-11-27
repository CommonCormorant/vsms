// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// main.go: entry point, URL parsing, nickname memory, history fetch.
//
// Usage:
//   rt [-nick name] 'https://vsms.gameshiponline.com/rt/?sID=...'
// The URL is only used for its host and its sID; the client then speaks
// the same WebSocket protocol as RetroTerm. The nickname is remembered
// in ~/retro/nick (the Go equivalent of the JS client's localStorage
// settings) and reused across sessions. Incoming images are saved to
// ~/retro/imgs/ once peer receiving exists; in v1 that directory is
// only created, and file requests are declined.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// daveMsg is what the client prints when the user tries to run an
// image macro. Peer-to-peer is not implemented in this client (yet);
// composing the text works, running it does not.
const daveMsg = "I'm sorry Dave: peer-to-peer services aren't implemented in this client (yet)."

func homeDir() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return h
}

func nickPath() string { return filepath.Join(homeDir(), "retro", "nick") }
func imgsDir() string  { return filepath.Join(homeDir(), "retro", "imgs") }

func loadNick() string {
	b, err := os.ReadFile(nickPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func saveNick(nick string) {
	if err := os.MkdirAll(filepath.Dir(nickPath()), 0o755); err != nil {
		return
	}
	os.WriteFile(nickPath(), []byte(nick+"\n"), 0o644)
}

// randomNames is the pool for /name with no argument, the same idea as
// the JS client's RANDOM_NAMES list.
var randomNames = []string{
	"Pixel", "Comet", "Rogue", "Echo", "Nova", "Juno", "Milo", "Vega",
	"Orion", "Lyra", "Ash", "Iris", "Nox", "Pip", "Rex", "Sable",
	"Wren", "Zed", "Fern", "Hugo", "Ivy", "Jett", "Kai", "Luna",
}

func randomNick() string {
	return randomNames[rand.Intn(len(randomNames))]
}

func main() {
	nickFlag := flag.String("nick", "", "nickname to use")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: rt [-nick name] '<vsms url>?sID=...'")
		os.Exit(2)
	}
	rawURL := flag.Arg(0)
	u, err := url.Parse(rawURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad url:", err)
		os.Exit(2)
	}
	sID := u.Query().Get("sID")
	if sID == "" {
		fmt.Fprintln(os.Stderr, "no sID in url (want .../rt/?sID=...)")
		os.Exit(2)
	}
	wsScheme := "wss"
	if u.Scheme == "http" {
		wsScheme = "ws"
	}
	wsURL := fmt.Sprintf("%s://%s/api/ws?sID=%s", wsScheme, u.Host, sID)
	baseURL := fmt.Sprintf("%s://%s", u.Scheme, u.Host)

	// Nickname: flag wins, then the remembered file, then ask, then guest.
	nick := *nickFlag
	if nick == "" {
		nick = loadNick()
	}
	if nick == "" {
		// Only ask when stdin is a terminal; otherwise asking would
		// block forever on a pipe with no input.
		if st, err := os.Stdin.Stat(); err == nil && (st.Mode()&os.ModeCharDevice) != 0 {
			fmt.Print("Nickname: ")
			line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
			nick = strings.TrimSpace(line)
		}
	}
	if nick == "" {
		nick = "guest"
	}

	// Connect and run the handshake before the TUI starts, so a failure
	// is a plain error on stderr instead of a torn-down screen.
	c, finalNick, early, err := connect(wsURL, nick)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	defer c.close()
	nick = finalNick
	saveNick(nick)
	os.MkdirAll(imgsDir(), 0o755)

	// History for the last 15 minutes, best effort. A failure here is
	// not fatal; the live room still works.
	var history []chatMessage
	if h, err := fetchHistory(baseURL, sID, 15); err == nil {
		history = h
	}

	m := newModel(c, sID, baseURL, nick, early, history)
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
	// Forward incoming WebSocket messages into the program.
	go func() {
		for {
			select {
			case cm := <-c.recv:
				p.Send(wsMsg{cm: cm})
			case err := <-c.errCh:
				p.Send(wsErr{err: err})
				return
			}
		}
	}()
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "rt:", err)
		os.Exit(1)
	}
}

// fetchHistory GETs /api/history. The server answers a JSON array of
// chat messages; MAIL| rows are filtered out by the caller, the same
// as the JS client does.
func fetchHistory(baseURL, sID string, minutes int) ([]chatMessage, error) {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	reqURL := fmt.Sprintf("%s/api/history?sID=%s&minutes=%d", baseURL, sID, minutes)
	resp, err := httpClient.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("history: %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var items []chatMessage
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, err
	}
	return items, nil
}
