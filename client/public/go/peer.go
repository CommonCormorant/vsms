// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// peer.go: peer-to-peer image RECEIVE over a WebRTC data channel.
// This client is the receiver in v1; the JS client sends. Sending is
// Step 2 and is not here.
//
// Protocol, matching client/public/RetroTerm/script.js:
//   - STUN stun:stun.l.google.com:19302, no TURN.
//   - Data channel label 'file'. Chunks are raw binary 16 KB; the
//     string 'DONE' ends the transfer.
//   - Signaling payloads (meta, SDP, ICE) are base64url, no padding.
//   - ICE candidates are RTCIceCandidateInit JSON. A candidate that
//     arrives before setRemoteDescription is queued and flushed after
//     (the JS flushPeerIce pattern).
//
// Threading: handlePeer runs on the Bubble Tea goroutine, but pion
// callbacks (OnMessage, OnICECandidate, OnClose) run on pion
// goroutines. The incoming map and buffers live behind peerState.mu.
// UI lines are never written from a pion goroutine: the finish notice
// goes through m.c.recv as an ECHO, the same path cmdWhois uses, so
// handleIncoming prints it on the Bubble Tea goroutine. m.sendRaw is
// safe from any goroutine (client.sendText has its own mutex).
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// peerSTUN is the one ICE server, the same as the JS client.
var peerSTUN = []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}

// peerState holds the in-progress incoming file transfers. It's a
// pointer on the model so Bubble Tea's value-copy of the model still
// shares one mutex and map.
type peerState struct {
	mu sync.Mutex
	in map[string]*peerIncoming // keyed by sender, lowercased
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
	done       bool
}

func newPeerState() *peerState {
	return &peerState{in: make(map[string]*peerIncoming)}
}

// peerFileAccept handles PEER|sender|me|file|<b64url meta>: decode the
// meta and auto-accept (v1 has no prompt). One transfer per sender at
// a time; a second one from the same sender is declined.
func (m *model) peerFileAccept(sender, payload string) {
	var meta peerFileMeta
	if payload != "" {
		if raw, err := base64.RawURLEncoding.DecodeString(payload); err == nil {
			json.Unmarshal(raw, &meta)
		}
	}
	if meta.Name == "" {
		m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
		return
	}
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	if _, exists := m.peer.in[key]; exists {
		m.peer.mu.Unlock()
		m.sendRaw("PEER|" + m.myNick + "|" + sender + "|decline|")
		return
	}
	m.peer.in[key] = &peerIncoming{sender: sender, myNick: m.myNick, meta: meta}
	m.peer.mu.Unlock()
	m.sendRaw("PEER|" + m.myNick + "|" + sender + "|accept|")
	info := fmt.Sprintf("%s — %s", meta.Name, formatSize(meta.Size))
	if meta.Width > 0 && meta.Height > 0 {
		info += fmt.Sprintf(" (%dx%d)", meta.Width, meta.Height)
	}
	m.addLine(styleSys.Render("Receiving image from " + sender + ": " + info))
}

// peerOffer handles PEER|sender|me|offer|<b64url SDP>. The SDP exchange
// runs in a goroutine so the chat stays responsive.
func (m *model) peerOffer(sender, payload string) {
	key := strings.ToLower(sender)
	m.peer.mu.Lock()
	entry, ok := m.peer.in[key]
	if !ok || entry.pc != nil {
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
// or queue it when the remote description isn't set yet.
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
	entry, ok := m.peer.in[key]
	if !ok {
		m.peer.mu.Unlock()
		return
	}
	if entry.remoteSet && entry.pc != nil {
		pc := entry.pc
		m.peer.mu.Unlock()
		pc.AddICECandidate(cand)
		return
	}
	entry.pendingIce = append(entry.pendingIce, cand)
	m.peer.mu.Unlock()
}

// peerDataMessage handles one data-channel message: binary chunks
// append to the buffer; the string 'DONE' finishes the transfer.
func (m *model) peerDataMessage(entry *peerIncoming, key string, msg webrtc.DataChannelMessage) {
	if msg.IsString {
		if string(msg.Data) == "DONE" {
			m.peerFinish(entry, key)
		}
		return
	}
	m.peer.mu.Lock()
	if cur, ok := m.peer.in[key]; ok && cur == entry && !entry.done {
		entry.buf.Write(msg.Data)
	}
	m.peer.mu.Unlock()
}

// peerFinish saves the received bytes to ~/retro/imgs/<name> and
// prints where it landed. The entry is dropped first, so a new
// transfer from the same sender can start. The image itself is never
// displayed in the TUI.
func (m *model) peerFinish(entry *peerIncoming, key string) {
	m.peer.mu.Lock()
	if cur, ok := m.peer.in[key]; !ok || cur != entry || entry.done {
		m.peer.mu.Unlock()
		return
	}
	entry.done = true
	data := append([]byte(nil), entry.buf.Bytes()...)
	meta := entry.meta
	sender := entry.sender
	delete(m.peer.in, key)
	pc := entry.pc
	m.peer.mu.Unlock()

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

// peerCleanup closes the peer connection (if any) and drops the entry,
// but only if the entry in the map is still this one — a newer
// transfer from the same sender must not be clobbered.
func (m *model) peerCleanup(key string, entry *peerIncoming) {
	var pc *webrtc.PeerConnection
	m.peer.mu.Lock()
	if cur, ok := m.peer.in[key]; ok && cur == entry {
		delete(m.peer.in, key)
		pc = entry.pc
	}
	m.peer.mu.Unlock()
	if pc != nil {
		pc.Close()
	}
}

// peerDrop ends the transfer from sender (decline or bye from the
// peer): close the connection if any and delete the entry.
func (m *model) peerDrop(sender string) {
	key := strings.ToLower(sender)
	var pc *webrtc.PeerConnection
	m.peer.mu.Lock()
	if entry, ok := m.peer.in[key]; ok {
		delete(m.peer.in, key)
		pc = entry.pc
	}
	m.peer.mu.Unlock()
	if pc != nil {
		pc.Close()
	}
}
