package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"duelistRoses/game"
)

// ServeRoomMap answers GET /api/rooms/{roomId}/map with the room's board layout.
//
// The room is created on demand so a client can fetch the map before opening its
// websocket; the map is generated once per room, so every client that joins the
// same room renders the same board.
func ServeRoomMap(hub *game.Hub, w http.ResponseWriter, r *http.Request) {
	// Same policy as the websocket upgrader: allow any origin so a client served
	// from somewhere else (vite dev server, VITE_API_URL override) can read it.
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// /api/rooms/{roomId}/map
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "rooms" || parts[3] != "map" {
		http.NotFound(w, r)
		return
	}

	roomID := parts[2]
	if roomID == "" {
		http.Error(w, "Invalid room ID", http.StatusBadRequest)
		return
	}

	room, ok := hub.GetRoom(roomID)
	if !ok {
		room = hub.CreateRoom(roomID)
	}

	w.Header().Set("Content-Type", "application/json")
	// The layout never changes for the life of the room, but a room id can be
	// reused after the room is torn down, so do not let caches keep it.
	w.Header().Set("Cache-Control", "no-store")

	if err := json.NewEncoder(w).Encode(room.Map); err != nil {
		http.Error(w, "Failed to encode map", http.StatusInternalServerError)
	}
}
