# VSMS Database Schema (`server/db`)

## 1. Purpose
`server/db` contains the MySQL relational database schema definitions for the VSMS storage layer.

## 2. Contents
- `schema.sql`: SQL DDL statements creating the essential tables for tokens, sessions, and messages.

## 3. Role in VSMS
Defines the persistence structures for user authentication, active sessions, and chat message history.

## 4. Important Code / Schema
- `schema.sql`:
  - `auth_tokens`: Stores transient authentication tokens (`id`, `user_name_hash`, `token`, `ip_address`, `created_at`).
  - `sessions`: Stores active user sessions (`id`, `session_id`, `user_name_hash`, `created_at`, `last_seen_at`).
  - `chat_messages`: Stores real-time and offline chat/mail messages (`id`, `session_id`, `message`, `ip_address`, `created_at`). Linked via foreign key to `sessions(session_id)`.
  - *(Note: `chat_archives` is referenced in Go code during `KILL9` session deletion, though created dynamically or in extended migration scripts)*.

## 5. Dependencies
- Imported and populated by `server/main.go` using `github.com/go-sql-driver/mysql`.

## 6. Current State
Active database schema definition.
