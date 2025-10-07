package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// --- Structs ---

type KillRequestTracker struct {
	Count     int
	Timestamp time.Time
}

type AuthRequestPayload struct {
	Name string `json:"name"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

type VerifyRequestPayload struct {
	Name  string `json:"name"`
	Token string `json:"token"`
}

type VerifyResponse struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

type ChatMessage struct {
	SessionID string    `json:"session_id"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	IPAddress string    `json:"-"` // Ignored in JSON responses
}

// --- WebSocket ---

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients           map[*Client]bool
	clientsMutex      sync.Mutex
	broadcast         chan []byte
	register          chan *Client
	unregister        chan *Client
	killRequests      map[string]*KillRequestTracker
	killRequestsMutex sync.Mutex
}

func newHub() *Hub {
	return &Hub{
		broadcast:    make(chan []byte),
		register:     make(chan *Client),
		unregister:   make(chan *Client),
		clients:      make(map[*Client]bool),
		killRequests: make(map[string]*KillRequestTracker),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clientsMutex.Lock()
			h.clients[client] = true
			h.clientsMutex.Unlock()
		case client := <-h.unregister:
			h.clientsMutex.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.clientsMutex.Unlock()
		case message := <-h.broadcast:
			h.clientsMutex.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.clientsMutex.Unlock()
		}
	}
}

type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	sessionID string
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}
		c.hub.broadcast <- message
	}
}

func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.WriteMessage(websocket.TextMessage, message)
		}
	}
}

// --- Main Function ---

func main() {
	initDB()
	startCleanupRoutines()

	hub := newHub()
	go hub.run()

	r := mux.NewRouter()

	// --- Frontend Routes ---
	r.PathPrefix("/auth/").Handler(http.StripPrefix("/auth/", http.FileServer(http.Dir("../client/public/auth"))))
	r.PathPrefix("/auth2/").Handler(http.StripPrefix("/auth2/", http.FileServer(http.Dir("../client/public/auth2"))))
	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/auth/", http.StatusFound)
	})

// --- Serve RetroTerm page under multiple aliases ---
retroTermDir := http.Dir("../client/public/RetroTerm")

aliases := []string{"/rt/", "/chat/", "/RetroTerm/", "/retroTerm/", "/term/", "/terminal/"}
for _, alias := range aliases {
    r.PathPrefix(alias).Handler(http.StripPrefix(alias, http.FileServer(retroTermDir)))
}

// --- Redirect non-trailing-slash URLs to trailing-slash versions ---
redirects := map[string]string{
    "/rt":        "/rt/",
    "/chat":      "/chat/",
    "/RetroTerm": "/RetroTerm/",
    "/retroTerm": "/retroTerm/",
    "/term":      "/term/",
    "/terminal":  "/terminal/",
}

for from, to := range redirects {
    r.HandleFunc(from, func(w http.ResponseWriter, r *http.Request) {
        http.Redirect(w, r, to, http.StatusFound)
    })
}

	// --- API Routes ---
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/auth/request", requestTokenHandler).Methods("POST")
	api.HandleFunc("/auth/verify", verifyTokenHandler).Methods("POST")
	api.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		chatMessageHandler(hub, w, r)
	}).Methods("POST")
	api.HandleFunc("/history", historyHandler).Methods("GET")
	api.HandleFunc("/archive", archiveHandler).Methods("GET")
	api.HandleFunc("/session/check", sessionCheckHandler).Methods("GET")
	api.HandleFunc("/session/was_deleted", wasDeletedHandler).Methods("GET")
	api.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	log.Println("Server starting on port 8080...")
	if err := http.ListenAndServe(":8080", r); err != nil {
		log.Fatal(err)
	}
}

// --- Database ---

var db *sql.DB
var dbMutex = &sync.Mutex{}

func initDB() {
	dsn := "vsmsuser:/BunHun01Run%@tcp(127.0.0.1:3306)/vsms?parseTime=true"
	var err error
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("Error opening database: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("Error connecting to database: %v", err)
	}
	fmt.Println("Database connection successful.")
}

// --- API Handlers ---

func requestTokenHandler(w http.ResponseWriter, r *http.Request) {
	var payload AuthRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if payload.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	userNameHash := hashName(payload.Name)
	token, err := generateSecureToken(32)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	ipAddress := r.Header.Get("X-Real-IP")
if ipAddress == "" {
    ipAddress = r.Header.Get("X-Forwarded-For")
}
if ipAddress == "" {
    ipAddress = r.RemoteAddr
}
	stmt, err := db.Prepare("INSERT INTO auth_tokens(user_name_hash, token, ip_address, created_at) VALUES(?, ?, ?, ?)")
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	_, err = stmt.Exec(userNameHash, token, ipAddress, time.Now())
	if err != nil {
		http.Error(w, "Failed to save token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: token})
}

func verifyTokenHandler(w http.ResponseWriter, r *http.Request) {
	var payload VerifyRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if payload.Name == "" || payload.Token == "" {
		http.Error(w, "Name and token are required", http.StatusBadRequest)
		return
	}

	userNameHash := hashName(payload.Name)

	var id int
	var createdAt time.Time
	err := db.QueryRow("SELECT id, created_at FROM auth_tokens WHERE user_name_hash = ? AND token = ?", userNameHash, payload.Token).Scan(&id, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Invalid name or token", http.StatusUnauthorized)
		} else {
			http.Error(w, "Database error", http.StatusInternalServerError)
		}
		return
	}

	if time.Since(createdAt) > (90 * time.Minute) {
		go deleteAuthTokenByID(id)
		http.Error(w, "Token expired", http.StatusUnauthorized)
		return
	}

	sessionID, err := generateSecureToken(32)
	if err != nil {
		http.Error(w, "Failed to generate session ID", http.StatusInternalServerError)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec("INSERT INTO sessions(session_id, user_name_hash, created_at, last_seen_at) VALUES(?, ?, ?, ?)", sessionID, userNameHash, time.Now(), time.Now())
	if err != nil {
		tx.Rollback()
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	_, err = tx.Exec("DELETE FROM auth_tokens WHERE id = ?", id)
	if err != nil {
		tx.Rollback()
		http.Error(w, "Failed to cleanup token", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(VerifyResponse{
		SessionID: sessionID,
		Message:   "Authentication successful",
	})
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	if sessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	minutesStr := r.URL.Query().Get("minutes")
	if minutesStr == "" {
		minutesStr = "15" // Default to 15 minutes
	}

	minutes, err := strconv.Atoi(minutesStr)
	if err != nil {
		http.Error(w, "Invalid minutes parameter", http.StatusBadRequest)
		return
	}

	// Clamp minutes between 1 and 90
	if minutes < 1 {
		minutes = 1
	}
	if minutes > 90 {
		minutes = 90
	}

	timeLimit := time.Now().Add(-time.Duration(minutes) * time.Minute)

	rows, err := db.Query("SELECT session_id, message, created_at FROM chat_messages WHERE session_id = ? AND created_at >= ? ORDER BY created_at ASC", sessionID, timeLimit)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.SessionID, &msg.Message, &msg.Timestamp); err != nil {
			http.Error(w, "Failed to scan row", http.StatusInternalServerError)
			return
		}
		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		http.Error(w, "Row iteration error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

func archiveHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	if sessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	rows, err := db.Query("SELECT session_id, message, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC", sessionID)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.SessionID, &msg.Message, &msg.Timestamp); err != nil {
			http.Error(w, "Failed to scan row", http.StatusInternalServerError)
			return
		}
		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		http.Error(w, "Row iteration error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

func chatMessageHandler(hub *Hub, w http.ResponseWriter, r *http.Request) {
	var msg ChatMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if msg.SessionID == "" || msg.Message == "" {
		http.Error(w, "SessionID and message are required", http.StatusBadRequest)
		return
	}

	// Handle KILL9 command
	parts := strings.Split(msg.Message, "|")
	if len(parts) > 1 && parts[0] == "KILL9" {
		userName := parts[1]
		go handleKill9Request(hub, msg.SessionID, userName)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "kill request received"})
		return
	}

	ipAddress := r.Header.Get("X-Real-IP")
	if ipAddress == "" {
		ipAddress = r.Header.Get("X-Forwarded-For")
	}
	if ipAddress == "" {
		ipAddress = r.RemoteAddr
	}
	msg.IPAddress = ipAddress
	msg.Timestamp = time.Now()

	stmt, err := db.Prepare("INSERT INTO chat_messages(session_id, message, ip_address, created_at) VALUES(?, ?, ?, ?)")
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()
	_, err = stmt.Exec(msg.SessionID, msg.Message, msg.IPAddress, msg.Timestamp)
	if err != nil {
		http.Error(w, "Failed to save message", http.StatusInternalServerError)
		return
	}

	jsonMsg, err := json.Marshal(msg)
	if err != nil {
		http.Error(w, "Failed to marshal message", http.StatusInternalServerError)
		return
	}
	hub.broadcast <- jsonMsg

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "message sent"})
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	if !isSessionValid(sessionID) {
		log.Printf("WebSocket connection rejected for invalid session ID: %s", sessionID)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256), sessionID: sessionID}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func broadcastAndStore(hub *Hub, sessionID, message, ipAddress string) {
	// Store the message in the database
	stmt, err := db.Prepare("INSERT INTO chat_messages(session_id, message, ip_address, created_at) VALUES(?, ?, ?, ?)")
	if err != nil {
		log.Printf("Database error on broadcastAndStore prep: %v", err)
		return
	}
	defer stmt.Close()
	_, err = stmt.Exec(sessionID, message, ipAddress, time.Now())
	if err != nil {
		log.Printf("Failed to save broadcast message: %v", err)
		// Continue to broadcast even if save fails
	}

	// Broadcast the message via WebSocket
	jsonMsg, err := json.Marshal(ChatMessage{
		SessionID: sessionID,
		Message:   message,
		Timestamp: time.Now(),
	})
	if err == nil {
		hub.broadcastToSession(sessionID, jsonMsg)
	} else {
		log.Printf("Failed to marshal broadcast message: %v", err)
	}
}

func handleKill9Request(hub *Hub, sessionID string, userName string) {
	hub.killRequestsMutex.Lock()
	defer hub.killRequestsMutex.Unlock()

	tracker, exists := hub.killRequests[sessionID]

	if !exists || time.Since(tracker.Timestamp) > 12*time.Minute {
		hub.killRequests[sessionID] = &KillRequestTracker{
			Count:     1,
			Timestamp: time.Now(),
		}
		log.Printf("First silent kill request for session %s by user %s. Timer started.", sessionID, userName)
		// Do not broadcast anything for the first request to keep it discreet.
		return
	}

	tracker.Count++
	log.Printf("Kill request count for session %s is now %d.", sessionID, tracker.Count)

	if tracker.Count >= 2 {
		log.Printf("Second valid kill request for session %s by %s. Terminating session.", sessionID, userName)
		delete(hub.killRequests, sessionID)

		// 1. Broadcast "Session canceled" as an anonymous ECHO message.
		cancelMsg := "ECHO||***Session Canceled***"
		broadcastAndStore(hub, sessionID, cancelMsg, "server-broadcast")

		time.Sleep(1 * time.Second)

		// 2. Archive and delete the session data within a single transaction.
		tx, err := db.Begin()
		if err != nil {
			log.Printf("CRITICAL: Failed to begin transaction for session deletion %s: %v", sessionID, err)
			broadcastAndStore(hub, sessionID, "KILL9_DB_ERROR||", "server-error")
			return
		}

		// Step 2a: Copy messages to chat_archives
		_, err = tx.Exec("INSERT INTO chat_archives SELECT * FROM chat_messages WHERE session_id = ?", sessionID)
		if err != nil {
			log.Printf("CRITICAL: Failed to archive messages for session %s: %v", sessionID, err)
			tx.Rollback()
			broadcastAndStore(hub, sessionID, "KILL9_DB_ERROR||", "server-error")
			return
		}

		// Step 2b: Delete messages from chat_messages
		_, err = tx.Exec("DELETE FROM chat_messages WHERE session_id = ?", sessionID)
		if err != nil {
			log.Printf("CRITICAL: Failed to delete messages for session %s: %v", sessionID, err)
			tx.Rollback()
			broadcastAndStore(hub, sessionID, "KILL9_DB_ERROR||", "server-error")
			return
		}

		// Step 2c: Delete the session itself
		result, err := tx.Exec("DELETE FROM sessions WHERE session_id = ?", sessionID)
		if err != nil {
			log.Printf("CRITICAL: Failed to execute delete for session %s in transaction: %v", sessionID, err)
			tx.Rollback()
			broadcastAndStore(hub, sessionID, "KILL9_DB_ERROR||", "server-error")
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("CRITICAL: Failed to commit transaction for session deletion %s: %v", sessionID, err)
			broadcastAndStore(hub, sessionID, "KILL9_DB_ERROR||", "server-error")
			return
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected > 0 {
			log.Printf("Successfully archived and deleted session %s from database.", sessionID)
		} else {
			log.Printf("Session %s was not found in database for deletion.", sessionID)
		}

		// 3. Broadcast final messages as anonymous ECHO messages.
		deletedMsg := "ECHO||***SESSION DELETED*** :: Resetting clients."
		broadcastAndStore(hub, sessionID, deletedMsg, "server-broadcast")

		// 4. Broadcast the special non-visible message to trigger the client-side redirect.
		redirectMsg := "KILL9_INITIATE_REDIRECT||"
		redirectJson, err := json.Marshal(ChatMessage{SessionID: sessionID, Message: redirectMsg, Timestamp: time.Now()})
		if err == nil {
			hub.broadcastToSession(sessionID, redirectJson)
		} else {
			log.Printf("Error marshaling KILL9_INITIATE_REDIRECT message: %v", err)
		}
	}
}

func (h *Hub) broadcastToSession(sessionID string, message []byte) {
	h.clientsMutex.Lock()
	defer h.clientsMutex.Unlock()

	for client := range h.clients {
		if client.sessionID == sessionID {
			select {
			case client.send <- message:
			default:
				close(client.send)
				delete(h.clients, client)
			}
		}
	}
}

func sessionCheckHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	isValid := isSessionReal(sessionID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"valid": isValid})
}

func wasDeletedHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	wasReal := wasSessionEverReal(sessionID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"was_real": wasReal})
}

// --- Utility & Cleanup Functions ---

func wasSessionEverReal(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	var id int
	// Check if the session_id ever existed in chat_archives.
	err := db.QueryRow("SELECT id FROM chat_archives WHERE session_id = ? LIMIT 1", sessionID).Scan(&id)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error checking past session existence for session %s: %v", sessionID, err)
		}
		return false
	}
	return true
}

func isSessionReal(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	var id int
	err := db.QueryRow("SELECT id FROM sessions WHERE session_id = ?", sessionID).Scan(&id)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error checking session existence for session %s: %v", sessionID, err)
		}
		return false
	}
	return true
}

func isSessionValid(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	stmt, err := db.Prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?")
	if err != nil {
		log.Printf("Error preparing session validation statement: %v", err)
		return false
	}
	defer stmt.Close()

	result, err := stmt.Exec(time.Now(), sessionID)
	if err != nil {
		log.Printf("Error executing session validation for session %s: %v", sessionID, err)
		return false
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("Error getting rows affected for session validation on session %s: %v", sessionID, err)
		return false
	}

	return rowsAffected > 0
}

func hashName(name string) string {
	hasher := sha256.New()
	hasher.Write([]byte(name))
	return hex.EncodeToString(hasher.Sum(nil))
}

func generateSecureToken(length int) (string, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func deleteAuthTokenByID(id int) {
	_, err := db.Exec("DELETE FROM auth_tokens WHERE id = ?", id)
	if err != nil {
		log.Printf("Failed to delete auth token with id %d: %v", id, err)
	}
}

func startCleanupRoutines() {
	log.Println("Starting cleanup routines...")
	// Cleanup expired tokens every 15 minutes
	go func() {
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupExpiredTokens()
		}
	}()

	// Cleanup inactive sessions every day
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanupInactiveSessions()
		}
	}()

	// Cleanup old chat messages every day
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanupOldChatMessages()
		}
	}()
}

func cleanupExpiredTokens() {
	ninetyMinutesAgo := time.Now().Add(-90 * time.Minute)
	result, err := db.Exec("DELETE FROM auth_tokens WHERE created_at < ?", ninetyMinutesAgo)
	if err != nil {
		log.Printf("Error cleaning up expired tokens: %v", err)
		return
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		log.Printf("Cleaned up %d expired auth tokens", rowsAffected)
	}
}

func cleanupInactiveSessions() {
	fourteenDaysAgo := time.Now().Add(-14 * 24 * time.Hour)
	result, err := db.Exec("DELETE FROM sessions WHERE last_seen_at < ?", fourteenDaysAgo)
	if err != nil {
		log.Printf("Error cleaning up inactive sessions: %v", err)
		return
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		log.Printf("Cleaned up %d inactive sessions", rowsAffected)
	}
}

func cleanupOldChatMessages() {
	twoMonthsAgo := time.Now().Add(-2 * 30 * 24 * time.Hour) // Approximation
	result, err := db.Exec("DELETE FROM chat_messages WHERE created_at < ?", twoMonthsAgo)
	if err != nil {
		log.Printf("Error cleaning up old chat messages: %v", err)
		return
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		log.Printf("Cleaned up %d old chat messages", rowsAffected)
	}
}