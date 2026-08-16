package api

import (
	"log"
	"math/rand"
	"net/http"
	"strings"

	"duelistRoses/game"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins for development
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func ServeWs(hub *game.Hub, w http.ResponseWriter, r *http.Request) {
	// Extract room ID from URL path, e.g., /ws/{roomId}
	pathParts := strings.Split(r.URL.Path, "/")
	if len(pathParts) < 3 {
		http.Error(w, "Invalid room ID", http.StatusBadRequest)
		return
	}
	roomID := pathParts[2]

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	room, _ := hub.GetRoom(roomID)
	if room == nil {
		room = hub.CreateRoom(roomID)
	}

	// Read query params for role
	query := r.URL.Query()
	roleParam := query.Get("role")

	// Read name from cookie
	name := "Anonymous"
	cookie, err := r.Cookie("name")
	if err == nil {
		name = cookie.Value
	}

	client := &game.Client{
		Room: room,
		Conn: conn,
		Send: make(chan []byte, 256),
		ID:   rand.Intn(1000000), // Default random ID
		Name: name,
	}

	// Assign roles based on limits using Room's mutex
	if roleParam == "player" {
		client.Role = game.RolePlayer
		if !room.TryAddClient(client) {
			// Fallback to spectator
			client.Role = game.RoleSpectator
			if !room.TryAddClient(client) {
				conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Room is full"))
				conn.Close()
				return
			}
		}
	} else {
		// Spectator role requested or default
		client.Role = game.RoleSpectator
		if !room.TryAddClient(client) {
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Room is full"))
			conn.Close()
			return
		}
	}

	client.Room.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
