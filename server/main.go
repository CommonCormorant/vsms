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

type MailOutResponse struct {
	Total  int `json:"total"`
	Read   int `json:"read"`
	Unread int `json:"unread"`
}

type ChatMessage struct {
	SessionID string    `json:"session_id"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	IPAddress string    `json:"-"` // Ignored in JSON responses
}

type BroadcastMessage struct {
	SessionID string
	Message   []byte
}

// --- WebSocket ---

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	sessions             map[string]map[*Client]bool
	sessionsMutex        sync.Mutex
	broadcast            chan BroadcastMessage
	register             chan *Client
	unregister           chan *Client
	killRequests         map[string]*KillRequestTracker
	killRequestsMutex    sync.Mutex
	departureTimers      map[string]*time.Timer
	departureTimersMutex sync.Mutex
}

func newHub() *Hub {
	return &Hub{
		broadcast:       make(chan BroadcastMessage),
		register:        make(chan *Client),
		unregister:      make(chan *Client),
		sessions:        make(map[string]map[*Client]bool),
		killRequests:    make(map[string]*KillRequestTracker),
		departureTimers: make(map[string]*time.Timer),
	}
}

func (h *Hub) getAvailableNickname(sessionID, requestedNick string) string {
	h.sessionsMutex.Lock()
	defer h.sessionsMutex.Unlock()

	finalNick := requestedNick
	suffix := 1
	isTaken := true

	for isTaken {
		isTaken = false
		if session, ok := h.sessions[sessionID]; ok {
			for client := range session {
				if strings.EqualFold(client.Nickname, finalNick) {
					isTaken = true
					break
				}
			}
		}
		if isTaken {
			finalNick = fmt.Sprintf("%s_%d", requestedNick, suffix)
			suffix++
		}
	}
	return finalNick
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.sessionsMutex.Lock()
			// Get the list of current users before adding the new one.
			var onlineUsers []string
			if session, ok := h.sessions[client.sessionID]; ok {
				for existingClient := range session {
					if existingClient.Nickname != "" {
						onlineUsers = append(onlineUsers, existingClient.Nickname)
					}
				}
			}

			if _, ok := h.sessions[client.sessionID]; !ok {
				h.sessions[client.sessionID] = make(map[*Client]bool)
			}
			h.sessions[client.sessionID][client] = true
			h.sessionsMutex.Unlock()

			// Send the welcome message with the list of users directly to the new client.
			welcomeMsg, _ := json.Marshal(ChatMessage{
				SessionID: client.sessionID,
				Message:   "WELCOME|" + strings.Join(onlineUsers, ","),
				Timestamp: time.Now(),
			})
			client.send <- welcomeMsg

			// If the user is reconnecting, cancel their departure timer
			timerKey := client.sessionID + ":" + client.Nickname
			h.departureTimersMutex.Lock()
			if timer, ok := h.departureTimers[timerKey]; ok {
				timer.Stop()
				delete(h.departureTimers, timerKey)
			} else {
				// Otherwise, announce their arrival to the session
				if client.Nickname != "" {
					joinMsg, _ := json.Marshal(ChatMessage{
						SessionID: client.sessionID,
						Message:   "JOIN|" + client.Nickname,
						Timestamp: time.Now(),
					})
					h.broadcast <- BroadcastMessage{SessionID: client.sessionID, Message: joinMsg}
				}
			}
			h.departureTimersMutex.Unlock()

		case client := <-h.unregister:
			h.sessionsMutex.Lock()
			if session, ok := h.sessions[client.sessionID]; ok {
				if _, ok := session[client]; ok {
					delete(session, client)
					close(client.send)

					if len(session) == 0 {
						delete(h.sessions, client.sessionID)
					}

					// If the user had a nickname, start a departure timer to handle flaky connections
					if client.Nickname != "" {
						timerKey := client.sessionID + ":" + client.Nickname
						h.departureTimersMutex.Lock()
						h.departureTimers[timerKey] = time.AfterFunc(30*time.Second, func() {
							partMsg, _ := json.Marshal(ChatMessage{
								SessionID: client.sessionID,
								Message:   "PART|" + client.Nickname,
								Timestamp: time.Now(),
							})
							h.broadcast <- BroadcastMessage{SessionID: client.sessionID, Message: partMsg}
							h.departureTimersMutex.Lock()
							delete(h.departureTimers, timerKey)
							h.departureTimersMutex.Unlock()
						})
						h.departureTimersMutex.Unlock()
					}
				}
			}
			h.sessionsMutex.Unlock()

		case message := <-h.broadcast:
			h.sessionsMutex.Lock()
			if session, ok := h.sessions[message.SessionID]; ok {
				for client := range session {
					select {
					case client.send <- message.Message:
					default:
						close(client.send)
						delete(session, client)
						if len(session) == 0 {
							delete(h.sessions, message.SessionID)
						}
					}
				}
			}
			h.sessionsMutex.Unlock()
		}
	}
}

type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	sessionID string
	ID        string // Stable, unique identifier for the client
	Nickname  string // Mutable, user-facing name
	IPAddress string
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	// 1. Initial message must be a NICK announcement.
	_, initialMsg, err := c.conn.ReadMessage()
	if err != nil {
		log.Printf("Error reading initial nick message: %v", err)
		return
	}

	initialParts := strings.Split(string(initialMsg), "|")
	if len(initialParts) != 2 || initialParts[0] != "NICK" {
		log.Printf("First message was not a valid NICK announcement: %s", string(initialMsg))
		return
	}

	requestedNick := initialParts[1]
	if strings.Contains(requestedNick, ",") || strings.Contains(requestedNick, "!") {
		log.Printf("Connection rejected for invalid nickname: %s", requestedNick)
		return
	}

	// 2. Assign a stable ID and a unique nickname.
	c.ID = fmt.Sprintf("%x", sha256.Sum256([]byte(c.IPAddress+c.sessionID)))
	c.Nickname = c.hub.getAvailableNickname(c.sessionID, requestedNick)

	// 3. Register the client with the hub.
	c.hub.register <- c

	// 4. Send a REGISTERED message back to the client with their stable ID and final nickname.
	registeredMsg, _ := json.Marshal(ChatMessage{
		SessionID: c.sessionID,
		Message:   fmt.Sprintf("REGISTERED|%s|%s", c.ID, c.Nickname),
		Timestamp: time.Now(),
	})
	c.send <- registeredMsg

	// 5. Main message loop. All subsequent messages must include the client's stable ID.
	for {
		_, msgBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		msgString := string(msgBytes)
		msgParts := strings.Split(msgString, "|")
		if len(msgParts) < 2 {
			log.Printf("Invalid message format received: %s", msgString)
			continue
		}

		// The second part of the message must now be the client's stable ID.
		clientID := msgParts[1]
		if clientID != c.ID {
			log.Printf("Message with invalid client ID received. Expected %s, got %s", c.ID, clientID)
			continue
		}

		msgType := msgParts[0]
		switch msgType {
		case "NICK":
			if len(msgParts) == 3 {
				newName := c.hub.getAvailableNickname(c.sessionID, msgParts[2])
				if !strings.Contains(newName, ",") && !strings.Contains(newName, "!") {
					oldName := c.Nickname
					c.Nickname = newName
					updateMsg := fmt.Sprintf("NICK_UPDATE|%s|%s", oldName, newName)
					jsonMsg, _ := json.Marshal(ChatMessage{
						SessionID: c.sessionID, Message: updateMsg, Timestamp: time.Now(),
					})
					c.hub.broadcast <- BroadcastMessage{SessionID: c.sessionID, Message: jsonMsg}
				}
			}
		case "IM":
			if len(msgParts) < 5 {
				continue
			}
			recipientNick := msgParts[2]
			originalContent := strings.Join(msgParts[4:], "|")

			c.hub.sessionsMutex.Lock()
			var recipientClient *Client
			if session, ok := c.hub.sessions[c.sessionID]; ok {
				for client := range session {
					if strings.EqualFold(client.Nickname, recipientNick) {
						recipientClient = client
						break
					}
				}
			}
			c.hub.sessionsMutex.Unlock()

			if recipientClient != nil {
				imRelayMsg := fmt.Sprintf("IM|%s|%s|%s", c.Nickname, recipientNick, originalContent)
				imMsg, _ := json.Marshal(ChatMessage{
					SessionID: c.sessionID, Message: imRelayMsg, Timestamp: time.Now(),
				})
				recipientClient.send <- imMsg
			} else {
				failMsg, _ := json.Marshal(ChatMessage{
					SessionID: c.sessionID, Message: "DELIVERY_FAILED|" + recipientNick + "|" + originalContent, Timestamp: time.Now(),
				})
				c.send <- failMsg
			}
		case "KILL9":
			go handleKill9Request(c.hub, c.sessionID, c.Nickname)

		case "MAIL":
			// Mail is now sent with the stable ID, but the content format is the same
			if err := storeMessage(c.sessionID, msgString, c.IPAddress); err != nil {
				failMsg, _ := json.Marshal(ChatMessage{
					SessionID: c.sessionID, Message: "STORE_FAILED|" + err.Error(), Timestamp: time.Now(),
				})
				c.send <- failMsg
			} else {
				recipientNick := msgParts[3]
				successMsg, _ := json.Marshal(ChatMessage{
					SessionID: c.sessionID, Message: "STORE_SUCCESS|" + recipientNick, Timestamp: time.Now(),
				})
				c.send <- successMsg
			}
		case "MSG", "EMOTE", "ART", "PART", "ROLL", "FLIP", "ECHO":
			// Reconstruct message with nickname instead of ID for broadcast
			broadcastMsg := fmt.Sprintf("%s|%s|%s", msgType, c.Nickname, strings.Join(msgParts[2:], "|"))
			if err := broadcastAndStore(c.hub, c.sessionID, broadcastMsg, c.IPAddress); err != nil {
				failMsg, _ := json.Marshal(ChatMessage{
					SessionID: c.sessionID, Message: "STORE_FAILED|" + err.Error(), Timestamp: time.Now(),
				})
				c.send <- failMsg
			}
		default:
			log.Printf("Unknown message type received: %s", msgType)
		}
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
	api.HandleFunc("/history", historyHandler).Methods("GET")
	api.HandleFunc("/archive", archiveHandler).Methods("GET")
	api.HandleFunc("/session/check", sessionCheckHandler).Methods("GET")
	api.HandleFunc("/session/was_deleted", wasDeletedHandler).Methods("GET")
	api.HandleFunc("/mail/check", mailCheckHandler).Methods("GET")
	api.HandleFunc("/mail/out", mailOutHandler).Methods("GET")
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

	// Configure the connection pool
	db.SetConnMaxLifetime(time.Minute * 1) // Force connections to be recycled every minute
	db.SetConnMaxIdleTime(time.Second * 30) // Close connections that are idle for 30 seconds
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(10)

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

	messages := make([]ChatMessage, 0)
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

	messages := make([]ChatMessage, 0)
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

func mailCheckHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	recipientNick := r.URL.Query().Get("nick")
	if sessionID == "" || recipientNick == "" {
		http.Error(w, "Session ID and nickname are required", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Failed to start transaction: %v", err)
		http.Error(w, "Failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	query := `SELECT id, message, created_at FROM chat_messages WHERE session_id = ? AND message LIKE '%|U'`
	rows, err := tx.Query(query, sessionID)
	if err != nil {
		log.Printf("Database query error in mailCheckHandler: %v", err)
		http.Error(w, "Database query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messagesToDeliver := make([]ChatMessage, 0)
	var messagesToUpdate []struct {
		ID      int
		NewMessage string
	}

	for rows.Next() {
		var msg ChatMessage
		var id int
		if err := rows.Scan(&id, &msg.Message, &msg.Timestamp); err != nil {
			log.Printf("Failed to scan message row in mailCheckHandler: %v", err)
			continue
		}

		parts := strings.Split(msg.Message, "|")
		if len(parts) < 5 || parts[0] != "MAIL" || !strings.EqualFold(parts[2], recipientNick) {
			continue
		}

		// Simply replace the final "|U" with "|R" to mark as read, preserving all other parts.
		if !strings.HasSuffix(msg.Message, "|U") {
			continue // Already read or malformed
		}
		newMessage := strings.TrimSuffix(msg.Message, "|U") + "|R"

		messagesToUpdate = append(messagesToUpdate, struct {
			ID         int
			NewMessage string
		}{id, newMessage})

		msg.SessionID = sessionID
		messagesToDeliver = append(messagesToDeliver, msg)
	}
	if err := rows.Err(); err != nil {
		log.Printf("Row iteration error in mailCheckHandler: %v", err)
		http.Error(w, "Row iteration error", http.StatusInternalServerError)
		return
	}

	if len(messagesToUpdate) > 0 {
		stmt, err := tx.Prepare("UPDATE chat_messages SET message = ? WHERE id = ?")
		if err != nil {
			log.Printf("Failed to prepare update statement in mailCheckHandler: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer stmt.Close()

		for _, update := range messagesToUpdate {
			_, err := stmt.Exec(update.NewMessage, update.ID)
			if err != nil {
				log.Printf("Failed to update message status for ID %d: %v", update.ID, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction in mailCheckHandler: %v", err)
		http.Error(w, "Failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messagesToDeliver)
}

func mailOutHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	senderNick := r.URL.Query().Get("nick")
	if sessionID == "" || senderNick == "" {
		http.Error(w, "Session ID and nickname are required", http.StatusBadRequest)
		return
	}

	likePattern := fmt.Sprintf("MAIL|%s|%%", senderNick)
	rows, err := db.Query("SELECT message FROM chat_messages WHERE session_id = ? AND message LIKE ?", sessionID, likePattern)
	if err != nil {
		log.Printf("Database query error in mailOutHandler: %v", err)
		http.Error(w, "Database query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var response MailOutResponse
	for rows.Next() {
		var message string
		if err := rows.Scan(&message); err != nil {
			log.Printf("Failed to scan message row in mailOutHandler: %v", err)
			continue
		}
		response.Total++
		if strings.HasSuffix(message, "|U") {
			response.Unread++
		} else if strings.HasSuffix(message, "|R") {
			response.Read++
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("Row iteration error in mailOutHandler: %v", err)
		http.Error(w, "Row iteration error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sID")
	if !isSessionValid(sessionID) {
		log.Printf("WebSocket connection rejected for invalid session ID: %s", sessionID)
		return
	}

	ipAddress := r.Header.Get("X-Real-IP")
	if ipAddress == "" {
		ipAddress = r.Header.Get("X-Forwarded-For")
	}
	if ipAddress == "" {
		ipAddress = r.RemoteAddr
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan []byte, 256),
		sessionID: sessionID,
		IPAddress: ipAddress,
	}
	// The client is now registered in the readPump after the nickname is received.

	go client.writePump()
	go client.readPump()
}

func storeMessage(sessionID, message, ipAddress string) error {
	// Ping the database to ensure the connection is alive before executing the query.
	if err := db.Ping(); err != nil {
		log.Printf("Database ping failed: %v", err)
		// Try to re-establish the connection.
		initDB()
		if err := db.Ping(); err != nil {
			log.Printf("Database reconnect failed: %v", err)
			return err // Return error if reconnect fails
		}
	}
	_, err := db.Exec("INSERT INTO chat_messages(session_id, message, ip_address, created_at) VALUES(?, ?, ?, ?)", sessionID, message, ipAddress, time.Now())
	if err != nil {
		log.Printf("Failed to save message: %v", err)
		return err
	}
	return nil
}

func broadcastAndStore(hub *Hub, sessionID, message, ipAddress string) error {
	// Broadcast the message to all clients in the session via the hub FIRST.
	jsonMsg, err := json.Marshal(ChatMessage{
		SessionID: sessionID,
		Message:   message,
		Timestamp: time.Now(),
	})
	if err == nil {
		hub.broadcast <- BroadcastMessage{SessionID: sessionID, Message: jsonMsg}
	} else {
		log.Printf("Failed to marshal broadcast message for hub: %v", err)
	}

	// Now, store the message in the database and capture any error.
	dbErr := storeMessage(sessionID, message, ipAddress)
	if dbErr != nil {
		log.Printf("Failed to save broadcast message: %v", dbErr)
	}

	// Return the database error, if there was one.
	return dbErr
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
	h.sessionsMutex.Lock()
	defer h.sessionsMutex.Unlock()

	if session, ok := h.sessions[sessionID]; ok {
		for client := range session {
			select {
			case client.send <- message:
			default:
				close(client.send)
				delete(session, client)
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