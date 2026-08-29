# RetroTerm Terminal Client (`client/public/RetroTerm`)

## 1. Purpose
`RetroTerm` is the core user interface of VSMS. It is a retro-styled chat terminal providing real-time messaging, instant messages, encrypted mail, user profiles, command parsing, reactions, and embedded mini-games/canvas applications.

## 2. Contents
- `index.html`: Main HTML shell for the terminal application.
- `client.js`: Low-level WebSocket client library handling network connection lifecycle, state machine, reconnect exponential backoffs, and JSON handshakes.
- `script.js`: Core application logic, command parsing (`/name`, `/im`, `/mail`, `/whois`, `/alone`, `/profile`, `/kill 9`, `/enc*`, `/history`, `/review`, `/summon`, etc.), UI rendering, sound effects, and DOM event handling.
- `style.css`: Terminal styling, CRT screen effects, and layout rules.
- `EmojiPaint.html`: Standalone emoji painting canvas tool.
- Subdirectories (`archeryGame/`, `rocketship/`, `squid/`): Mini-games and visual canvas toys integrated or linked within the client.

## 3. Role in VSMS
Primary client application interface. Communicates with the Go backend over WebSockets (`/api/ws`) for real-time messaging and REST HTTP endpoints (`/api/history`, `/api/mail/check`, `/api/whois`, `/api/session/check`, etc.).

## 4. Important Code
- `client.js`:
  - `VSMSClient`: WebSocket state machine (`disconnected`, `handshake_challenge`, `handshake_verified`, `awaiting_registration`, `registered`).
  - Handles `HANDSHAKE_CHALLENGE`, `HANDSHAKE_RESPONSE` (13-character random token generation), `HANDSHAKE_VERIFIED`, and `REGISTERED`.
  - PING/PONG heartbeats postponed until `registered` state.
- `script.js`:
  - `displayBroadcastMessage()`: Parses pipe-delimited messages (`MSG`, `EMOTE`, `IM`, `MAIL`, `PART`, `JOIN`, `NICK_UPDATE`, `ECHO`, `KILL9_INITIATE_REDIRECT`, `DELIVERY_FAILED`).
  - Handles command execution, Markdown rendering, pilcrow (`¶`) multiline processing, emoji detection, encryption/decryption (`/enc`), and mail checking.

## 5. Dependencies
- **Server API**: Mapped to routes `/rt/`, `/chat/`, `/RetroTerm/`, `/retroTerm/`, `/term/`, `/terminal/`.
- **WebSocket Endpoint**: `/api/ws?sID=<session_id>`.

## 6. Data Flow
1. Page loads `sID` from `localStorage.getItem('vsms_sID')`.
2. Checks session validity via `GET /api/session/check`.
3. Opens WebSocket to `/api/ws?sID=...`.
4. Completes challenge-response handshake & nickname registration.
5. Sends and receives pipe-delimited messages in real time.

## 7. Current State
Active, primary user interface for VSMS.
