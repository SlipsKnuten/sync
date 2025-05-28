package main

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
	SessionID string    `json:"sessionId,omitempty"`
	UserID    string    `json:"userId,omitempty"`
	UserName  string    `json:"userName,omitempty"`
}

type ContentUpdatePayload struct {
	Content string `json:"content"`
}

type UserInfoPayload struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Color string `json:"color"`
}

type RemoteCursorUpdatePayload struct {
	UserID     string      `json:"userId"`
	UserName   string      `json:"userName"`
	Color      string      `json:"color"`
	RangeData  interface{} `json:"rangeData"`
}

type CursorBroadcastPayload struct {
    UserID    string      `json:"userId"`
    UserName  string      `json:"userName"`
    Color     string      `json:"color"`
    RangeData interface{} `json:"rangeData"`
}