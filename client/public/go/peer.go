// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// peer.go: peer-to-peer image transfer over a WebRTC data channel.
// This client both receives (Step 1) and sends (Step 2).
//
// Protocol, matching client/public/RetroTerm/script.js:
//   - STUN stun:stun.l.google.com:19302, no TURN.
//   - Data channel label 'file'. Chunks are raw binary 16 KB; the
//     string 'DONE' ends the transfer.
//   - Signaling payloads (meta, SDP, ICE) are base64url, no padding.
//   - ICE candidates are RTCIceCandidateInit JSON. A candidate that
//     arrives before setRemoteDescription is queued and flushed after
//     (the JS flushPeerIce pattern).
//   - The receiver accepts, never forced: an incoming file request
//     opens a Y/n prompt ("Accept? [Y/n]", Enter is yes) with an
//     80-second timeout, the same as the JS receiver.
//
// Threading: handlePeer runs on the Bubble Tea goroutine, but pion
// callbacks (OnMessage, OnICECandidate, OnClose) run on pion
// goroutines. The incoming/outgoing maps and buffers live behind
// peerState.mu. UI lines are never written from a pion goroutine:
// notices go through m.c.recv as an ECHO, the same path cmdWhois
// uses, so handleIncoming prints them on the Bubble Tea goroutine.
// m.sendRaw is safe from any goroutine (client.sendText has its own
// mutex).
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pion/webrtc/v4"
)

// peerSTUN is the one ICE server, the same as the JS client.
var peerSTUN = []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}

// peerChunkSize is the data-channel chunk size, the same as the JS
// client's PEER_CHUNK_SIZE. peerMaxBuffered is the pause threshold,
// the same as the JS client's 256 KB check.
const (
	peerChunkSize   = 16384
	peerMaxBuffered = 256 * 1024
)

// peerPromptTimeout is the accept window for an incoming image, the
// same as the JS receiver's PEER_ACCEPT_TIMEOUT_MS.
const peerPromptTimeout = 80 * time.Second

// peerPromptTimeoutMsg fires when an incoming-image prompt is still
// unanswered after peerPromptTimeout. The seq guards against a stale
// timer declining a newer prompt for the same sender.
type peerPromptTimeoutMsg struct {
	sender string
	seq    int
}

// peerState holds the in-progress file transfers, both directions.
// It's a pointer on the model so Bubble Tea's value-copy of the model
// still shares one mutex and map.
type peerState struct {
	mu  sync.Mutex
	in  map[string]*peerIncoming // keyed by sender, lowercased
	out map[string]*peerOutgoing // keyed by recipient, lowercased
}

// peerIncoming is one incoming file transfer (this client receives).
type peerIncoming struct {
	sender     string // the peer's nick, as sent
	myNick     string // our nick, captured when the transfer started
	meta       peerFileMeta
	pc         *webrtc.PeerConnection
	buf        bytes.Buffer
	pendingIce []webrtc.ICECandidateInit
	remoteSet  bool
	accepted   bool      // true once the user answered yes to the prompt
	acceptedAt time.Time // when the user said yes; the pending-receive record
	done       bool
	lastPct    int // last progress quartile printed (0, 25, 50, 75)
}

// peerOutgoing is one outgoing file transfer (this client sends).
type peerOutgoing struct {
	recipient  string // the peer's nick, as typed
	myNick     string // our nick, captured when the transfer started
	meta       peerFileMeta
	data       []byte
	pc         *webrtc.PeerConnection
	dc         *webrtc.DataChannel
	pendingIce []webrtc.ICECandidateInit
	remoteSet  bool
	done       bool
	lastPct    int // last progress quartile printed (0, 25, 50, 75)
}

func newPeerState() *peerState {
	return &peerState{
		in:  make(map[string]*peerIncoming),
		out: make(map[string]*peerOutgoing),
	}
}

// peerMetaInfo renders a meta as "name — size (WxH)", the dims only
// when both are known.
func peerMetaInfo(meta peerFileMeta) string {
	info := fmt.Sprintf("%s — %s", meta.Name, formatSize(meta.Size))
	if meta.Width > 0 && meta.Height > 0 {
		info += fmt.Sprintf(" (%dx%d)", meta.Width, meta.Height)
	}
	return info
}

// peerFileAccept handles PEER|sender|me|file|<b64url meta>. The
// request is NOT auto-accepted: it opens a Y/n prompt ("Accept?
// [Y/n]", Enter is yes) with an 80-second timeout, the same as the
// JS receiver. One prompt at a time — a second request while one is
// pending is declined at once. Returns the timeout command, or nil.
func (m *model) peerFileAccept(sender, payload string) tea.Cmd {
	var meta peerFileMeta
	if payload != "" {
		if raw, err := base64.RawURLEncoding.DecodeString(payload); err == nil {
			json.Unmarshal(raw, &meta)
		}
	}
	if meta.Name == "" {
		m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
		return nil
	}
	if m.promptSender != "" {
		m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
		m.addLine(styleSys.Render("Declined image from " + sender + " (an image prompt is already pending)."))
		return nil
	}
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	if _, exists := m.peer.in[key]; exists {
		m.peer.mu.Unlock()
		m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
		return nil
	}
	m.peer.in[key] = &peerIncoming{sender: sender, myNick: m.myNick, meta: meta}
	m.peer.mu.Unlock()
	m.promptSender = sender
	m.promptSeq++
	seq := m.promptSeq
	m.addLine(styleSys.Render(sender + " wants to send an image: " + peerMetaInfo(meta)))
	m.addLine(styleSys.Render("Accept? [Y/n]"))
	return tea.Tick(peerPromptTimeout, func(t time.Time) tea.Msg {
		return peerPromptTimeoutMsg{sender: sender, seq: seq}
	})
}

// peerPromptAccept answers the pending image prompt with yes: the
// sender gets PEER|accept|, the entry is marked accepted, and the
// rest of the receive flow (offer/answer/ICE/chunks) proceeds.
// Accepting also records the pending receive (sender, file, size,
// time) on the entry, so that if the transfer ends without saving,
// the client can close the loop and say so instead of going silent.
func (m *model) peerPromptAccept() {
	sender := m.promptSender
	if sender == "" {
		return
	}
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	entry, ok := m.peer.in[key]
	if ok {
		entry.accepted = true
		entry.acceptedAt = time.Now()
	}
	m.peer.mu.Unlock()
	m.promptSender = ""
	if !ok {
		return
	}
	m.sendRaw("PEER|" + m.myNick + "|" + sender + "|accept|")
	m.addLine(styleSys.Render("Receiving image from " + sender + ": " + peerMetaInfo(entry.meta)))
}

// peerPromptDecline answers the pending image prompt with no.
func (m *model) peerPromptDecline() {
	sender := m.promptSender
	if sender == "" {
		return
	}
	m.promptSender = ""
	m.peerDrop(sender)
	m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
	m.addLine(styleSys.Render("Declined image from " + sender + "."))
}

// peerPromptTimeout declines a prompt that is still unanswered after
// the accept window. A stale timer (an older seq, or a prompt that
// was already answered) does nothing.
func (m *model) peerPromptTimeout(sender string, seq int) {
	if m.promptSender == "" || !strings.EqualFold(m.promptSender, sender) || seq != m.promptSeq {
		return
	}
	m.promptSender = ""
	m.peerDrop(sender)
	m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
	m.addLine(styleSys.Render("Image from " + sender + " declined (no answer)."))
}

// peerOffer handles PEER|sender|me|offer|<b64url SDP>. Only an entry
// the user accepted proceeds — an offer for a prompt still pending
// is ignored. The SDP exchange runs in a goroutine so the chat
// stays responsive.
func (m *model) peerOffer(sender, payload string) {
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	entry, ok := m.peer.in[key]
	if !ok || entry.pc != nil || !entry.accepted {
		m.peer.mu.Unlock()
		return
	}
	m.peer.mu.Unlock()
	go m.peerRunOffer(entry, key, payload)
}

// peerRunOffer creates the peer connection, answers the offer, and
// sends the answer back. ICE candidates that arrived before the
// remote description was set are flushed after it.
func (m *model) peerRunOffer(entry *peerIncoming, key, payload string) {
	sdpBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		m.peerCleanup(key, entry)
		return
	}
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: peerSTUN})
	if err != nil {
		m.peerCleanup(key, entry)
		return
	}
	m.peer.mu.Lock()
	if cur, ok := m.peer.in[key]; !ok || cur != entry {
		m.peer.mu.Unlock()
		pc.Close()
		return
	}
	entry.pc = pc
	m.peer.mu.Unlock()

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		raw, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		m.sendRaw("PEER|" + entry.myNick + "|" + entry.sender + "|ice|" + base64.RawURLEncoding.EncodeToString(raw))
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != "file" {
			return
		}
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			m.peerDataMessage(entry, key, msg)
		})
		dc.OnClose(func() {
			m.peerCleanup(key, entry)
		})
	})

	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: string(sdpBytes)}); err != nil {
		m.peerCleanup(key, entry)
		pc.Close()
		return
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		m.peerCleanup(key, entry)
		pc.Close()
		return
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		m.peerCleanup(key, entry)
		pc.Close()
		return
	}
	m.peer.mu.Lock()
	entry.remoteSet = true
	queued := entry.pendingIce
	entry.pendingIce = nil
	m.peer.mu.Unlock()
	for _, cand := range queued {
		pc.AddICECandidate(cand)
	}
	m.sendRaw("PEER|" + entry.myNick + "|" + entry.sender + "|answer|" + base64.RawURLEncoding.EncodeToString([]byte(answer.SDP)))
}

// peerIce handles PEER|sender|me|ice|<b64url JSON>: add the candidate,
// or queue it when the remote description isn't set yet. Incoming
// first, then outgoing, the same order as the JS handlePeerIce.
func (m *model) peerIce(sender, payload string) {
	key := strings.ToLower(sender)
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return
	}
	var cand webrtc.ICECandidateInit
	if err := json.Unmarshal(raw, &cand); err != nil {
		return
	}
	m.peer.mu.Lock()
	if entry, ok := m.peer.in[key]; ok {
		if entry.remoteSet && entry.pc != nil {
			pc := entry.pc
			m.peer.mu.Unlock()
			pc.AddICECandidate(cand)
			return
		}
		entry.pendingIce = append(entry.pendingIce, cand)
		m.peer.mu.Unlock()
		return
	}
	if entry, ok := m.peer.out[key]; ok {
		if entry.remoteSet && entry.pc != nil {
			pc := entry.pc
			m.peer.mu.Unlock()
			pc.AddICECandidate(cand)
			return
		}
		entry.pendingIce = append(entry.pendingIce, cand)
		m.peer.mu.Unlock()
		return
	}
	m.peer.mu.Unlock()
}

// peerDataMessage handles one data-channel message: binary chunks
// append to the buffer; the string 'DONE' finishes the transfer.
func (m *model) peerDataMessage(entry *peerIncoming, key string, msg webrtc.DataChannelMessage) {
	// A string DONE can arrive as binary (PPID 53) from some senders
	// (the browser). Recognize it by content, not only by IsString,
	// or the save never runs and the transfer ends silently. A real
	// image chunk that is exactly the 4 bytes "DONE" is a negligible
	// risk — chunks are 16 KB.
	if string(msg.Data) == "DONE" {
		m.peerFinish(entry, key)
		return
	}
	if msg.IsString {
		return
	}
	m.peer.mu.Lock()
	var crossed int
	var have int64
	if cur, ok := m.peer.in[key]; ok && cur == entry && !entry.done {
		entry.buf.Write(msg.Data)
		if entry.meta.Size > 0 {
			have = int64(entry.buf.Len())
			pct := int(have * 100 / entry.meta.Size)
			for _, q := range []int{25, 50, 75} {
				if entry.lastPct < q && pct >= q {
					crossed = q
				}
			}
			if crossed > 0 {
				entry.lastPct = crossed
			}
		}
	}
	m.peer.mu.Unlock()
	// Receive progress, mirroring the sender's 25/50/75% milestones:
	// without it a stalled receive is silent and the user cannot tell
	// it apart from a working one. Only the milestones print, once
	// each, never one line per chunk.
	if crossed > 0 {
		m.peerNotice(fmt.Sprintf("Receiving image from %s… %d%% (%s of %s)", entry.sender, crossed, formatSize(have), formatSize(entry.meta.Size)))
	}
}

// peerFinish saves the received bytes to ~/retro/imgs/<name> and
// prints where it landed. The save is driven by the entry itself,
// not by the entry still being in the map: the data channel's
// OnClose (peerCleanup) runs on a different pion goroutine from
// OnMessage, and the sender closes ~1s after DONE, so OnClose can
// win the race and drop the entry before DONE is processed. The
// old code gated the save on the map lookup, so when OnClose won
// the file was silently lost — no save, no notice, no error. The
// accepted flag is the guard instead: only a transfer the user
// said yes to can save (an offer for a non-accepted entry is
// ignored in peerOffer, so DONE can only arrive for an accepted
// one). entry.done, set under the lock, is the idempotency guard,
// so a duplicate DONE never saves twice. The image itself is never
// displayed in the TUI.
func (m *model) peerFinish(entry *peerIncoming, key string) {
	m.peer.mu.Lock()
	if entry.done || !entry.accepted {
		m.peer.mu.Unlock()
		return
	}
	entry.done = true
	data := append([]byte(nil), entry.buf.Bytes()...)
	meta := entry.meta
	sender := entry.sender
	pc := entry.pc
	// Best-effort map removal: the entry may already have been
	// dropped by peerCleanup (OnClose racing DONE). That must not
	// lose the file — the snapshot above is authoritative.
	if cur, ok := m.peer.in[key]; ok && cur == entry {
		delete(m.peer.in, key)
	}
	m.peer.mu.Unlock()
	m.peerSaveFile(data, meta, sender, pc)
}

// peerSaveFile writes data to ~/retro/imgs/<name> and prints the
// result. It takes a snapshot (data, meta, sender, pc) so it never
// touches the peer maps — the caller snapshots under peerState.mu
// first. A failure prints a peerNotice error; success prints where
// the image landed.
func (m *model) peerSaveFile(data []byte, meta peerFileMeta, sender string, pc *webrtc.PeerConnection) {
	name := filepath.Base(meta.Name)
	if name == "" || name == "." || name == "/" {
		name = fmt.Sprintf("image-%d", time.Now().Unix())
	}
	home, err := os.UserHomeDir()
	if err != nil {
		m.peerNotice("Image from " + sender + " could not be saved (no home directory).")
		if pc != nil {
			pc.Close()
		}
		return
	}
	dir := filepath.Join(home, "retro", "imgs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		m.peerNotice("Image from " + sender + " could not be saved (" + name + ").")
		if pc != nil {
			pc.Close()
		}
		return
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
		m.peerNotice("Image from " + sender + " could not be saved (" + name + ").")
		if pc != nil {
			pc.Close()
		}
		return
	}
	if pc != nil {
		pc.Close()
	}
	m.peerNotice("Image from " + sender + " saved to ~/retro/imgs/" + name + " (" + formatSize(int64(len(data))) + ")")
}

// peerNotice prints a line via the ECHO path, so it runs on the Bubble
// Tea goroutine even when called from a pion callback.
func (m *model) peerNotice(text string) {
	if m.c == nil {
		return
	}
	m.c.recv <- chatMessage{Message: "ECHO|" + text}
}

// peerCleanup closes the peer connection (if any) and drops the
// incoming entry, but only if the entry in the map is still this
// one — a newer transfer from the same sender must not be clobbered.
// If the whole file already arrived (buffer length >= meta size)
// but DONE never landed — the channel closed before a queued DONE
// was dispatched, so peerFinish never ran — the file is complete,
// so save it instead of dropping it. That is the other half of
// the OnClose/DONE race: OnClose winning must not lose a finished
// transfer, whether DONE was processed first or never arrived.
// The snapshot is truncated to the declared size, so a DONE that
// arrived as binary (4 stray bytes in the buffer) or any other
// extra byte neither blocks the save nor corrupts the file.
// An incomplete transfer (buffer short of meta size, or a zero
// size) is still dropped with no save, as before — but if the user
// had already accepted it, the drop is no longer silent: the
// client prints "Did not save …", closing the loop on the file the
// user agreed to receive. Marking the entry done when the notice
// fires stops a late DONE from saving a truncated file afterwards.
func (m *model) peerCleanup(key string, entry *peerIncoming) {
	var pc *webrtc.PeerConnection
	var save []byte
	var meta peerFileMeta
	var sender string
	var unsaved bool
	m.peer.mu.Lock()
	if cur, ok := m.peer.in[key]; ok && cur == entry {
		delete(m.peer.in, key)
		pc = entry.pc
		if !entry.done && entry.accepted && entry.meta.Size > 0 && entry.buf.Len() >= int(entry.meta.Size) {
			entry.done = true
			save = append([]byte(nil), entry.buf.Bytes()[:entry.meta.Size]...)
			meta = entry.meta
			sender = entry.sender
		} else if entry.accepted && !entry.done {
			// Accepted but never saved: the transfer ended
			// (channel closed, or the offer failed) with an
			// incomplete buffer. Remember the file and say so.
			entry.done = true
			meta = entry.meta
			sender = entry.sender
			unsaved = true
		}
	}
	m.peer.mu.Unlock()
	if save != nil {
		m.peerSaveFile(save, meta, sender, pc)
		return
	}
	if pc != nil {
		pc.Close()
	}
	if unsaved {
		m.peerNotice("Did not save " + peerMetaInfo(meta) + " from " + sender + " — the transfer did not complete.")
	}
}

// peerDrop ends the incoming transfer from sender (decline or bye
// from the peer): close the connection if any and delete the entry.
// If a prompt was pending for this sender, it is cleared and the
// user is told the send was cancelled. If the user had already
// accepted and the file never saved, the drop is not silent either:
// the client prints "Did not save …" for the file it agreed to
// receive. A decline or a prompt timeout never reaches that branch
// (accepted is false there), so the decline notices stay the only
// line for those. Marking the entry done when the notice fires
// stops a late DONE from saving a truncated file afterwards.
func (m *model) peerDrop(sender string) {
	key := strings.ToLower(sender)
	var pc *webrtc.PeerConnection
	var meta peerFileMeta
	var unsaved bool
	m.peer.mu.Lock()
	if entry, ok := m.peer.in[key]; ok {
		delete(m.peer.in, key)
		pc = entry.pc
		if entry.accepted && !entry.done {
			entry.done = true
			meta = entry.meta
			unsaved = true
		}
	}
	m.peer.mu.Unlock()
	if pc != nil {
		pc.Close()
	}
	if m.promptSender != "" && strings.EqualFold(m.promptSender, sender) {
		m.promptSender = ""
		m.addLine(styleSys.Render("Image from " + sender + " cancelled."))
	}
	if unsaved {
		m.peerNotice("Did not save " + peerMetaInfo(meta) + " from " + sender + " — the transfer did not complete.")
	}
}

// peerOutDrop drops the outgoing transfer to sender by name, if
// one exists (used when the server reports the peer unavailable).
func (m *model) peerOutDrop(sender string) {
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	entry, ok := m.peer.out[key]
	m.peer.mu.Unlock()
	if ok {
		m.peerOutCleanup(key, entry)
	}
}

// peerOutCleanup closes the peer connection (if any) and drops the
// outgoing entry, but only if the entry in the map is still this
// one.
func (m *model) peerOutCleanup(key string, entry *peerOutgoing) {
	var pc *webrtc.PeerConnection
	m.peer.mu.Lock()
	if cur, ok := m.peer.out[key]; ok && cur == entry {
		delete(m.peer.out, key)
		pc = entry.pc
	}
	m.peer.mu.Unlock()
	if pc != nil {
		pc.Close()
	}
}

// peerDecline handles PEER|sender|me|decline|: the recipient turned
// down our image. The outgoing entry is dropped. A decline for a
// transfer we never started prints nothing.
func (m *model) peerDecline(sender string) {
	key := strings.ToLower(sender)
	var pc *webrtc.PeerConnection
	m.peer.mu.Lock()
	entry, ok := m.peer.out[key]
	if ok {
		delete(m.peer.out, key)
		pc = entry.pc
	}
	m.peer.mu.Unlock()
	if !ok {
		return
	}
	if pc != nil {
		pc.Close()
	}
	m.addLine(styleSys.Render(sender + " declined your image."))
}

// peerBye handles PEER|sender|me|bye|: the peer ended the transfer.
// Incoming is dropped (and a pending prompt for them is cleared by
// peerDrop); outgoing is dropped with a line, the same as the JS
// handlePeerBye.
func (m *model) peerBye(sender string) {
	m.peerDrop(sender)
	key := strings.ToLower(sender)
	var pc *webrtc.PeerConnection
	m.peer.mu.Lock()
	entry, ok := m.peer.out[key]
	if ok {
		delete(m.peer.out, key)
		pc = entry.pc
	}
	m.peer.mu.Unlock()
	if !ok {
		return
	}
	if pc != nil {
		pc.Close()
	}
	m.addLine(styleSys.Render("Peer connection to " + sender + " ended."))
}

// peerImageMIME maps a file extension to the MIME type the meta
// carries. The JS receiver renders the blob with this type, so svg
// must be image/svg+xml, not image/svg.
var peerImageMIME = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
}

var (
	svgWidthRe   = regexp.MustCompile(`(?i)\bwidth\s*=\s*"(\d+)`)
	svgHeightRe  = regexp.MustCompile(`(?i)\bheight\s*=\s*"(\d+)`)
	svgViewBoxRe = regexp.MustCompile(`(?i)\bviewBox\s*=\s*"[0-9.\-]+\s+[0-9.\-]+\s+(\d+)\s+(\d+)"`)
)

// peerSVGDimensions reads width/height (or the viewBox) out of an
// SVG's head. Only the first 4 KB can carry these attributes.
func peerSVGDimensions(data []byte) (int, int) {
	head := data
	if len(head) > 4096 {
		head = head[:4096]
	}
	w, h := 0, 0
	if mm := svgWidthRe.FindSubmatch(head); mm != nil {
		w, _ = strconv.Atoi(string(mm[1]))
	}
	if mm := svgHeightRe.FindSubmatch(head); mm != nil {
		h, _ = strconv.Atoi(string(mm[1]))
	}
	if w == 0 || h == 0 {
		if mm := svgViewBoxRe.FindSubmatch(head); mm != nil {
			vw, _ := strconv.Atoi(string(mm[1]))
			vh, _ := strconv.Atoi(string(mm[2]))
			if w == 0 {
				w = vw
			}
			if h == 0 {
				h = vh
			}
		}
	}
	return w, h
}

// peerImageDimensions returns width/height for the meta: png/jpg via
// image.DecodeConfig, svg by parsing, and 0,0 for anything else
// (webp included — the JS sender falls back to 0,0 the same way,
// and the receiver tolerates it).
func peerImageDimensions(ext string, data []byte) (int, int) {
	switch ext {
	case ".png", ".jpg", ".jpeg":
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return 0, 0
		}
		return cfg.Width, cfg.Height
	case ".svg":
		return peerSVGDimensions(data)
	}
	return 0, 0
}

// peerSendStart reads the picked file and starts an outgoing
// transfer: the meta goes out as a PEER file request, and the
// WebRTC offer follows when the recipient accepts. One outgoing
// transfer per recipient at a time.
func (m *model) peerSendStart(recipient, path string) {
	key := strings.ToLower(recipient)
	m.peer.mu.Lock()
	if _, exists := m.peer.out[key]; exists {
		m.peer.mu.Unlock()
		m.addLine(styleErr.Render("Already sending an image to " + recipient + ". Wait for it to finish."))
		return
	}
	m.peer.mu.Unlock()
	data, err := os.ReadFile(path)
	if err != nil {
		m.addLine(styleErr.Render("Could not read " + path + ": " + err.Error()))
		return
	}
	ext := strings.ToLower(filepath.Ext(path))
	mimeType, ok := peerImageMIME[ext]
	if !ok {
		mimeType = "image/*"
	}
	w, h := peerImageDimensions(ext, data)
	meta := peerFileMeta{
		Name:   filepath.Base(path),
		Size:   int64(len(data)),
		Type:   mimeType,
		Width:  w,
		Height: h,
	}
	entry := &peerOutgoing{recipient: recipient, myNick: m.myNick, meta: meta, data: data}
	m.peer.mu.Lock()
	if _, exists := m.peer.out[key]; exists {
		m.peer.mu.Unlock()
		m.addLine(styleErr.Render("Already sending an image to " + recipient + ". Wait for it to finish."))
		return
	}
	m.peer.out[key] = entry
	m.peer.mu.Unlock()
	raw, _ := json.Marshal(meta)
	m.sendRaw("PEER|" + m.myNick + "|" + recipient + "|file|" + base64.RawURLEncoding.EncodeToString(raw))
	m.addLine(styleSys.Render("Waiting for " + recipient + " to accept your image (" + meta.Name + ", " + formatSize(meta.Size) + ")…"))
}

// peerAccept handles PEER|recipient|me|accept|: the recipient said
// yes, so build the peer connection and offer, the mirror of the JS
// handlePeerAccept.
func (m *model) peerAccept(recipient, payload string) {
	key := strings.ToLower(recipient)
	m.peer.mu.Lock()
	entry, ok := m.peer.out[key]
	if !ok || entry.pc != nil {
		m.peer.mu.Unlock()
		return
	}
	m.peer.mu.Unlock()
	go m.peerRunAccept(entry, key)
}

// peerRunAccept creates the peer connection and data channel, offers,
// and sends the offer back. The data channel opens the chunk send.
func (m *model) peerRunAccept(entry *peerOutgoing, key string) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: peerSTUN})
	if err != nil {
		m.peerOutCleanup(key, entry)
		return
	}
	m.peer.mu.Lock()
	if cur, ok := m.peer.out[key]; !ok || cur != entry {
		m.peer.mu.Unlock()
		pc.Close()
		return
	}
	entry.pc = pc
	m.peer.mu.Unlock()

	dc, err := pc.CreateDataChannel("file", nil)
	if err != nil {
		m.peerOutCleanup(key, entry)
		pc.Close()
		return
	}
	m.peer.mu.Lock()
	if cur, ok := m.peer.out[key]; ok && cur == entry {
		entry.dc = dc
	}
	m.peer.mu.Unlock()
	dc.OnOpen(func() {
		go m.peerSendChunks(entry, key)
	})
	dc.OnClose(func() {
		m.peerOutCleanup(key, entry)
	})
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		raw, err := json.Marshal(c.ToJSON())
		if err != nil {
			return
		}
		m.sendRaw("PEER|" + entry.myNick + "|" + entry.recipient + "|ice|" + base64.RawURLEncoding.EncodeToString(raw))
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		m.peerOutCleanup(key, entry)
		pc.Close()
		return
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		m.peerOutCleanup(key, entry)
		pc.Close()
		return
	}
	m.sendRaw("PEER|" + entry.myNick + "|" + entry.recipient + "|offer|" + base64.RawURLEncoding.EncodeToString([]byte(offer.SDP)))
	m.peerNotice("Sending image to " + entry.recipient + "…")
}

// peerAnswer handles PEER|recipient|me|answer|<b64url SDP>: set the
// remote description and flush queued ICE, the mirror of the JS
// handlePeerAnswer.
func (m *model) peerAnswer(recipient, payload string) {
	key := strings.ToLower(recipient)
	m.peer.mu.Lock()
	entry, ok := m.peer.out[key]
	if !ok || entry.pc == nil {
		m.peer.mu.Unlock()
		return
	}
	m.peer.mu.Unlock()
	go m.peerRunAnswer(entry, key, payload)
}

func (m *model) peerRunAnswer(entry *peerOutgoing, key, payload string) {
	sdpBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return
	}
	m.peer.mu.Lock()
	pc := entry.pc
	if cur, ok := m.peer.out[key]; !ok || cur != entry || pc == nil {
		m.peer.mu.Unlock()
		return
	}
	m.peer.mu.Unlock()
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(sdpBytes)}); err != nil {
		return
	}
	m.peer.mu.Lock()
	entry.remoteSet = true
	queued := entry.pendingIce
	entry.pendingIce = nil
	m.peer.mu.Unlock()
	for _, cand := range queued {
		pc.AddICECandidate(cand)
	}
}

// peerSendChunks sends the file over the open data channel in raw
// binary 16 KB chunks, pausing when more than 256 KB is buffered,
// the mirror of the JS sendPeerFileChunks. A 'DONE' string ends it.
// Progress prints at each quartile; the final line prints on DONE.
func (m *model) peerSendChunks(entry *peerOutgoing, key string) {
	m.peer.mu.Lock()
	if cur, ok := m.peer.out[key]; !ok || cur != entry || entry.done {
		m.peer.mu.Unlock()
		return
	}
	data := entry.data
	total := int64(len(data))
	dc := entry.dc
	m.peer.mu.Unlock()
	if dc == nil {
		return
	}
	offset := int64(0)
	for offset < total {
		if dc.ReadyState() != webrtc.DataChannelStateOpen {
			return
		}
		if dc.BufferedAmount() > peerMaxBuffered {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		end := offset + peerChunkSize
		if end > total {
			end = total
		}
		if err := dc.Send(data[offset:end]); err != nil {
			m.peerNotice("Failed sending image to " + entry.recipient + ".")
			m.peerOutCleanup(key, entry)
			return
		}
		offset = end
		pct := int(offset * 100 / total)
		m.peer.mu.Lock()
		crossed := 0
		for _, q := range []int{25, 50, 75} {
			if entry.lastPct < q && pct >= q {
				crossed = q
			}
		}
		if crossed > 0 {
			entry.lastPct = crossed
		}
		m.peer.mu.Unlock()
		if crossed > 0 {
			m.peerNotice(fmt.Sprintf("Sending image to %s… %d%% (%s of %s)", entry.recipient, crossed, formatSize(offset), formatSize(total)))
		}
	}
	if dc.ReadyState() != webrtc.DataChannelStateOpen {
		return
	}
	if err := dc.SendText("DONE"); err != nil {
		m.peerNotice("Failed sending image to " + entry.recipient + ".")
		m.peerOutCleanup(key, entry)
		return
	}
	m.peer.mu.Lock()
	entry.done = true
	m.peer.mu.Unlock()
	m.peerNotice("Image sent to " + entry.recipient + " (" + formatSize(total) + ").")
	// Wait for the queued bytes to drain before closing: the tail
	// of the file is still in flight after DONE, and closing on a
	// fixed timer truncates it on a slow uplink. Poll
	// BufferedAmount until it reaches 0 (or the channel closes),
	// capped at ~10 s so a stuck drain cannot hang the send.
	for i := 0; i < 200; i++ {
		if dc.ReadyState() != webrtc.DataChannelStateOpen {
			break
		}
		if dc.BufferedAmount() == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	m.peerOutCleanup(key, entry)
}
