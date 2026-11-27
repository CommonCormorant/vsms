// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// commands.go: input parsing, slash commands, and incoming messages.
//
// Wire formats (from server/main.go and RetroTerm/script.js):
//   out: MSG|nick|text, IM|nick|recipient|text|id,
//        MAIL|nick|recipient|text||U, NICK|nick|newName,
//        PEER|nick|recipient|kind|payload, PING|nick,
//        EMOTE|nick|action, ECHO|nick|text
//   in:  JSON ChatMessage, message field pipe-delimited the same way:
//        MSG|sender|text, IM|sender|recipient|text,
//        WELCOME|a,b,c, JOIN|nick, PART|nick, NICK_UPDATE|old|new,
//        PEER|sender|recipient|kind|payload, DELIVERY_FAILED|...,
//        STORE_SUCCESS|recipient, STORE_FAILED|err, PONG
//   A "|" inside a message body survives because display joins
//   parts[2:] (or parts[3:]) back together.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (m *model) isGuest() bool {
	return strings.HasPrefix(m.myNick, "guest")
}

// splitRecipient splits "recipient, rest" on the first comma, the way
// the JS command parser does. It returns ok=false when there is no
// comma or either side is empty.
func splitRecipient(s string) (recipient, rest string, ok bool) {
	i := strings.Index(s, ",")
	if i < 0 {
		return "", "", false
	}
	recipient = strings.TrimSpace(s[:i])
	rest = strings.TrimSpace(s[i+1:])
	if recipient == "" || rest == "" {
		return "", "", false
	}
	return recipient, rest, true
}

func imID() string {
	return fmt.Sprintf("im-%d-%d", time.Now().UnixMilli(), rand.Intn(1000000))
}

// handleInput dispatches a submitted input line. Plain text goes out as
// a public message; anything else is a command.
func (m *model) handleInput(text string) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return
	}
	// Prefix aliases, the same as the JS client: ! is /im, @ is
	// /message, > is /send.
	switch {
	case strings.HasPrefix(trimmed, "!"):
		m.cmdIM(strings.TrimSpace(trimmed[1:]))
		return
	case strings.HasPrefix(trimmed, "@"):
		m.cmdMail(strings.TrimSpace(trimmed[1:]))
		return
	case strings.HasPrefix(trimmed, ">"):
		m.cmdSend(strings.TrimSpace(trimmed[1:]))
		return
	}
	if !strings.HasPrefix(trimmed, "/") {
		m.sendRaw("MSG|" + m.myNick + "|" + text)
		return
	}
	fields := strings.Fields(trimmed)
	cmd := strings.ToLower(fields[0])
	rest := strings.TrimSpace(trimmed[len(fields[0]):])
	switch cmd {
	case "/help", "/h":
		m.cmdHelp()
	case "/name":
		m.cmdName(rest)
	case "/im":
		m.cmdIM(rest)
	case "/send", "/s":
		m.cmdSend(rest)
	case "/message", "/msg", "/mail":
		m.cmdMail(rest)
	case "/me", "/emote", "/em":
		m.cmdEmote(rest)
	case "/echo":
		m.sendRaw("ECHO|" + m.myNick + "|" + rest)
	case "/whoami":
		m.addLine(styleSys.Render(fmt.Sprintf("You are %s, session %s, %d online.", m.myNick, m.sessionID, len(m.online))))
	case "/alone":
		m.cmdAlone()
	case "/time":
		m.addLine(styleSys.Render(time.Now().Format("Mon 2006-01-02 15:04:05 MST")))
	case "/history":
		m.cmdHistory(rest)
	case "/invite", "/i":
		m.addLine(styleSys.Render("Share link: " + m.baseURL + "/rt/?sID=" + m.sessionID))
	case "/quit", "/exit":
		m.quitting = true
	default:
		m.addLine(styleErr.Render("Unknown command " + cmd + " — /help for a list."))
	}
}

func (m *model) cmdHelp() {
	m.addLine(styleSys.Render("Available commands:"))
	for _, l := range []string{
		"/name [new] - change nickname (empty picks a random one)",
		"/im <who>, <message> - private message (! also works)",
		"/send <who>, image - send an image, peer to peer (/s, > also work)",
		"/message <who>, <message> - send mail (@ also works)",
		"/mail ? - check for new mail",
		"/me <action> - emote",
		"/echo <text> - echo a message",
		"/whoami - your nickname and session",
		"/alone - who is in the room",
		"/history [minutes] - fetch server history (default 15, max 90)",
		"/invite - shareable link to this room",
		"/time - current date and time",
		"/quit - leave",
		"Tab moves to the room row, arrows pick a person, Enter opens their menu.",
	} {
		m.addLine(styleSys.Render("  " + l))
	}
}

func (m *model) cmdName(rest string) {
	newName := strings.TrimSpace(rest)
	if newName == "" {
		newName = randomNick()
	}
	if strings.Contains(newName, ",") || strings.Contains(newName, "!") {
		m.addLine(styleErr.Render("A nickname cannot contain , or !"))
		return
	}
	m.sendRaw("NICK|" + m.myNick + "|" + newName)
}

func (m *model) cmdIM(rest string) {
	if m.isGuest() {
		m.addLine(styleErr.Render(`You must change your /name from "guest" to send an IM.`))
		return
	}
	recipient, message, ok := splitRecipient(rest)
	if !ok {
		m.addLine(styleErr.Render("Usage: /im recipient, message"))
		return
	}
	id := imID()
	m.sendRaw("IM|" + m.myNick + "|" + recipient + "|" + message + "|" + id)
	m.addLine(styleOwn.Render("IM->" + recipient + " " + message))
}

func (m *model) cmdMail(rest string) {
	if strings.TrimSpace(rest) == "?" {
		m.checkMail()
		return
	}
	if m.isGuest() {
		m.addLine(styleErr.Render(`You must change your /name from "guest" to send mail.`))
		return
	}
	recipient, message, ok := splitRecipient(rest)
	if !ok {
		m.addLine(styleErr.Render("Usage: /message recipient, message"))
		return
	}
	// The trailing ||U is part of the JS client's mail format.
	m.sendRaw("MAIL|" + m.myNick + "|" + recipient + "|" + message + "||U")
}

// cmdSend is the image macro. Picking Image in the dropdown composes
// ">Name, image" into the input; running that macro lands here, and in
// v1 peer-to-peer is not implemented, so it gets the Dave line and
// nothing goes on the wire.
func (m *model) cmdSend(rest string) {
	if m.isGuest() {
		m.addLine(styleErr.Render(`You must change your /name from "guest" to send an image.`))
		return
	}
	recipient, thing, ok := splitRecipient(rest)
	if !ok || recipient == "" {
		m.addLine(styleErr.Render(`Usage: /send recipient, image  (recipient or "all" for the room)`))
		return
	}
	t := strings.ToLower(strings.TrimSpace(thing))
	if t != "i" && t != "img" && t != "image" {
		m.addLine(styleErr.Render(`Usage: /send recipient, image  (only images for now — use i, img or image)`))
		return
	}
	m.addLine(styleSys.Render(daveMsg))
}

func (m *model) cmdEmote(rest string) {
	if strings.TrimSpace(rest) == "" {
		m.addLine(styleErr.Render("Usage: /me action"))
		return
	}
	m.sendRaw("EMOTE|" + m.myNick + "|" + rest)
}

func (m *model) cmdAlone() {
	others := m.others()
	if len(others) == 0 {
		m.addLine(styleSys.Render("You are alone in this room."))
		return
	}
	m.addLine(styleSys.Render("In this room: " + strings.Join(others, ", ")))
}

func (m *model) cmdHistory(rest string) {
	minutes := 15
	if strings.TrimSpace(rest) != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(rest)); err == nil {
			minutes = n
		}
	}
	if minutes < 1 {
		minutes = 1
	}
	if minutes > 90 {
		minutes = 90
	}
	m.addLine(styleSys.Render(fmt.Sprintf("Fetching history for the last %d minute(s)...", minutes)))
	go func() {
		items, err := fetchHistory(m.baseURL, m.sessionID, minutes)
		if err != nil {
			m.c.errCh <- err
			return
		}
		for _, cm := range items {
			if strings.HasPrefix(cm.Message, "MAIL|") {
				continue
			}
			m.c.recv <- cm
		}
	}()
}

// checkMail GETs /api/mail/check and prints the result.
func (m *model) checkMail() {
	if m.isGuest() {
		return
	}
	m.addLine(styleSys.Render("Checking mail..."))
	go func() {
		httpClient := &http.Client{Timeout: 10 * time.Second}
		reqURL := fmt.Sprintf("%s/api/mail/check?sID=%s&nick=%s", m.baseURL, m.sessionID, m.myNick)
		resp, err := httpClient.Get(reqURL)
		if err != nil {
			m.c.errCh <- err
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			m.c.errCh <- err
			return
		}
		var items []chatMessage
		if err := json.Unmarshal(body, &items); err != nil || len(items) == 0 {
			m.c.recv <- chatMessage{Message: "ECHO|No new mail."}
			return
		}
		m.c.recv <- chatMessage{Message: fmt.Sprintf("ECHO|--- You have %d new message(s) ---", len(items))}
		for _, cm := range items {
			m.c.recv <- cm
		}
		m.c.recv <- chatMessage{Message: "ECHO|--- End of Messages ---"}
	}()
}

// peerFileMeta is the JSON a file request carries, base64url-encoded:
// name, size, type, and image dimensions when known.
type peerFileMeta struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(bytes)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(bytes)/(1024*1024))
}

// handleIncoming renders one server message. quiet is set for the
// connect-time burst (early messages and history) so join/leave noise
// from the backlog does not re-announce.
func (m *model) handleIncoming(cm chatMessage, quiet bool) {
	parts := strings.Split(cm.Message, "|")
	if len(parts) == 0 {
		return
	}
	typ := parts[0]
	switch typ {
	case "MSG":
		if len(parts) < 3 {
			return
		}
		sender := parts[1]
		text := strings.Join(parts[2:], "|")
		if strings.EqualFold(sender, m.myNick) {
			m.addLine(styleOwn.Render(sender + ": " + text))
		} else {
			m.addLine(styleMsg.Render(sender + ": " + text))
		}
	case "EMOTE":
		if len(parts) < 3 {
			return
		}
		m.addLine(styleMsg.Render("* " + parts[1] + " " + strings.Join(parts[2:], "|")))
	case "IM":
		if len(parts) < 4 {
			return
		}
		sender := parts[1]
		text := strings.Join(parts[3:], "|")
		m.addLine(styleOwn.Render("IM from " + sender + ": " + text))
	case "WELCOME":
		if len(parts) > 1 && parts[1] != "" {
			m.online = strings.Split(parts[1], ",")
		} else {
			m.online = nil
		}
		if !quiet {
			if len(m.online) == 0 {
				m.addLine(styleSys.Render("* Online: just you."))
			} else {
				m.addLine(styleSys.Render("* Online: " + strings.Join(m.online, ", ")))
			}
		}
	case "JOIN":
		if len(parts) < 2 {
			return
		}
		nick := parts[1]
		found := false
		for _, n := range m.online {
			if strings.EqualFold(n, nick) {
				found = true
			}
		}
		if !found {
			m.online = append(m.online, nick)
		}
		if !quiet {
			m.addLine(styleSys.Render("* " + nick + " has joined."))
		}
	case "PART":
		if len(parts) == 2 {
			nick := parts[1]
			var kept []string
			for _, n := range m.online {
				if !strings.EqualFold(n, nick) {
					kept = append(kept, n)
				}
			}
			m.online = kept
			if !quiet {
				m.addLine(styleSys.Render("* " + nick + " has left."))
			}
			return
		}
		// A PART with content is a parting message, not a leave.
		if len(parts) >= 3 {
			m.addLine(styleSys.Render("* " + parts[1] + ": " + strings.Join(parts[2:], "|")))
		}
	case "NICK_UPDATE":
		if len(parts) < 3 {
			return
		}
		oldNick, newNick := parts[1], parts[2]
		for i, n := range m.online {
			if strings.EqualFold(n, oldNick) {
				m.online[i] = newNick
			}
		}
		if strings.EqualFold(oldNick, m.myNick) {
			m.myNick = newNick
			saveNick(newNick)
			m.addLine(styleSys.Render("You are now known as " + newNick + "."))
		} else if !quiet {
			m.addLine(styleSys.Render("* " + oldNick + " is now known as " + newNick + "."))
		}
	case "ECHO":
		if len(parts) == 2 {
			m.addLine(styleSys.Render(parts[1]))
		} else if len(parts) >= 3 {
			m.addLine(styleSys.Render(parts[1] + ": " + strings.Join(parts[2:], "|")))
		}
	case "DELIVERY_FAILED":
		if len(parts) >= 2 {
			m.addLine(styleErr.Render("[Can't send: " + parts[1] + " is not available.]"))
		}
	case "PEER":
		m.handlePeer(parts)
	case "PEER_FAILED":
		if len(parts) >= 3 {
			m.addLine(styleErr.Render("[Peer failed: " + parts[1] + " is not available (" + parts[2] + ").]"))
		}
	case "STORE_SUCCESS":
		if len(parts) >= 2 {
			m.addLine(styleSys.Render("Mail stored for " + parts[1] + "."))
		}
	case "STORE_FAILED":
		if len(parts) >= 2 {
			m.addLine(styleErr.Render("Mail failed: " + strings.Join(parts[1:], "|")))
		}
	case "PONG":
		// Heartbeat reply. Nothing to show.
	case "KILL9_DB_ERROR", "KILL9_INITIATE_REDIRECT":
		m.addLine(styleErr.Render(cm.Message))
	default:
		// Unknown type: show it rather than silently dropping it, so
		// a protocol addition is visible instead of invisible.
		m.addLine(styleDim.Render(cm.Message))
	}
}

// handlePeer handles PEER signaling. In v1 the client never starts a
// transfer and cannot receive one (no WebRTC), so a file request is
// declined at once and the sender is told promptly instead of waiting
// out the 80-second accept window.
func (m *model) handlePeer(parts []string) {
	// PEER|SENDER|RECIPIENT|KIND|PAYLOAD...
	if len(parts) < 4 {
		return
	}
	sender := parts[1]
	kind := parts[3]
	payload := ""
	if len(parts) > 4 {
		payload = strings.Join(parts[4:], "|")
	}
	if kind != "file" {
		// accept/decline/offer/answer/ice/bye for a transfer v1 never
		// started. Nothing to do.
		return
	}
	// A file request. Decode the meta for the notice, then decline.
	info := "an image"
	if payload != "" {
		if raw, err := base64.RawURLEncoding.DecodeString(payload); err == nil {
			var meta peerFileMeta
			if err := json.Unmarshal(raw, &meta); err == nil && meta.Name != "" {
				dims := ""
				if meta.Width > 0 && meta.Height > 0 {
					dims = fmt.Sprintf(" (%dx%d)", meta.Width, meta.Height)
				}
				info = fmt.Sprintf("%s — %s%s", meta.Name, formatSize(meta.Size), dims)
			}
		}
	}
	m.addLine(styleSys.Render(sender + " wants to send an image: " + info))
	m.addLine(styleSys.Render(daveMsg))
	m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
}
