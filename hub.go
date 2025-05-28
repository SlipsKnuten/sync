package main

import (
	"log"
	"sync"
)

type Hub struct {
	sessions   map[string]*Session
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan Message),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		sessions:   make(map[string]*Session),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			session, ok := h.sessions[client.sessionID]
			if !ok {
				log.Printf("Session %s not found, creating new one.", client.sessionID)
				session = NewSession(client.sessionID)
				h.sessions[client.sessionID] = session
			}
			client.color = assignColorToClient(len(session.clients)) // Assign color
			session.AddClient(client)
			log.Printf("Client %s (%s, color %s) registered to session %s", client.userID, client.userName, client.color, client.sessionID)
			h.mu.Unlock()

			client.send <- Message{
				Type:      "initial_content",
				Payload:   ContentUpdatePayload{Content: session.GetContent()},
				SessionID: client.sessionID,
			}
			client.send <- Message{ // Send the client its own info including assigned color
				Type: "self_info",
				Payload: UserInfoPayload{
					ID:    client.userID,
					Name:  client.userName,
					Color: client.color,
				},
				SessionID: client.sessionID,
			}
			h.broadcastUserList(session)

		case client := <-h.unregister:
			h.mu.RLock()
			session, ok := h.sessions[client.sessionID]
			h.mu.RUnlock()
			if ok {
				removedClientColor := client.color // Get color before removing
				session.RemoveClient(client)
				close(client.send)
				log.Printf("Client %s (%s) unregistered from session %s", client.userID, client.userName, client.sessionID)
				
				// Notify other clients that this user left (and their cursor should be removed)
				userLeftMessage := Message{
					Type:      "user_left",
					Payload:   UserInfoPayload{ID: client.userID, Name: client.userName, Color: removedClientColor},
					SessionID: client.sessionID,
				}
				session.mu.RLock()
				for c := range session.clients {
					select {
					case c.send <- userLeftMessage:
					default:
						log.Printf("Client %s send channel full for user_left, closing.", c.userID)
						close(c.send)
						delete(session.clients, c) // Must be careful with concurrent map modification
					}
				}
				session.mu.RUnlock()
				h.broadcastUserList(session)
			}

		case message := <-h.broadcast:
			h.mu.RLock()
			session, ok := h.sessions[message.SessionID]
			h.mu.RUnlock()

			if !ok {
				log.Printf("Session %s not found for broadcast message type %s.", message.SessionID, message.Type)
				continue // Skip if session doesn't exist
			}

			session.mu.RLock() // Lock for reading clients map
			for c := range session.clients {
				shouldSend := true
				finalMessage := message // Start with the original message

				if message.Type == "cursor_update" {
					if c.userID == message.UserID { // Don't send cursor_update back to originator
						shouldSend = false
					} else {
						// Transform to remote_cursor_update for other clients
						// Extract the rangeData from the payload
						var cursorPayload map[string]interface{}
						if payload, ok := message.Payload.(map[string]interface{}); ok {
							cursorPayload = payload
						}
						
						// Create a complete remote cursor payload
						color := ""
						var rangeData interface{}
						if cursorPayload != nil {
							if colorStr, ok := cursorPayload["color"].(string); ok {
								color = colorStr
							}
							rangeData = cursorPayload["rangeData"]
						}
						
						// Get color from the client if not in payload
						if color == "" {
							for client := range session.clients {
								if client.userID == message.UserID {
									color = client.color
									break
								}
							}
						}
						
						log.Printf("Transforming cursor_update from %s to remote_cursor_update with color %s", message.UserID, color)
						
						finalMessage = Message{
							Type: "remote_cursor_update",
							Payload: map[string]interface{}{
								"userId":    message.UserID,
								"userName":  message.UserName,
								"color":     color,
								"rangeData": rangeData,
							},
							SessionID: message.SessionID,
						}
					}
				} else if message.Type == "content_update" {
					// Content updates are usually broadcast to all, including sender,
					// as client might rely on it for consistency or to simplify logic.
					// If content_update payload already has sender info, it's fine.
					// Otherwise, ensure it's set if needed by client.
					// Current 'ContentUpdatePayload' is just {Content: string}.
					// The original message object carries UserID, UserName.
				}

				if shouldSend {
					select {
					case c.send <- finalMessage:
					default:
						log.Printf("Client %s send channel full for message type %s, closing.", c.userID, finalMessage.Type)
						session.mu.RUnlock() // Unlock before modifying session.clients
						session.RemoveClient(c) // Remove client directly (needs careful locking if session.clients is modified elsewhere)
						close(c.send)
						session.mu.RLock() // Re-lock to continue iteration safely (though client is gone)
					}
				}
			}
			session.mu.RUnlock()

			// Handle content update persistence after broadcast
			if message.Type == "content_update" {
				var contentToSet string
				parsed := false
				if payload, ok := message.Payload.(map[string]interface{}); ok {
					if content, ok := payload["content"].(string); ok {
						contentToSet = content
						parsed = true
					}
				} else if payload, ok := message.Payload.(ContentUpdatePayload); ok {
					contentToSet = payload.Content
					parsed = true
				}

				if parsed {
					session.SetContent(contentToSet)
				} else {
					log.Printf("Unknown payload type for content_update persistence: %T", message.Payload)
				}
			} else if message.Type == "request_user_list" { // This should be handled by client registration
				h.broadcastUserList(session)
			}
		}
	}
}

func (h *Hub) broadcastUserList(session *Session) {
	userList := session.GetUserList() // This now needs to return UserInfoPayload with Color
	userListMessage := Message{
		Type:      "user_list_update",
		Payload:   userList,
		SessionID: session.ID,
	}
	session.mu.RLock()
	for c := range session.clients {
		select {
		case c.send <- userListMessage:
		default:
			log.Printf("Failed to send user list to client %s in session %s", c.userID, session.ID)
		}
	}
	session.mu.RUnlock()
}

func (h *Hub) GetSession(sessionID string) (*Session, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	session, ok := h.sessions[sessionID]
	return session, ok
}

var userColors = []string{"#FF6B6B", "#4ECDC4", "#45B7D1", "#FED766", "#2AB7CA", "#F0B67F", "#ED553B", "#9B59B6", "#3498DB", "#F1C40F", "#E74C3C", "#2ECC71"}
var colorMutex sync.Mutex // To protect lastColorIndex if Hub is ever run concurrently (not the case here but good practice)

func assignColorToClient(clientIndex int) string {
	colorMutex.Lock()
	defer colorMutex.Unlock()
	return userColors[clientIndex%len(userColors)]
}