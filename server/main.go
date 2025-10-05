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
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// --- Structs ---

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
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
	IPAddress string `json:"-"` // Ignored in JSON responses
}

// --- WebSocket ---

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
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

	// --- API Routes ---
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/auth/request", requestTokenHandler).Methods("POST")
	api.HandleFunc("/auth/verify", verifyTokenHandler).Methods("POST")
	api.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		chatMessageHandler(hub, w, r)
	}).Methods("POST")
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
	dsn := "user:password@tcp(127.0.0.1:3306)/vsms?parseTime=true"
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

	ipAddress := r.RemoteAddr
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
	msg.IPAddress = r.RemoteAddr

	stmt, err := db.Prepare("INSERT INTO chat_messages(session_id, message, ip_address, created_at) VALUES(?, ?, ?, ?)")
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()
	_, err = stmt.Exec(msg.SessionID, msg.Message, msg.IPAddress, time.Now())
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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// --- Utility & Cleanup Functions ---

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