package game

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"
	"sort"
	"sync"

	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/profile"
	"duelistRoses/replay"
)

// Hub is the set of rooms on this server.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	// Which room each connected user is in, for friends lists.
	presence map[string]string

	Content *content.Service
	// NewBot builds a computer player of the given kind ("llm" or anything
	// else for the rule-based one).
	NewBot func(kind string) bot.Bot
	// Profiles is where finished duels are recorded; nil records nothing.
	Profiles *profile.Store
	// Replays is where duels are recorded to be watched again; nil records
	// nothing.
	Replays *replay.Store
}

func NewHub(c *content.Service, newBot func(string) bot.Bot) *Hub {
	return &Hub{rooms: map[string]*Room{}, presence: map[string]string{}, Content: c, NewBot: newBot}
}

var roomIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

var (
	ErrRoomExists   = errors.New("a room with that name already exists")
	ErrBadRoomID    = errors.New("a room name is 1 to 32 letters, digits, dashes or underscores")
	ErrNoCatalog    = errors.New("the card catalog is not loaded")
	ErrTooManyRooms = errors.New("the server is full")
)

const maxRooms = 500

// Count is the number of rooms open right now.
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms)
}

func (h *Hub) Get(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[id]
}

// Normalize fills in what a caller left out and rejects what makes no sense.
func (o *Options) Normalize() error {
	if o.Sandbox {
		// One administrator against their own puppet, in private, untimed.
		o.Mode, o.Lobby, o.Private, o.TurnSeconds = "1v1", false, true, 0
		o.Seats = []SeatSpec{{Kind: KindHuman}, {Kind: KindPuppet}}
	}
	if o.Mode != "2v2" {
		o.Mode = "1v1"
	}
	want := 2
	if o.Mode == "2v2" {
		want = 4
	}
	for len(o.Seats) < want {
		o.Seats = append(o.Seats, SeatSpec{Kind: KindHuman})
	}
	o.Seats = o.Seats[:want]
	// Every seat may be a computer player: such a duel is played out for
	// whoever watches it (see Room.botsOnly).
	for i := range o.Seats {
		if o.Seats[i].Kind != KindBot && !(o.Sandbox && o.Seats[i].Kind == KindPuppet) {
			o.Seats[i].Kind = KindHuman
		}
	}
	if o.Map != nil {
		o.Size = o.Map.Size
	}
	if o.Size == 0 {
		o.Size = 7
		if o.Mode == "2v2" {
			o.Size = 9
		}
	}
	if o.Size < 5 || o.Size > 13 || o.Size%2 == 0 {
		return errors.New("a board is 5, 7, 9, 11 or 13 squares wide")
	}
	if o.TurnSeconds < 0 || o.TurnSeconds > 600 {
		return errors.New("a turn lasts at most 600 seconds")
	}
	return nil
}

// Create opens a room. An empty id gets a random one.
func (h *Hub) Create(id string, opts Options, botDecks []content.Deck) (*Room, error) {
	if err := opts.Normalize(); err != nil {
		return nil, err
	}
	catalog := h.Content.Catalog()
	if catalog == nil {
		return nil, ErrNoCatalog
	}
	if id == "" {
		b := make([]byte, 4)
		rand.Read(b)
		id = hex.EncodeToString(b)
	}
	if !roomIDPattern.MatchString(id) {
		return nil, ErrBadRoomID
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.rooms[id]; exists {
		return nil, ErrRoomExists
	}
	if len(h.rooms) >= maxRooms {
		return nil, ErrTooManyRooms
	}
	room := newRoom(id, h, opts, catalog, botDecks)
	h.rooms[id] = room
	go room.run()
	return room, nil
}

func (h *Hub) remove(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms, id)
}

func (h *Hub) setPresence(userID, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.presence[userID] = roomID
}

func (h *Hub) clearPresence(userID, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.presence[userID] == roomID {
		delete(h.presence, userID)
	}
}

// RoomOf is the room a user is connected to, or "".
func (h *Hub) RoomOf(userID string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.presence[userID]
}

// Seated lists the duels in progress where the user holds a seat, public or
// private, so a player who lost their connection can find the way back.
func (h *Hub) Seated(userID string) []RoomInfo {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()

	infos := []RoomInfo{}
	for _, r := range rooms {
		info := r.Info()
		if !info.Started || info.Finished {
			continue
		}
		for _, s := range info.Seats {
			if s.Kind == KindHuman && s.UserID == userID {
				infos = append(infos, info)
				break
			}
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
	return infos
}

// List describes every public room, for the lobby.
func (h *Hub) List() []RoomInfo { return h.list(false) }

// All describes every room, private ones too, for administrators.
func (h *Hub) All() []RoomInfo { return h.list(true) }

// Close shuts a room down, whatever state its duel is in, telling everyone in
// it why. It reports whether there was such a room.
func (h *Hub) Close(id, reason string) bool {
	room := h.Get(id)
	if room == nil {
		return false
	}
	room.Shutdown(reason)
	return true
}

func (h *Hub) list(private bool) []RoomInfo {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()

	infos := make([]RoomInfo, 0, len(rooms))
	for _, r := range rooms {
		if info := r.Info(); private || !info.Private {
			infos = append(infos, info)
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
	return infos
}
