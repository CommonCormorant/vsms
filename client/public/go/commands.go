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
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// isReviewShortcut reports whether the input is "/<count>" or "/all",
// the JS client's bare-/ shortcut for /review. A "/<word>" is a
// command, not a review, so only digits (or "all") count.
func isReviewShortcut(trimmed string) bool {
	if !strings.HasPrefix(trimmed, "/") || len(trimmed) < 2 {
		return false
	}
	rest := trimmed[1:]
	if strings.EqualFold(rest, "all") {
		return true
	}
	_, err := strconv.Atoi(rest)
	return err == nil
}

// isSlashCommand reports whether s is one of the client's /commands.
// Used to tell a real command with a "?" stuck to it ("/mail?") apart
// from a word that merely ends in "?" and is not a command.
func isSlashCommand(s string) bool {
	switch s {
	case "/help", "/h", "/name", "/im", "/send", "/s", "/message", "/msg",
		"/mail", "/me", "/emote", "/em", "/echo", "/whoami", "/alone",
		"/time", "/history", "/invite", "/i", "/roll", "/flip", "/fortune",
		"/8ball", "/uptime", "/version", "/about", "/clear", "/home",
		"/review", "/profile", "/whois", "/quit", "/exit":
		return true
	}
	return false
}

// fortunes and eightBall are the JS client's lists, verbatim.
var fortunes = []string{
	"A pleasant surprise is waiting for you.",
	"Adventure awaits you in the near future.",
	"Your hard work will soon pay off.",
	"Good things come to those who wait.",
	"A friend will bring you unexpected joy.",
	"Trust your instincts today.",
	"The answer you seek lies within.",
	"New opportunities will knock on your door.",
}

var eightBall = []string{
	"It is certain.", "Without a doubt.", "Yes definitely.",
	"You may rely on it.", "As I see it, yes.", "Most likely.",
	"Outlook good.", "Yes.", "Signs point to yes.",
	"Reply hazy, try again.", "Ask again later.", "Better not tell you now.",
	"Cannot predict now.", "Concentrate and ask again.",
	"Don't count on it.", "My reply is no.", "My sources say no.",
	"Outlook not so good.", "Very doubtful.",
}

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

// toBinaryLevel rounds a level down to the nearest power of two.
// /enc only uses binary numbers: 318 becomes 256, 100 becomes 64,
// 200 becomes 128. The top is 512; anything higher also becomes
// 512. 0 stays 0 (off).
func toBinaryLevel(n int) int {
	if n <= 0 {
		return 0
	}
	p := 1
	for p*2 <= n && p < 512 {
		p *= 2
	}
	return p
}

// parseEncLevel reads the level field of an /enc command. It returns
// the level and true if the field IS a level (a named level or a
// number); if the field is neither, it returns 0, false and the field
// is the message instead. Named levels are case insensitive:
// lo/low 32, med/medium 128, hi/high 256, default/d/def 64.
func parseEncLevel(field string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(field)) {
	case "lo", "low":
		return 32, true
	case "med", "medium":
		return 128, true
	case "hi", "high":
		return 256, true
	case "default", "d", "def":
		return 64, true
	}
	if n, err := strconv.Atoi(strings.TrimSpace(field)); err == nil {
		return toBinaryLevel(n), true
	}
	return 0, false
}

// encKey derives the key string for a level from the session id:
// the level, plus ":" plus the session id reversed. The level goes
// FIRST so it matters even for a short message (the session id is
// 64 chars, so a level after it would never be reached by a message
// under 64 bytes). The session id is the salt; the level is the part
// that varies. Both clients know the session id, so the key never
// travels in the message.
func encKey(sessionID string, level int) string {
	// Reverse the session id (starting from the end).
	runes := []rune(sessionID)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return strconv.Itoa(level) + ":" + string(runes)
}

// encEncrypt XORs the plaintext (as UTF-8 bytes) with the key stream
// and base64url-encodes it, so it has no "|" and survives the pipe.
func encEncrypt(plain, sessionID string, level int) string {
	key := []byte(encKey(sessionID, level))
	data := []byte(plain)
	out := make([]byte, len(data))
	for i, b := range data {
		out[i] = b ^ key[i%len(key)]
	}
	return base64.RawURLEncoding.EncodeToString(out)
}

// encDecrypt reverses encEncrypt. It returns the plaintext and true,
// or "" and false if the payload is not valid base64.
func encDecrypt(cipherB64, sessionID string, level int) (string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(cipherB64)
	if err != nil {
		return "", false
	}
	key := []byte(encKey(sessionID, level))
	out := make([]byte, len(raw))
	for i, b := range raw {
		out[i] = b ^ key[i%len(key)]
	}
	return string(out), true
}

// isReservedNickname reports whether a nickname is disallowed: any
// single character, or (case insensitive) def, default, med, medium,
// lo, low, hi, high. These are the /enc level words, so they can
// never be confused with a level in a command. "all" is reserved
// separately, by the server.
func isReservedNickname(nick string) bool {
	if len([]rune(nick)) == 1 {
		return true
	}
	switch strings.ToLower(nick) {
	case "def", "default", "med", "medium", "lo", "low", "hi", "high":
		return true
	}
	return false
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
	// /message, > is /send, ? is /help, % is /echo, : is /me,
	// . is /name, & appends to the nickname, + is /invite,
	// ~ is /clear, and a bare / (or /<count>) is /review.
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
	case trimmed == "?":
		m.cmdHelp()
		return
	case strings.HasPrefix(trimmed, "%"):
		if txt := strings.TrimSpace(trimmed[1:]); txt != "" {
			m.sendRaw("ECHO|" + m.myNick + "|" + txt)
		}
		return
	case strings.HasPrefix(trimmed, ":"):
		m.cmdEmote(strings.TrimSpace(trimmed[1:]))
		return
	case strings.HasPrefix(trimmed, "."):
		m.cmdName(strings.TrimSpace(trimmed[1:]))
		return
	case strings.HasPrefix(trimmed, "&"):
		if suffix := strings.TrimSpace(trimmed[1:]); suffix != "" {
			m.cmdName(m.myNick + suffix)
		}
		return
	case trimmed == "+":
		m.addLine(styleSys.Render("Share link: " + m.baseURL + "/rt/?sID=" + m.sessionID))
		return
	case trimmed == "~":
		m.lines = nil
		m.viewport.SetContent("")
		m.addLine(styleSys.Render("Chat cleared."))
		return
	case trimmed == "/" || isReviewShortcut(trimmed):
		m.cmdReview(strings.TrimSpace(trimmed[1:]))
		return
	}
	if !strings.HasPrefix(trimmed, "/") {
		m.sendRaw("MSG|" + m.myNick + "|" + text)
		return
	}
	fields := strings.Fields(trimmed)
	cmd := strings.ToLower(fields[0])
	rest := strings.TrimSpace(trimmed[len(fields[0]):])
	// A "?" stuck to the command ("/mail?") is the same as "/mail ?".
	// The keyboard doesn't always put a space there, and a missing
	// space before a punctuation-style argument changes nothing.
	// Split the "?" off so the command matches and it becomes the
	// argument. The same applies to any command that takes "?".
	if strings.HasSuffix(cmd, "?") && len(cmd) > 2 {
		if base := cmd[:len(cmd)-1]; isSlashCommand(base) {
			if rest == "" {
				rest = "?"
			} else {
				rest = "? " + rest
			}
			cmd = base
		}
	}
	switch cmd {
	case "/help", "/h":
		m.cmdHelp()
	case "/name":
		m.cmdName(rest)
	case "/im":
		m.cmdIM(rest)
	case "/enc", "/encrypt":
		m.cmdEnc(rest)
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
	case "/roll":
		m.cmdRoll(rest)
	case "/flip":
		m.cmdFlip()
	case "/fortune":
		m.addLine(styleSys.Render("🥠 Fortune: " + fortunes[rand.Intn(len(fortunes))]))
	case "/8ball":
		m.addLine(styleSys.Render("🔮 Magic 8-Ball says: " + eightBall[rand.Intn(len(eightBall))]))
	case "/uptime":
		up := time.Since(m.startTime)
		h := int(up.Hours())
		min := int(up.Minutes()) % 60
		sec := int(up.Seconds()) % 60
		m.addLine(styleSys.Render(fmt.Sprintf("Uptime: %dh %dm %ds", h, min, sec)))
	case "/version":
		m.addLine(styleSys.Render("rt v1 — RetroTerm terminal client for VSMS"))
	case "/about":
		m.addLine(styleSys.Render("rt: a nostalgic terminal chat interface with modern flair."))
	case "/clear", "/home":
		m.lines = nil
		m.viewport.SetContent("")
		m.addLine(styleSys.Render("Chat cleared."))
	case "/review":
		m.cmdReview(rest)
	case "/profile":
		m.cmdProfile(rest)
	case "/whois":
		m.cmdWhois(rest)
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
		"/profile [bio] - set your profile bio (empty to view)",
		"/whoami - your nickname and session",
		"/whois [nick] - look up a user's info",
		"/alone - who is in the room",
		"/me <action> - emote",
		"/im <who>, <message> - private message (! also works)",
		"/enc <who>, [level,] <message> - encrypted private message (lo 32, med 128, hi 256, default 64; 0 turns auto-encryption off)",
		"/send <who>, image - send an image, peer to peer (/s, > also work)",
		"/message <who>, <message> - send mail (@ also works; /mail cc(x), msg for hex, cc(rx), cc(xx), cc(xr), or cc() for xr)",
		"/mail ? - check for new mail",
		"/invite - shareable link to this room",
		"/history [minutes] - fetch server history (default 15, max 90)",
		"/review [count] - show local history (default 12)",
		"/time - current date and time",
		"/echo <text> - echo a message",
		"/roll [sides] - roll a die (default 6 sides)",
		"/flip - flip a coin",
		"/8ball - ask the Magic 8-Ball",
		"/fortune - get a fortune cookie message",
		"/uptime - show session uptime",
		"/version - show rt version",
		"/about - about rt",
		"/clear - clear the chat screen",
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
	// One-character nicknames and the /enc level words (def, default,
	// med, medium, lo, low, hi, high) are reserved and can never be
	// a nickname, so they are never confused with a level. The
	// server enforces the same rule; this is the immediate feedback.
	if isReservedNickname(newName) {
		m.addLine(styleErr.Render("That nickname is reserved. Pick another one."))
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

// cmdEnc sends an encrypted IM: /enc <who>, [level,] <message>.
// The level is a named level (lo 32, med 128, hi 256, default 64),
// a number (rounded down to a power of two), or omitted (default 64).
// Level 0 sends the message plain and turns auto-encryption off.
// The level is remembered (~/retro/enclevel) like the nickname, so a
// later /im can auto-encrypt at the same level once that lands.
// The message goes out as a normal IM whose text is
// "ENC:<level>:<base64>", so the server just pipes it; the receiver
// spots the ENC: marker, decrypts with the session id, and shows it
// green. The key never travels in the message.
func (m *model) cmdEnc(rest string) {
	if m.isGuest() {
		m.addLine(styleErr.Render(`You must change your /name from "guest" to send an encrypted message.`))
		return
	}
	recipient, tail, ok := splitRecipient(rest)
	if !ok {
		m.addLine(styleErr.Render("Usage: /enc recipient, [level,] message"))
		return
	}
	// The tail is either "message" or "level, message".
	level := 64
	message := tail
	if i := strings.Index(tail, ","); i >= 0 {
		if lv, isLevel := parseEncLevel(tail[:i]); isLevel {
			level = lv
			message = strings.TrimSpace(tail[i+1:])
		}
	}
	if message == "" {
		m.addLine(styleErr.Render("Usage: /enc recipient, [level,] message"))
		return
	}
	// Remember the level (0 = off) for a later auto-encrypting /im.
	m.encLevel = level
	saveEncLevel(level)
	if level == 0 {
		// Off: send this one plain, and auto-encryption stays off.
		id := imID()
		m.sendRaw("IM|" + m.myNick + "|" + recipient + "|" + message + "|" + id)
		m.addLine(styleOwn.Render("IM->" + recipient + " " + message))
		return
	}
	cipher := encEncrypt(message, m.sessionID, level)
	id := imID()
	m.sendRaw("IM|" + m.myNick + "|" + recipient + "|ENC:" + strconv.Itoa(level) + ":" + cipher + "|" + id)
	m.addLine(styleOwn.Render("IM->" + recipient + " " + message))
}

// mailReverse reverses a string by rune.
func mailReverse(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

// mailEncrypt applies a hex-mail transform to a message: x = hex,
// rx = reverse then hex, xx = hex then hex, xr = hex then reverse.
// Matches the JS client's encryption object (ASCII text).
func mailEncrypt(flag, text string) string {
	switch flag {
	case "x":
		return hex.EncodeToString([]byte(text))
	case "rx":
		return hex.EncodeToString([]byte(mailReverse(text)))
	case "xx":
		return hex.EncodeToString([]byte(hex.EncodeToString([]byte(text))))
	case "xr":
		return mailReverse(hex.EncodeToString([]byte(text)))
	}
	return text
}

// mailDecrypt undoes a hex-mail transform by its flag. A bad payload
// is returned as-is rather than dropped.
func mailDecrypt(flag, text string) string {
	switch flag {
	case "x":
		if raw, err := hex.DecodeString(text); err == nil {
			return string(raw)
		}
	case "rx":
		if raw, err := hex.DecodeString(text); err == nil {
			return mailReverse(string(raw))
		}
	case "xx":
		if mid, err := hex.DecodeString(text); err == nil {
			if raw, err := hex.DecodeString(string(mid)); err == nil {
				return string(raw)
			}
		}
	case "xr":
		if raw, err := hex.DecodeString(mailReverse(text)); err == nil {
			return string(raw)
		}
	}
	return text
}

// parseMailRecipient splits a mail recipient like "cc(x)" into the
// name and the hex flag. No parens means plain mail (flag "").
// Empty parens "cc()" default to "xr". The type is case
// insensitive. An unknown type is an error.
func parseMailRecipient(recipient string) (name, flag string, ok bool) {
	recipient = strings.TrimSpace(recipient)
	if !strings.HasSuffix(recipient, ")") {
		return recipient, "", true
	}
	open := strings.LastIndex(recipient, "(")
	if open < 0 {
		return recipient, "", true
	}
	name = strings.TrimSpace(recipient[:open])
	typ := strings.ToLower(strings.TrimSpace(recipient[open+1 : len(recipient)-1]))
	switch typ {
	case "":
		return name, "xr", true
	case "x", "rx", "xx", "xr":
		return name, typ, true
	}
	return "", "", false
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
	// A parenthesised type after the name picks a hex transform:
	// cc(x), cc(rx), cc(xx), cc(xr); cc() defaults to xr; no
	// parens means plain mail.
	name, flag, ok := parseMailRecipient(recipient)
	if !ok {
		m.addLine(styleErr.Render("Unknown mail type. Use (x), (rx), (xx), (xr), or () for xr."))
		return
	}
	if flag != "" {
		message = mailEncrypt(flag, message)
	}
	// The trailing |flag|U is the JS client's mail format; the flag
	// is empty for plain mail.
	m.sendRaw("MAIL|" + m.myNick + "|" + name + "|" + message + "|" + flag + "|U")
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

// cmdRoll rolls a die and broadcasts it, the same wire format as the
// JS client: ROLL|nick|d<sides> <result>.
func (m *model) cmdRoll(rest string) {
	sides := 6
	if strings.TrimSpace(rest) != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(rest)); err == nil {
			sides = n
		}
	}
	if sides < 2 {
		m.addLine(styleErr.Render("Usage: /roll [sides] — sides must be 2 or more."))
		return
	}
	result := rand.Intn(sides) + 1
	m.sendRaw(fmt.Sprintf("ROLL|%s|d%d %d", m.myNick, sides, result))
}

// cmdFlip flips a coin and broadcasts it: FLIP|nick|Heads (or Tails).
func (m *model) cmdFlip() {
	outcome := "Tails"
	if rand.Intn(2) == 0 {
		outcome = "Heads"
	}
	m.sendRaw("FLIP|" + m.myNick + "|" + outcome)
}

// cmdReview re-prints the last N lines already on screen, the way
// the JS client's /review re-shows local history.
func (m *model) cmdReview(rest string) {
	count := 12
	if strings.TrimSpace(rest) != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(rest)); err == nil {
			count = n
		}
	}
	if len(m.lines) == 0 {
		m.addLine(styleSys.Render("No recent messages to review."))
		return
	}
	if count > len(m.lines) {
		count = len(m.lines)
	}
	start := len(m.lines) - count
	m.addLine(styleSys.Render(fmt.Sprintf("--- Last %d Messages ---", count)))
	for _, l := range m.lines[start : len(m.lines)-1] {
		m.addLine(l)
	}
	m.addLine(styleSys.Render("--- End of History ---"))
}

// cmdProfile sets or views the profile bio. It is sent to the server
// as PROFILE|nick|bio and remembered in ~/retro/profile.
func (m *model) cmdProfile(rest string) {
	if m.isGuest() {
		m.addLine(styleErr.Render(`You must change your /name from "guest" to set a profile.`))
		return
	}
	if strings.TrimSpace(rest) != "" {
		bio := strings.TrimSpace(rest)
		m.sendRaw("PROFILE|" + m.myNick + "|" + bio)
		m.profile = bio
		saveProfile(bio)
		m.addLine(styleSys.Render("Profile updated for " + m.myNick + "."))
		return
	}
	if m.profile != "" {
		m.addLine(styleSys.Render("Your profile: " + m.profile))
		return
	}
	if bio := loadProfile(); bio != "" {
		m.profile = bio
		m.addLine(styleSys.Render("Your profile: " + bio))
		return
	}
	m.addLine(styleSys.Render("No profile set. Usage: /profile [your bio]"))
}

func profilePath() string { return filepath.Join(homeDir(), "retro", "profile") }

func loadProfile() string {
	b, err := os.ReadFile(profilePath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func saveProfile(bio string) {
	if err := os.MkdirAll(filepath.Dir(profilePath()), 0o755); err != nil {
		return
	}
	os.WriteFile(profilePath(), []byte(bio+"\n"), 0o644)
}

// cmdWhois looks a user up via GET /api/whois and prints the result.
func (m *model) cmdWhois(rest string) {
	target := strings.TrimSpace(rest)
	if target == "" {
		m.addLine(styleErr.Render("Usage: /whois [nickname]"))
		return
	}
	m.addLine(styleSys.Render("Looking up " + target + "..."))
	go func() {
		httpClient := &http.Client{Timeout: 10 * time.Second}
		reqURL := fmt.Sprintf("%s/api/whois?sID=%s&nick=%s", m.baseURL, m.sessionID, target)
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
		var data struct {
			FirstArrived string `json:"first_arrived"`
			Location     string `json:"location"`
			MessageCount int    `json:"message_count"`
			Profile      string `json:"profile"`
		}
		if err := json.Unmarshal(body, &data); err != nil {
			m.c.recv <- chatMessage{Message: "ECHO|Could not retrieve info for " + target + "."}
			return
		}
		msg := fmt.Sprintf("%s first arrived %s\nFrom %s\n%s has sent %d messages", target, data.FirstArrived, data.Location, target, data.MessageCount)
		if data.Profile != "" {
			msg += fmt.Sprintf("\nSays, %s,\n%s", target, data.Profile)
		}
		m.c.recv <- chatMessage{Message: "ECHO|" + msg}
	}()
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
	case "ROLL":
		if len(parts) < 3 {
			return
		}
		// ROLL|nick|d6 4 — content is "d<sides> <result>".
		fields := strings.Fields(strings.Join(parts[2:], "|"))
		if len(fields) >= 2 {
			m.addLine(styleMsg.Render(parts[1] + ": 🎲 Rolled a " + fields[0] + ": " + fields[1]))
		} else {
			m.addLine(styleMsg.Render(parts[1] + ": 🎲 Rolled a " + strings.Join(parts[2:], "|")))
		}
	case "FLIP":
		if len(parts) < 3 {
			return
		}
		m.addLine(styleMsg.Render(parts[1] + ": 🪙 Coin flip: " + strings.Join(parts[2:], "|")))
	case "IM":
		if len(parts) < 4 {
			return
		}
		sender := parts[1]
		text := strings.Join(parts[3:], "|")
		// An encrypted IM carries "ENC:<level>:<base64>" as its text.
		// Decrypt it with the session id and show it like a normal
		// IM, but green. A bad payload is shown as-is rather than
		// dropped, so a garbled message is visible, not silent.
		if strings.HasPrefix(text, "ENC:") {
			rest := strings.TrimPrefix(text, "ENC:")
			if i := strings.Index(rest, ":"); i > 0 {
				if level, err := strconv.Atoi(rest[:i]); err == nil {
					if plain, ok := encDecrypt(rest[i+1:], m.sessionID, level); ok {
						m.addLine(styleEnc.Render("IM from " + sender + ": " + plain))
						return
					}
				}
			}
		}
		m.addLine(styleOwn.Render("IM from " + sender + ": " + text))
	case "MAIL":
		// MAIL|SENDER|RECIPIENT|...CONTENT...|ENC_FLAG|READ_STATUS.
		// Expand it like the JS client ("[Mail from cc]: ?") instead
		// of showing the raw pipe string. The content is everything
		// from index 3 up to the last two parts, re-joined, so a
		// message containing | survives.
		if len(parts) < 4 {
			return
		}
		sender := parts[1]
		end := len(parts) - 2
		if end < 3 {
			end = len(parts)
		}
		content := strings.Join(parts[3:end], "|")
		// A hex flag means the content is encoded; decode it before
		// showing it, so hex mail reads plain on this client too.
		// An unknown flag is shown as-is.
		if len(parts) >= 2 {
			if flag := parts[len(parts)-2]; flag == "x" || flag == "rx" || flag == "xx" || flag == "xr" {
				content = mailDecrypt(flag, content)
			}
		}
		m.addLine(styleMsg.Render("[Mail from " + sender + "]: " + content))
	case "WELCOME":
		if len(parts) > 1 && parts[1] != "" {
			m.online = strings.Split(parts[1], ",")
		} else {
			m.online = nil
		}
		// The server re-broadcasts WELCOME every 30s as a roster
		// resync. Only print the "* Online" line the first time;
		// later ones just update the list silently or the chat would
		// fill with a roster line every 30 seconds.
		if !quiet && !m.welcomed {
			m.welcomed = true
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
