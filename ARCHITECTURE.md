# VSMS Architecture & System Overview

## VSMS in One Paragraph
VSMS (Very Simple Message Service) is a lightweight, web-based real-time messaging system and retro terminal environment. It connects browser clients to a Go backend server over WebSockets and REST APIs, using a simple pipe-delimited protocol (`MSG|sender|content`, `IM|sender|recipient|content|id`, `MAIL|sender|recipient|content|flag|status`, etc.) backed by MySQL persistence. Designed as both a communication system and a testbed for multiplayer game environments, VSMS features custom session authentication, encrypted mail, user profiles, discreet session resetting (`/kill 9`), and embedded canvas mini-games.

---

## The Big Picture

```
                                  ┌────────────────────────┐
                                  │      Browser Client    │
                                  │  (auth / RetroTerm)    │
                                  └───────────┬────────────┘
                                              │
                         HTTP REST API        │   WebSocket (Pipe Protocol)
                     (/api/auth, /api/history)│   (/api/ws?sID=...)
                                              │
                                              ▼
                                  ┌────────────────────────┐
                                  │       VSMS Server      │
                                  │    (server/main.go)    │
                                  │       Port :8767       │
                                  └───────────┬────────────┘
                                              │
                          ┌───────────────────┴───────────────────┐
                          │                                       │
                          ▼                                       ▼
             ┌────────────────────────┐              ┌────────────────────────┐
             │     MySQL Database     │              │    External Services   │
             │   (sessions, messages) │              │  (ip-api.com Geolocation)
             └────────────────────────┘              └────────────────────────┘
```

---

## Components

### 1. Web Client (`client/public/`)
- **Authentication Portal (`auth/`, `auth2/`)**: Accepts user passphrase/name, requests a token from `/api/auth/request`, verifies it via `/api/auth/verify`, and stores the resulting `session_id` in `localStorage` under `vsms_sID`.
- **RetroTerm Terminal (`RetroTerm/`)**: Main messaging interface. Connects via `client.js` to `/api/ws?sID=...`, performing a multi-step challenge-response handshake (`HANDSHAKE_CHALLENGE` -> `HANDSHAKE_RESPONSE` -> `HANDSHAKE_VERIFIED` -> `REGISTERED`) before entering the real-time chat loop (`script.js`).
- **Embedded Mini-Games & Canvas Toys**: Integrated canvas applications within RetroTerm including `archeryGame`, `rocketship`, `squid`, and `EmojiPaint`.

### 2. Backend Server (`server/main.go`)
- **HTTP Web Router**: Serves static frontend assets under routes `/auth/`, `/auth2/`, `/rt/`, `/chat/`, `/RetroTerm/`, etc.
- **REST API Subrouter (`/api`)**: Handles token authentication, message history (`/api/history`), message archives (`/api/archive`), session validity (`/api/session/check`, `/api/session/was_deleted`), asynchronous mail checks (`/api/mail/check`, `/api/mail/out`), and IP geolocation lookups (`/api/whois`).
- **WebSocket Hub & Connection Pump (`readPump` / `writePump`)**: Manages client connections grouped by session ID, enforces nickname uniqueness, routes pipe-delimited messages, handles heartbeats, and manages 30-second disconnect grace periods before broadcasting departure (`PART`) events.

### 3. Persistence Layer (`server/db/schema.sql`)
- **`auth_tokens`**: Stores transient authentication tokens mapped to hashed user passphrases.
- **`sessions`**: Stores active session IDs (`session_id`), hashed user names, creation time, and `last_seen_at` timestamps.
- **`chat_messages`**: Stores message payloads, session IDs, client IP addresses, and creation timestamps.
- **`chat_archives`**: Used by `/kill 9` handling to preserve archived messages prior to session purging.

### 4. Text Framework & Tools (`server/tf/`)
- **Markov Language Generator (`server/tf/Markov/main.go`)**: Standalone tool that builds bigram Markov models from chat database history (`chat_messages` / `chat_archives`) and PDF source materials (`tyzmon2014.pdf`) to generate synthetic bot output.

---

## Message Lifecycle

1. **User Types Input**: User inputs text in RetroTerm (e.g., standard text, `/im recipient, message`, `/mail recipient, message`, `/profile text`, `/name newname`).
2. **Formatting**: Multiline text converts newlines into pilcrow (`¶`) characters. Pipe characters (`|`) delimit header fields.
3. **Transmission**: `VSMSClient.send()` transmits the pipe-delimited string (e.g., `MSG|Nickname|Hello World`) across the WebSocket.
4. **Server Ingestion**: Server's `readPump()` reads the payload, validates the sender's nickname against the client's registered session identity, and determines the message type (`MSG`, `EMOTE`, `IM`, `MAIL`, `NICK`, `PROFILE`, `KILL9`, `PING`).
5. **Persistence & Relay**:
   - `MSG` / `EMOTE` / `ART` / `PART`: Broadcasted to all connected clients in the session via `Hub` and saved to `chat_messages` in MySQL via `broadcastAndStore()`.
   - `IM`: Relayed directly to the target recipient client in the session. If recipient is offline, server returns `DELIVERY_FAILED` notice back to sender.
   - `MAIL`: Persisted with unread flag (`|U`). Delivered asynchronously when the recipient client polls `/api/mail/check`.
6. **Client Rendering**: Receiving clients parse the message type in `displayBroadcastMessage()`, strip or replace pilcrows (`¶` -> `<br>`), format Markdown, parse emojis, and render the output into the CRT terminal DOM.

---

## Identity / Authentication

- **No Passwords / Passphrase Hashing**: VSMS identifies users by hashing a passphrase or handle string using SHA-256 (`hashName()`).
- **Token Request**: Client posts name to `POST /api/auth/request`. Server inserts token into `auth_tokens` with client IP.
- **Token Verification**: Client posts name + token to `POST /api/auth/verify`. Server generates a 32-character secure session ID (`session_id`), saves it in `sessions`, deletes the used token, and returns the `session_id`.
- **WebSocket Handshake**:
  1. Client connects to `/api/ws?sID=<session_id>`.
  2. Server verifies `session_id` in database.
  3. Server sends JSON `HANDSHAKE_CHALLENGE` with a secure challenge token.
  4. Client responds with JSON `HANDSHAKE_RESPONSE` containing a 13-character token extracted from the challenge.
  5. Server verifies token, sends JSON `HANDSHAKE_VERIFIED`.
  6. Client sends JSON `NICK` with requested nickname.
  7. Server assigns unique nickname (appending suffixes if taken), registers client with `Hub`, and returns JSON `REGISTERED`.

---

## Persistence

- **Database Engine**: MySQL (`127.0.0.1:3306`), database name `vsms`.
- **Persistent Data**:
  - Active sessions (`sessions`).
  - Broadcast messages, profiles, and mail (`chat_messages`).
  - Session archives (`chat_archives`).
- **Ephemeral Data**:
  - WebSocket client objects in memory (`Hub.sessions`).
  - Transient kill-request trackers (`Hub.killRequests`).
  - Reconnect grace period timers (`Hub.departureTimers`).

---

## Protocol

- **Transport**: HTTP/1.1 REST for authentication and history retrieval; WebSockets (`wss://` / `ws://`) for real-time messaging.
- **WebSocket Message Format**:
  - *Handshake Phase*: JSON objects (`{"type": "HANDSHAKE_CHALLENGE", "payload": "..."}`, `{"type": "NICK", "payload": "guest"}`).
  - *Active Chat Phase*: Pipe-delimited strings (`TYPE|SENDER_NICK|PAYLOAD...`).
- **Protocol Command Prefixes**:
  - `MSG|nick|text`: Standard channel broadcast message.
  - `EMOTE|nick|action`: Action message (e.g. `/me`).
  - `IM|sender|recipient|text|msg_id`: Direct instant message.
  - `MAIL|sender|recipient|text|flag|status`: Offline mail message (`|U` for unread, `|R` for read).
  - `NICK|old_nick|new_nick`: Request nickname change.
  - `NICK_UPDATE|old_nick|new_nick`: Server broadcast notifying clients of a name change.
  - `PROFILE|nick|bio`: Update user profile text.
  - `KILL9`: Request session termination (requires 2 invocations within 12 minutes).
  - `PING` / `PONG`: Application-level heartbeat.

---

## Configuration

- **Server Network Port**: Hardcoded to port `:8767` in `server/main.go`.
- **Database Connection String**: Hardcoded DSN in `server/main.go` and `server/tf/Markov/main.go`:
  `vsmsuser:/BunHun01Run%@tcp(127.0.0.1:3306)/vsms?parseTime=true`
- **Origin Checking**: Mapped in `websocket.Upgrader` to match `https://gameship.online` or `*.gameship.online`.

---

## Running VSMS

### Prerequisites
1. MySQL server running on `127.0.0.1:3306` with database `vsms` and credentials `vsmsuser` / `BunHun01Run%`.
2. Database schema initialized using `server/db/schema.sql`.
3. Go environment (Go 1.18+).

### Launching the Server
```bash
cd server
go mod tidy
go run main.go
```
The server starts listening on `http://localhost:8767`.

### Accessing the Client
Navigate browser to:
- `http://localhost:8767/auth/` (Authentication Portal)
- After logging in, the client automatically redirects to `http://localhost:8767/rt/` (RetroTerm Chat Terminal).

---

## Known Problems

1. **Hardcoded Database Credentials**: DSN string with plain-text password is embedded directly in `server/main.go` and `server/tf/Markov/main.go` rather than using environment variables.
2. **Hardcoded CORS / WebSocket Origin Check**: `websocket.Upgrader` restricts origins to `gameship.online`. Local testing on `localhost` or non-gameship domains requires host override or disabling origin checks.
3. **Database Dependency Crash Potential**: If MySQL is down on server start, `db.Ping()` logs an error but server continues; database calls during messaging will fail if MySQL remains unreachable.
4. **Missing Table DDL in `schema.sql`**: `chat_archives` is queried and written to in `server/main.go` during `/kill 9` execution, but `chat_archives` is not explicitly defined in `server/db/schema.sql`.

---

## Questions / Unknowns

- **Production Reverse Proxy Setup**: Unknown nginx / PM2 configuration details used when deploying `vsms` behind HTTPS on `gameship.online`.
- **Exie Bot Activation Integration**: Purpose of `/summon exie` hit to `https://prototype.gameship.online/exiebot/activate` and whether that bot endpoint is still active.

---

## Suggested Revival Path

For a developer returning to VSMS after a long absence, follow this minimal step-by-step investigation sequence before attempting code edits:

1. **Database Setup Verification**: Ensure MySQL is running locally and inspect the `vsms` database schema and user permissions against `server/db/schema.sql` (and add `CREATE TABLE chat_archives LIKE chat_messages;` if missing).
2. **Launch & Log Inspection**: Run `go run main.go` inside `server/` and verify server startup logs on port `:8767`.
3. **Authentication Flow Trace**: Open browser to `http://localhost:8767/auth/`, submit a test username, inspect the browser Network tab for POST requests to `/api/auth/request` and `/api/auth/verify`, and confirm `vsms_sID` is set in `localStorage`.
4. **WebSocket Handshake Verification**: Confirm successful redirect to `/rt/` and inspect WebSocket messages in browser Developer Tools to trace `HANDSHAKE_CHALLENGE` -> `HANDSHAKE_RESPONSE` -> `HANDSHAKE_VERIFIED` -> `REGISTERED`.
5. **Single Message End-to-End Cycle**: Send a test chat message (`MSG|...`) and confirm it appears in the DOM and is saved in MySQL `chat_messages`.
6. **Investigate Secondary Features**: Only after basic client-server messaging works, test secondary features such as `/im`, `/mail`, `/whois`, encrypted messages, and embedded canvas games.
