// rt — RetroTerm-compatible terminal client for VSMS, in Go.
// ws.go: the VSMS WebSocket protocol client.
//
// The wire protocol (verified against client/public/RetroTerm/client.js
// and server/main.go):
//   - Connect: wss://<host>/api/ws?sID=<session id>
//   - Server sends HANDSHAKE_CHALLENGE with a 32-char token.
//   - Client answers HANDSHAKE_RESPONSE with a random 13-char slice of it.
//   - Server sends HANDSHAKE_VERIFIED.
//   - Client sends NICK with its nickname.
//   - Server sends REGISTERED with the final nickname (WELCOME can land
//     before REGISTERED; it is buffered, not dropped).
//   - After that, everything is a JSON ChatMessage {session_id, message,
//     timestamp} whose message field is pipe-delimited:
//     MSG|sender|text, IM|sender|recipient|text,
//     WELCOME|user1,user2, JOIN|nick, PART|nick, NICK_UPDATE|old|new,
//     PEER|sender|recipient|kind|payload, and so on.
//   - The client sends pipe-delimited plain strings: MSG|nick|text,
//     IM|nick|recipient|text|id, MAIL|nick|recipient|text||U,
//     NICK|nick|newName, PEER|nick|recipient|kind|payload, PING|nick.
//   - Heartbeat: PING|nick every 30s; the server answers PONG.
package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// chatMessage is the JSON envelope the server sends for every chat event.
// Timestamp is kept raw: the server marshals time.Time, but history rows
// can carry other shapes, and v1 does not display times.
type chatMessage struct {
	SessionID string          `json:"session_id"`
	Message   string          `json:"message"`
	Timestamp json.RawMessage `json:"timestamp"`
}

// hsEnvelope is a handshake JSON object: type + payload. The payload is
// a string for challenge/response/verified/nick, and an object for
// REGISTERED, so it is decoded in two steps.
type hsEnvelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type registeredPayload struct {
	Nickname string `json:"nickname"`
}

type client struct {
	conn      *websocket.Conn
	sessionID string
	mu        sync.Mutex // guards writes
	recv      chan chatMessage
	errCh     chan error
}

// randomSlice returns a random 13-char substring of token (32 chars).
// That is the whole handshake answer: the server only checks that the
// 13 chars appear inside the token it sent.
func randomSlice(token string) string {
	if len(token) < 13 {
		return token
	}
	maxStart := len(token) - 13
	n, err := rand.Int(rand.Reader, big.NewInt(int64(maxStart+1)))
	if err != nil {
		return token[:13]
	}
	start := int(n.Int64())
	return token[start : start+13]
}

func (c *client) sendText(s string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteMessage(websocket.TextMessage, []byte(s))
}

func (c *client) sendJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.sendText(string(b))
}

// readLoop reads ChatMessages and pushes them to recv. Any read error
// goes to errCh and ends the loop.
func (c *client) readLoop() {
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			c.errCh <- err
			return
		}
		var cm chatMessage
		if err := json.Unmarshal(data, &cm); err != nil {
			continue
		}
		if cm.Message == "" {
			continue
		}
		c.recv <- cm
	}
}

func (c *client) close() {
	c.conn.Close()
}

// connect dials the WS endpoint, runs the handshake, registers nick, and
// returns the client, the final nickname the server assigned, and any
// chat messages that arrived early (WELCOME can land before REGISTERED).
func connect(wsURL, nick string) (*client, string, []chatMessage, error) {
	// ProxyFromEnvironment is the standard Go behaviour: a proxy is
	// used only when the environment defines one (HTTPS_PROXY and
	// friends). On a direct connection it dials straight, as on the
	// VPS and the phone.
	dialer := websocket.Dialer{
		// 30s: the handshake is one HTTP upgrade, but a slow proxy
		// or a weak phone connection can make 15s tight.
		HandshakeTimeout: 30 * time.Second,
		Proxy:            http.ProxyFromEnvironment,
	}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return nil, "", nil, fmt.Errorf("dial %s: %w", wsURL, err)
	}
	c := &client{conn: conn, recv: make(chan chatMessage, 64), errCh: make(chan error, 1)}
	if u, err := url.Parse(wsURL); err == nil {
		c.sessionID = u.Query().Get("sID")
	}

	// 1. Expect HANDSHAKE_CHALLENGE.
	var env hsEnvelope
	if err := conn.ReadJSON(&env); err != nil {
		conn.Close()
		return nil, "", nil, fmt.Errorf("read challenge: %w", err)
	}
	if env.Type != "HANDSHAKE_CHALLENGE" {
		conn.Close()
		return nil, "", nil, fmt.Errorf("expected HANDSHAKE_CHALLENGE, got %s", env.Type)
	}
	var token string
	if err := json.Unmarshal(env.Payload, &token); err != nil {
		conn.Close()
		return nil, "", nil, fmt.Errorf("bad challenge payload: %w", err)
	}

	// 2. Answer with a random 13-char slice of the token.
	if err := c.sendJSON(map[string]string{"type": "HANDSHAKE_RESPONSE", "payload": randomSlice(token)}); err != nil {
		conn.Close()
		return nil, "", nil, fmt.Errorf("send handshake response: %w", err)
	}

	// 3. Expect HANDSHAKE_VERIFIED.
	if err := conn.ReadJSON(&env); err != nil {
		conn.Close()
		return nil, "", nil, fmt.Errorf("read verified: %w", err)
	}
	if env.Type != "HANDSHAKE_VERIFIED" {
		conn.Close()
		return nil, "", nil, fmt.Errorf("expected HANDSHAKE_VERIFIED, got %s", env.Type)
	}

	// 4. Send NICK.
	if err := c.sendJSON(map[string]string{"type": "NICK", "payload": nick}); err != nil {
		conn.Close()
		return nil, "", nil, fmt.Errorf("send nick: %w", err)
	}

	// 5. Wait for REGISTERED, buffering any ChatMessages that arrive
	// early (WELCOME can land first; the JS client passes those on
	// instead of closing, so do the same).
	var early []chatMessage
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			conn.Close()
			return nil, "", nil, fmt.Errorf("read registered: %w", err)
		}
		var e hsEnvelope
		if err := json.Unmarshal(data, &e); err == nil && e.Type == "REGISTERED" {
			var rp registeredPayload
			if err := json.Unmarshal(e.Payload, &rp); err != nil {
				conn.Close()
				return nil, "", nil, fmt.Errorf("bad registered payload: %w", err)
			}
			go c.readLoop()
			return c, rp.Nickname, early, nil
		}
		var cm chatMessage
		if err := json.Unmarshal(data, &cm); err == nil && cm.Message != "" {
			early = append(early, cm)
			continue
		}
		// Unknown frame: ignore and keep waiting.
	}
}
