# rt — RetroTerm terminal client for VSMS

A terminal client for VSMS that speaks the same protocol as the
RetroTerm web client, in Go. Runs in xterm and in real Termux.

Build:

    cd client/public/go
    go build -o rt .

Run:

    ./rt 'https://vsms.gameshiponline.com/rt/?sID=...'

The URL is only used for its host and its sID. The nickname is
remembered in `~/retro/nick` and reused across sessions.

## What works (v1)

- Text chat, public messages, IMs, mail, emotes, echo.
- History for the last 15 minutes on connect.
- Live row at the top: the people in the room. Click a name (or Tab
  to the row, arrows, Enter) and a menu opens. Picking an item only
  composes text into the input, the same compose-only rule as the
  web client's status bar; nothing sends until you press Enter.
  - Private/instant message composes `!Name, `
  - Mail/message composes `@Name, `
  - Image composes `>Name, image`
- Mouse reporting (SGR) for the row and the menu; keyboard works
  alongside it, because tapping small names on a phone is fiddly.
- Heartbeat (PING every 30s), nickname change (`/name`), random
  nickname on an empty `/name`, `/whoami`, `/alone`, `/time`,
  `/history`, `/invite`, `/help`, `/quit`.
- `/name` and `/whoami` and the room list update live on JOIN, PART
  and NICK_UPDATE.

## What does not work yet (v1)

- Peer-to-peer. Picking Image in the menu composes the text, but
  running the macro prints `I'm sorry Dave: peer-to-peer services
  aren't implemented in this client (yet).` and sends nothing.
  Incoming file requests are declined at once, so the sender is told
  promptly instead of waiting out the 80-second accept window.
  Receiving images into `~/retro/imgs/` is the full version and
  needs WebRTC (pion/webrtc).
- Audio-only and video calls are not built, the same as the web
  client's status bar, which leaves those out too.
- No timestamps on messages yet; no `/whois`, `/review`, `/profile`.

## Files

- `main.go` — entry point, URL parsing, nickname memory, history.
- `ws.go` — the WebSocket protocol: handshake, registration,
  send/receive.
- `ui.go` — the bubbletea terminal UI: live row, dropdown, viewport,
  input, status line.
- `commands.go` — input parsing, slash commands, incoming messages,
  the file-request decline.
