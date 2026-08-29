# VSMS Server Root (`server`)

## 1. Purpose
The `server` directory contains the main Go server backend application for VSMS, database initialization scripts, Go module dependencies, and supporting AI/text processing tools.

## 2. Contents
- `main.go`: Primary backend service executable source code. Implements HTTP routers, REST API handlers, WebSocket hub, real-time message router, authentication token verification, geolocation lookup, and database operations.
- `go.mod` / `go.sum`: Go module definitions and dependency lockfile (`github.com/gorilla/mux`, `github.com/gorilla/websocket`, `github.com/go-sql-driver/mysql`, `github.com/ledongthuc/pdf`).
- `db/`: Database schema definitions (`schema.sql`).
- `tf/`: Text processing, Markov chain text generator, PDF reader, and personality data tools.

## 3. Role in VSMS
Central backend coordinator. Acts as the HTTP web server for static client assets, the REST API provider for session and mail management, and the WebSocket server for real-time chat routing and persistence.

## 4. Important Code
- `main.go`:
  - `main()`: Initializes MySQL database, launches background session/token cleanup goroutines, creates the WebSocket hub, registers static asset routes and API endpoints, and listens on port `:8767`.
  - `Hub` & `Client`: Manages WebSocket client connections per session ID. Implements challenge-response authentication (`HANDSHAKE_CHALLENGE`, `HANDSHAKE_RESPONSE`, `HANDSHAKE_VERIFIED`, `REGISTERED`).
  - `readPump()` & `writePump()`: Handles incoming pipe-delimited client messages (`MSG`, `EMOTE`, `IM`, `MAIL`, `NICK`, `PROFILE`, `KILL9`, `PING`, etc.).
  - `broadcastAndStore()` / `storeMessage()`: Persists messages to MySQL `chat_messages` table and broadcasts to active session clients.
  - REST Handlers: `requestTokenHandler`, `verifyTokenHandler`, `historyHandler`, `archiveHandler`, `mailCheckHandler`, `mailOutHandler`, `whoisHandler`, `sessionCheckHandler`, `wasDeletedHandler`.
  - `handleKill9Request()`: Discreet 2-pass session kill feature that archives and purges session data.

## 5. Dependencies
- **Database**: MySQL database on `127.0.0.1:3306` (`vsms` database).
- **External Services**: `ip-api.com` for IP-based geolocation in `/api/whois`.
- **Client**: Serves static files from `../client/public/`.

## 6. Data Flow
```
Client Request -> HTTP / WebSocket (:8767)
                 -> gorilla/mux Router
                 -> API Handler / WebSocket Hub (readPump)
                 -> MySQL Database (vsms)
                 -> Broadcast to Session Clients
```

## 7. Current State
Active Go backend server executable.
