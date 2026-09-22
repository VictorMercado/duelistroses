package api

import (
	"log"
	"net/http"
	"strings"

	"duelistRoses/game"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Browsers do not apply the same-origin policy to websockets, so this is
	// the only thing stopping another site from opening a socket against a
	// visitor's session. See origin.go for what counts as allowed.
	CheckOrigin: func(r *http.Request) bool {
		_, ok := resolveAllowedOrigin(r)
		if !ok {
			log.Printf("rejected websocket from origin %q", r.Header.Get("Origin"))
		}
		return ok
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

	// Every connection is a user first; whether that user ends up a player or a
	// spectator is decided just below and announced to the room on register.
	requestedRole := game.RoleSpectator
	if roleParam == "player" {
		requestedRole = game.RolePlayer
	}

	client := &game.Client{
		User: game.NewUser(name, requestedRole),
		Room: room,
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	if client.Role == game.RolePlayer && !room.TryAddClient(client) {
		// No free seat: watch instead of being turned away.
		client.Role = game.RoleSpectator
	}

	if client.Role == game.RoleSpectator && !room.TryAddClient(client) {
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Room is full"))
		conn.Close()
		return
	}

	client.Room.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
