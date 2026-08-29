# VSMS Client Root (`client`)

## 1. Purpose
The `client` directory serves as the root container for all client-side assets, web user interfaces, sub-applications, media resources, and static content served by the VSMS web server.

## 2. Contents
- `public/`: The primary directory containing static assets, web interfaces, authentication flows, chat terminals, and embedded games/toys.

## 3. Role in VSMS
This directory holds all frontend assets that users download and run in their browser. It provides both authentication portals (`auth`, `auth2`) and the primary real-time terminal interface (`RetroTerm`).

## 4. Important Code
No executable code resides directly at the root level of `client/`. All active web applications, HTML files, CSS styles, and JavaScript scripts are located inside `public/` and its subdirectories.

## 5. Dependencies
- **Server**: The Go server (`server/main.go`) serves static assets from `client/public/` under various URL paths (`/auth/`, `/auth2/`, `/rt/`, etc.).
- **Browser Runtime**: Runs inside standard modern web browsers using standard DOM, WebSockets, HTML5 Canvas, and LocalStorage APIs.

## 6. Data Flow
1. User requests web pages via HTTP from the Go server.
2. Go server resolves static assets from `client/public/`.
3. Web client executes in browser, establishing HTTP API requests and WebSocket connections back to the Go server.

## 7. Current State
Functional and active. Contains primary frontend interfaces as well as experimental/legacy sub-applications.
