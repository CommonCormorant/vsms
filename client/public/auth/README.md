# VSMS Auth Application (`client/public/auth`)

## 1. Purpose
`client/public/auth` provides the user authentication web portal where users enter their name/passphrase to acquire an authentication token and establish a valid session.

## 2. Contents
- `index.html`: The HTML structure for the passphrase/name input form.
- `script.js`: Logic for submitting user identity, requesting tokens, verifying tokens against the server API, storing `vsms_sID` in `localStorage`, and redirecting to the chat terminal (`/rt/`).
- `style.css`: Visual styling for the authentication page.

## 3. Role in VSMS
Entry point for user sessions. Users cannot directly open `RetroTerm` without a valid session; `auth` handles the initial authentication handshake with the Go server.

## 4. Important Code
- `script.js`:
  - `handleAuth()`: Sends POST request to `/api/auth/request` with `name`.
  - Sends POST request to `/api/auth/verify` with `name` and received `token`.
  - Saves returned `session_id` to `localStorage.setItem('vsms_sID', sessionID)` and redirects to `/rt/`.

## 5. Dependencies
- **Server API Endpoints**:
  - `POST /api/auth/request`
  - `POST /api/auth/verify`
- **Redirects to**: `/rt/` (`RetroTerm`).

## 6. Data Flow
```
User Enters Name -> POST /api/auth/request -> Receive Token
                 -> POST /api/auth/verify  -> Receive Session ID
                 -> Store sID in LocalStorage -> Redirect to /rt/
```

## 7. Current State
Functional and active. Main login route served at `/auth/` (and root `/` redirect).
