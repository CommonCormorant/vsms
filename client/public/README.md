# VSMS Client Public Assets (`client/public`)

## 1. Purpose
`client/public` contains all static files, web applications, media assets, authentication interfaces, and terminal applications served directly to client browsers.

## 2. Contents
- `RetroTerm/`: The primary retro-style terminal chat application, widget scripts, canvas toys, and embedded games.
- `auth/`: The legacy or primary single-input passphrase authentication frontend interface.
- `auth2/`: An alternative or redesigned authentication frontend interface.
- `images/`: Static image assets for file/image upload indicators.
- `usr/`: User directory placeholder structure (`usr/img/here.text`).

## 3. Role in VSMS
This is the root directory mapped by the Go HTTP server (`server/main.go`) to handle static web routing (`http.FileServer`).

## 4. Important Code
- `auth/index.html` / `auth/script.js`: Auth flow requesting tokens from `/api/auth/request` and verifying with `/api/auth/verify`.
- `auth2/index.html` / `auth2/script.js`: Secondary/experimental auth UI flow.
- `RetroTerm/index.html` / `RetroTerm/client.js` / `RetroTerm/script.js`: Core VSMS chat frontend interface.

## 5. Dependencies
- Served directly by `server/main.go` HTTP router (`/auth/`, `/auth2/`, `/rt/`, `/chat/`, etc.).
- `RetroTerm` connects to WebSocket endpoint `/api/ws` and API endpoints (`/api/history`, `/api/mail/check`, `/api/whois`, etc.).

## 6. Data Flow
1. Server serves HTML/JS/CSS files from `public/`.
2. Browser renders authentication UIs (`auth`/`auth2`) or chat terminal (`RetroTerm`).
3. Scripts perform REST API and WebSocket calls back to server endpoints.

## 7. Current State
Active. Hosts active client applications and asset directories.
