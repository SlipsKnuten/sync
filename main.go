package main

import (
	"flag"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"text/template"
	"github.com/SebastiaanKlippert/go-wkhtmltopdf"
	"github.com/gingfrederik/docx"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/k3a/html2text"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	absPath, err := filepath.Abs("./static/index.html")
	if err != nil {
		log.Printf("Error getting absolute path: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	tmpl, err := template.ParseFiles(absPath)
	if err != nil {
		log.Printf("Error parsing template: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	err = tmpl.Execute(w, nil)
	if err != nil {
		log.Printf("Error executing template: %v", err)
	}
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	userName := r.URL.Query().Get("name")
	userID := r.URL.Query().Get("userId")

	if sessionID == "" {
		log.Println("Session ID is required for WebSocket")
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}
	if userName == "" {
		userName = "Anonymous"
	}
	if userID == "" {
		userID = uuid.New().String()
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	client := &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan Message, 256),
		sessionID: sessionID,
		userID:    userID,
		userName:  userName,
	}
	client.hub.register <- client
	go client.writePump()
	go client.readPump()
	log.Printf("Client connected: UserID %s, UserName %s, SessionID %s", userID, userName, sessionID)
}

func handleDownload(hub *Hub, w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session")
	format := r.URL.Query().Get("format")

	if sessionID == "" {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}
	session, ok := hub.GetSession(sessionID)
	if !ok {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	htmlContent := session.GetContent()
	log.Printf("Session %s content for download: '%s'", sessionID, htmlContent)
	fullHtmlForPdf := "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>" + sessionID + "</title></head><body>" + htmlContent + "</body></html>"
	filename := sessionID

	switch format {
	case "txt":
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".txt")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		text := html2text.HTML2Text(htmlContent)
		_, err := io.WriteString(w, text)
		if err != nil {
			log.Printf("Error writing TXT: %v", err)
		}
	case "html":
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, err := io.WriteString(w, htmlContent)
		if err != nil {
			log.Printf("Error writing HTML: %v", err)
		}
	case "docx":
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".docx")
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		
		file := docx.NewFile()

		textContent := html2text.HTML2Text(htmlContent)
		lines := strings.Split(textContent, "\n")
		for _, line := range lines {
			para := file.AddParagraph()
			para.AddText(line) 
		}
		err := file.Write(w) 
		if err != nil {
			log.Printf("Error writing DOCX (gingfrederik/docx): %v", err)
		}
	case "pdf":
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".pdf")
		w.Header().Set("Content-Type", "application/pdf")
		pdfg, err := wkhtmltopdf.NewPDFGenerator()
		if err != nil {
			log.Printf("Error creating PDF generator: %v", err)
			http.Error(w, "Error setting up PDF generation. Is wkhtmltopdf installed and in PATH?", http.StatusInternalServerError)
			return
		}
		pdfg.AddPage(wkhtmltopdf.NewPageReader(strings.NewReader(fullHtmlForPdf)))
		err = pdfg.Create()
		if err != nil {
			log.Printf("Error generating PDF: %v", err)
			http.Error(w, "Error generating PDF. Check wkhtmltopdf output/logs if possible.", http.StatusInternalServerError)
			return
		}
		pdfBytes := pdfg.Bytes()
		_, err = w.Write(pdfBytes) 
		if err != nil && err.Error() != "http: wrote more than the declared Content-Length" {
			log.Printf("Error writing PDF to response: %v", err)
		}
	default:
		http.Error(w, "Unsupported format", http.StatusBadRequest)
		return
	}
}


func main() {
	var addr = flag.String("addr", "0.0.0.0:8080", "http service address") 
	flag.Parse()

	hub := NewHub()
	go hub.Run()

	http.HandleFunc("/", serveHome)
	http.Handle("/css/", http.StripPrefix("/css/", http.FileServer(http.Dir("./static/css"))))
	http.Handle("/js/", http.StripPrefix("/js/", http.FileServer(http.Dir("./static/js"))))

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	http.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
		handleDownload(hub, w, r)
	})

	log.Println("Server starting on", *addr)
	err := http.ListenAndServe(*addr, nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
