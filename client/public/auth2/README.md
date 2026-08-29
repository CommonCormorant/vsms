# VSMS Auth2 Application (`client/public/auth2`)

## 1. Purpose
`client/public/auth2` is an alternative or updated login interface for VSMS, designed with updated UI styling and interaction flows.

## 2. Contents
- `index.html`: Web structure for the auth2 login page.
- `script.js`: Client-side logic for interacting with the VSMS auth REST APIs.
- `style.css`: Styling for the auth2 interface.

## 3. Role in VSMS
Serves as an alternate authentication frontend route (`/auth2/`) in the system architecture.

## 4. Important Code
- `script.js`: Performs authentication against `/api/auth/request` and `/api/auth/verify`, saving `session_id` to `localStorage` before redirecting.

## 5. Dependencies
- **Server Router**: Mapped to `/auth2/` in `server/main.go`.
- **Server API**: Integrates with `/api/auth/request` and `/api/auth/verify`.

## 6. Data Flow
User input -> `/api/auth/request` -> `/api/auth/verify` -> Save Session ID -> Redirect to `/rt/`.

## 7. Current State
Functional alternate/experimental authentication interface.
