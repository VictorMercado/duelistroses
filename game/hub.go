package game

import "sync"

type Hub struct {
	Rooms map[string]*Room
	Mu    sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		Rooms: make(map[string]*Room),
	}
}

func (h *Hub) GetRoom(id string) (*Room, bool) {
	h.Mu.RLock()
	defer h.Mu.RUnlock()
	room, ok := h.Rooms[id]
	return room, ok
}

func (h *Hub) CreateRoom(id string) *Room {
	h.Mu.Lock()
	defer h.Mu.Unlock()

	if room, ok := h.Rooms[id]; ok {
		return room
	}

	room := NewRoom(id, h)
	h.Rooms[id] = room
	go room.Run()

	return room
}

func (h *Hub) RemoveRoom(id string) {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	delete(h.Rooms, id)
}
