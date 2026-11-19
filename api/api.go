// Package api is the game server's HTTP surface: the lobby, the websocket
// upgrade and the client's configuration.
package api

import (
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/cardlab"
	"duelistRoses/content"
	"duelistRoses/game"
	"duelistRoses/profile"
	"duelistRoses/replay"
)

type Server struct {
	Hub          *game.Hub
	Auth         *auth.Service
	LLMAvailable bool
	// LLMDefault is the model an LLM seat gets when it names none.
	LLMDefault  string
	DefaultTurn int
	Profiles    *profile.Store
	// Replays holds recorded duels; nil serves none.
	Replays *replay.Store
	// Arena runs administrators' test games between computer players.
	Arena *game.Arena
	// CardLab is the Claude conversation that designs cards.
	CardLab *cardlab.Lab

	social social
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Any origin may connect: a connection is authorised by the token in its
	// URL, never by cookies, so another site cannot ride on a player's session.
	CheckOrigin: func(*http.Request) bool { return true },
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// CORS lets a client served from another origin (VITE_API_URL) use the API.
// Tokens travel in the Authorization header, never in cookies.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/.well-known/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"llmBots":       s.LLMAvailable,
			"llmModels":     bot.Models,
			"llmDefault":    s.LLMDefault,
			"catalogLoaded": true,
		})
	})
	mux.HandleFunc("GET /api/rooms", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.Hub.List())
	})
	mux.HandleFunc("POST /api/rooms", s.createRoom)
	// Duels the caller is seated in, to rejoin after a dropped connection or a reload.
	mux.HandleFunc("GET /api/rooms/mine", func(w http.ResponseWriter, r *http.Request) {
		user, _, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		writeJSON(w, http.StatusOK, s.Hub.Seated(user.ID))
	})
	mux.HandleFunc("GET /ws/{room}", s.serveWS)
	s.registerFriends(mux)
	s.registerAdmin(mux)
	s.registerProfiles(mux)
	s.registerReplays(mux)
}

// Map choices that are not a map id.
const (
	MapRandom   = "random"   // a random saved map
	MapGenerate = "generate" // a newly generated map
)

type createRoomRequest struct {
	ID          string   `json:"id"`
	Mode        string   `json:"mode"`
	Seats       []string `json:"seats"` // "human", "bot", "bot:<personality>", "bot:llm" or "bot:llm:<model>"
	Size        int      `json:"size"`
	MapID       string   `json:"mapId"` // a map id, MapRandom, or MapGenerate (also when empty)
	TurnSeconds *int     `json:"turnSeconds"`
	// Lobby rooms wait for the host to start; private ones are not listed.
	Lobby   bool `json:"lobby"`
	Private bool `json:"private"`
	// Sandbox opens an administrator's test table (see game.Options.Sandbox).
	Sandbox bool `json:"sandbox"`
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	user, _, err := s.Auth.FromRequest(r)
	if err != nil {
		fail(w, http.StatusUnauthorized, "sign in first")
		return
	}
	var req createRoomRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "malformed request")
		return
	}

	if req.Sandbox && !user.Admin {
		fail(w, http.StatusForbidden, "the sandbox is for administrators")
		return
	}
	opts := game.Options{
		Mode: req.Mode, Size: req.Size, TurnSeconds: s.DefaultTurn,
		Lobby: req.Lobby, Private: req.Private, HostID: user.ID, HostAdmin: user.Admin,
		Sandbox: req.Sandbox,
	}
	if req.TurnSeconds != nil {
		opts.TurnSeconds = *req.TurnSeconds
	}
	for _, seat := range req.Seats {
		kind, botKind, _ := strings.Cut(seat, ":")
		opts.Seats = append(opts.Seats, game.SeatSpec{Kind: kind, BotKind: botKind})
	}

	switch req.MapID {
	case "", MapGenerate:
		// The room generates a fresh map when the duel starts.
	case MapRandom:
		// One of the saved maps, default or player-made, that fits the board.
		size := req.Size
		if size == 0 {
			size = 7
			if req.Mode == "2v2" {
				size = 9
			}
		}
		opts.Map = s.Hub.Content.RandomMap(user.ID, size) // nil: none fits, so generate one
	default:
		m, err := s.Hub.Content.Map(req.MapID, user.ID)
		if err != nil {
			fail(w, http.StatusBadRequest, "that map does not exist, or is not yours to use")
			return
		}
		opts.Map = m
	}

	room, err := s.create(req.ID, opts)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, game.ErrNoCatalog) {
			status = http.StatusServiceUnavailable
		}
		fail(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, room.Info())
}

// create opens a room with the starter decks its bots will play. They are
// always given: a lobby's host can add computer players later.
func (s *Server) create(id string, opts game.Options) (*game.Room, error) {
	return s.Hub.Create(id, opts, s.Hub.Content.StarterDecks())
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	user, _, err := s.Auth.FromRequest(r)
	if err != nil {
		refuseWS(w, r, http.StatusUnauthorized, "sign in first")
		return
	}
	id := r.PathValue("room")
	query := r.URL.Query()
	watch, spectate, err := parseWatch(query.Get("spectate"))
	if err != nil {
		refuseWS(w, r, http.StatusBadRequest, err.Error())
		return
	}

	room := s.Hub.Get(id)
	if room == nil && spectate {
		refuseWS(w, r, http.StatusNotFound, "that room is gone")
		return
	}
	if spectate {
		if message := s.mayWatch(user, watch, room.Info()); message != "" {
			refuseWS(w, r, http.StatusForbidden, message)
			return
		}
	}
	if room == nil {
		// Joining a room nobody made yet opens a lobby with the joiner as host.
		room, err = s.create(id, game.Options{Mode: "1v1", TurnSeconds: s.DefaultTurn, Lobby: true, HostID: user.ID})
		if errors.Is(err, game.ErrRoomExists) {
			room, err = s.Hub.Get(id), nil
		}
		if err != nil || room == nil {
			status := http.StatusBadRequest
			if errors.Is(err, game.ErrNoCatalog) {
				status = http.StatusServiceUnavailable
			}
			refuseWS(w, r, status, errString(err, "that room is gone"))
			return
		}
	}

	var deck *content.Deck
	if !spectate {
		deck, err = s.pickDeck(query.Get("deck"), user.ID)
		if err != nil {
			refuseWS(w, r, http.StatusBadRequest, err.Error())
			return
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	client := game.NewClient(user, room, conn)
	room.Join(client, deck, watch)
	client.Serve()
}

// refuseWS turns a connection away with a reason the player can read. A
// browser cannot see the status of a refused upgrade, only that the socket
// closed, which looks like a network fault and is retried. So a websocket
// request is accepted and then closed with the reason: code 4000 plus the
// HTTP status, which the client takes as final.
func refuseWS(w http.ResponseWriter, r *http.Request, status int, message string) {
	if !websocket.IsWebSocketUpgrade(r) {
		fail(w, status, message)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.WriteJSON(map[string]string{"t": "error", "message": message})
	conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4000+status, message), time.Now().Add(time.Second))
	log.Printf("ws %s refused (%d): %s", r.URL.Path, status, message)
}

// parseWatch reads how someone wants to spectate: "seat:2" (through whoever
// sits there), "team:1" (that team, without a hand), "user:<id>" (through
// that player), "admin" (everything), "all" (everything, in a duel between
// computer players only) or "display" (the arena display: the board on a
// shared screen, face up only, while the players play from their phones).
func parseWatch(raw string) (game.Watch, bool, error) {
	if raw == "" {
		return game.Watch{}, false, nil
	}
	kind, value, _ := strings.Cut(raw, ":")
	w := game.Watch{Set: true, Seat: -1}
	switch kind {
	case "admin":
		w.Admin = true
	case "all":
		w.All = true
	case "display":
		w.Display = true
	case "user":
		w.User = value
	case "seat", "team":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || n > 3 {
			return w, true, errors.New("choose a player or a team to watch")
		}
		// Seats alternate teams, so a team is named by its first seat.
		w.Seat, w.TeamOnly = n, kind == "team"
	default:
		return w, true, errors.New("choose a player or a team to watch")
	}
	if w.User == "" && w.Seat < 0 && !w.Admin && !w.All && !w.Display {
		return w, true, errors.New("choose a player or a team to watch")
	}
	return w, true, nil
}

// mayWatch decides whether a user may spectate the way they asked, returning
// why not. Anyone may watch a public duel from one side. A private room is
// for friends: the watcher must be a friend of a player on that side. Only an
// administrator gets the view with nothing hidden.
func (s *Server) mayWatch(user auth.User, w game.Watch, room game.RoomInfo) string {
	if w.Display {
		// The room checks again when the screen joins (Room.mayDisplay):
		// seats can change in between.
		if user.ID == room.HostID {
			return ""
		}
		for _, seat := range room.Seats {
			if seat.Kind == game.KindHuman && seat.UserID == user.ID {
				return ""
			}
		}
		return "only the host or a player in this room can make this screen its arena display"
	}
	if w.Admin {
		if !user.Admin {
			return "that view is for administrators"
		}
		return ""
	}
	if w.All {
		// Nothing is hidden only where nobody plays: computer players alone.
		for _, seat := range room.Seats {
			if seat.Kind != game.KindBot {
				return "seeing everything is only for duels between computer players"
			}
		}
		if user.Admin || !room.Private || user.ID == room.HostID {
			return ""
		}
		return "this is a private duel"
	}
	if user.Admin || !room.Private {
		return ""
	}
	team := -1
	for _, seat := range room.Seats {
		if (w.User != "" && seat.UserID == w.User) || (w.User == "" && seat.Index == w.Seat) {
			team = seat.Team
		}
	}
	for _, seat := range room.Seats {
		if seat.Team == team && seat.UserID != "" && s.Auth.Friends.AreFriends(user.ID, seat.UserID) {
			return ""
		}
	}
	return "this is a private duel: only friends of the players can watch"
}

func errString(err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	return fallback
}

// pickDeck finds the deck a player asked for (a starter, a public deck or
// their own), or a random starter deck when they asked for none.
func (s *Server) pickDeck(id, userID string) (*content.Deck, error) {
	if id == "" {
		decks := s.Hub.Content.StarterDecks()
		if len(decks) == 0 {
			return nil, errors.New("there are no starter decks")
		}
		return &decks[rand.Intn(len(decks))], nil
	}
	deck, err := s.Hub.Content.Deck(id, userID)
	if err != nil {
		return nil, errors.New("that deck does not exist, or is not yours to use")
	}
	// Decks are checked when saved; check again in case the catalog changed since.
	if problem := content.CheckDeck(s.Hub.Content.Catalog(), deck.Name, deck.LeaderNum, deck.Cards); problem != "" {
		return nil, errors.New(problem)
	}
	return deck, nil
}
