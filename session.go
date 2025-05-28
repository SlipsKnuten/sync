package main

import (
	"sync"
	"math/rand"
	"time"
)

const sessionCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const sessionCodeLength = 6

type Session struct {
	ID      string
	clients map[*Client]bool
	Content string
	mu      sync.RWMutex 
}

func NewSession(id string) *Session {
	if id == "" {
		id = generateSessionCode()
	}
	return &Session{
		ID:      id,
		clients: make(map[*Client]bool),
		Content: "<p>Welcome to DocCollab! Start typing...</p><div class=\"cursor\"></div>", 
	}
}

func (s *Session) AddClient(client *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[client] = true
}

func (s *Session) RemoveClient(client *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.clients[client]; ok {
		delete(s.clients, client)
	}
}

func (s *Session) SetContent(content string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Content = content
}

func (s *Session) GetContent() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Content
}

func (s *Session) GetUserList() []UserInfoPayload {
    s.mu.RLock()
    defer s.mu.RUnlock()
    users := []UserInfoPayload{}
    for c := range s.clients {
        users = append(users, UserInfoPayload{ID: c.userID, Name: c.userName, Color: c.color})
    }
    return users
}


func generateSessionCode() string {
	rand.Seed(time.Now().UnixNano())
	b := make([]byte, sessionCodeLength)
	for i := range b {
		b[i] = sessionCodeChars[rand.Intn(len(sessionCodeChars))]
	}
	return string(b)
}