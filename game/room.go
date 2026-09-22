package game

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
)

type Room struct {
	ID string

	// Registered clients.
	Clients map[*Client]bool

	// Inbound messages from the clients.
	Broadcast chan []byte

	// Register requests from the clients.
	Register chan *Client

	// Unregister requests from clients.
	Unregister chan *Client

	// Room State
	GameState *GameState

	// Board layout, generated once when the room is created and shared by every
	// client that joins (read-only after construction).
	Map *GameMap

	// Spectators are capped separately; player capacity is the seat list.
	SpectatorsCount int
	mu              sync.Mutex

	Hub *Hub
}

func NewRoom(id string, hub *Hub) *Room {
	state := NewInitialGameState()
	return &Room{
		ID:         id,
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[*Client]bool),
		GameState:  state,
		Map:        NewGameMap(state.GridSize),
		Hub:        hub,
	}
}

// TryAddClient seats the client if the room has room for its role.
func (r *Room) TryAddClient(client *Client) bool {
	if client.Role == RolePlayer {
		return r.ClaimSeat(client) != nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.SpectatorsCount < 20 {
		r.SpectatorsCount++
		return true
	}
	return false
}

// roster lists everybody currently connected. Only called from Run, which owns
// the Clients map.
func (r *Room) roster() []User {
	users := make([]User, 0, len(r.Clients))
	for client := range r.Clients {
		users = append(users, client.Snapshot())
	}
	return users
}

// broadcastUser tells every subscriber that a user arrived or left, and what
// that user is - a player or a spectator.
func (r *Room) broadcastUser(eventType string, user User) {
	b, err := json.Marshal(OutgoingMessage{
		Type:    eventType,
		Payload: UserPayload{User: user, Users: r.roster()},
	})
	if err != nil {
		log.Printf("failed to marshal %s: %v", eventType, err)
		return
	}

	for client := range r.Clients {
		select {
		case client.Send <- b:
		default:
		}
	}
}

// usersByID indexes the connected users so seats can be shown with the name and
// colours of whoever is sitting in them. Only called from Run, which owns the
// Clients map.
func (r *Room) usersByID() map[string]*User {
	users := make(map[string]*User, len(r.Clients))
	for client := range r.Clients {
		users[client.ID] = client.User
	}
	return users
}

// stateMessageFor renders the state as this client is allowed to see it.
func (r *Room) stateMessageFor(client *Client, eventType string) []byte {
	users := r.usersByID()

	r.GameState.mu.RLock()
	payload := InitStatePayload{
		GameState: r.GameState.ViewForUnsafe(client.ID, users),
		YourID:    client.ID,
		YourRole:  client.Role,
		YourHand:  r.GameState.HandCardsUnsafe(client.ID),
		You:       client.Snapshot(),
		Users:     r.roster(),
	}
	r.GameState.mu.RUnlock()

	b, err := json.Marshal(OutgoingMessage{Type: eventType, Payload: payload})
	if err != nil {
		log.Printf("failed to marshal %s: %v", eventType, err)
		return nil
	}
	return b
}

// syncAllExcept pushes a fresh, per-client state to everyone in the room. Used
// when the roster changes, since each client sees a different hand.
func (r *Room) syncAllExcept(skip *Client) {
	for client := range r.Clients {
		if client == skip {
			continue
		}
		if b := r.stateMessageFor(client, EventStateSync); b != nil {
			select {
			case client.Send <- b:
			default:
			}
		}
	}
}

func (r *Room) Run() {
	for {
		select {
		case client := <-r.Register:
			r.Clients[client] = true

			if b := r.stateMessageFor(client, EventInitState); b != nil {
				client.Send <- b
			}
			// Tell the whole room who just turned up and what they are.
			r.broadcastUser(EventUserJoined, client.Snapshot())
			// Everyone else needs to see the new seat fill up.
			r.syncAllExcept(client)

		case client := <-r.Unregister:
			if _, ok := r.Clients[client]; ok {
				delete(r.Clients, client)
				close(client.Send)
				departed := client.Snapshot()

				if client.Role == RolePlayer {
					r.ReleaseSeat(client)
				} else {
					r.mu.Lock()
					r.SpectatorsCount--
					r.mu.Unlock()
				}

				if len(r.Clients) == 0 {
					r.Hub.RemoveRoom(r.ID)
					return // stop room goroutine
				}

				r.broadcastUser(EventUserLeft, departed)
				r.syncAllExcept(nil)
			}
		case message := <-r.Broadcast:
			for client := range r.Clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(r.Clients, client)
				}
			}
		}
	}
}

func (r *Room) ProcessMessage(client *Client, msg IncomingMessage) {
	// Only players can take action
	if client.Role != RolePlayer {
		r.SendError(client, "Spectators cannot perform actions")
		return
	}

	switch msg.Type {
	case EventEndTurn:
		r.GameState.mu.Lock()
		activePlayer := r.GameState.GetActivePlayerUnsafe()
		if activePlayer == nil {
			r.GameState.mu.Unlock()
			r.SendError(client, "The game has no active player")
			return
		}
		if client.ID != activePlayer.ID {
			r.GameState.mu.Unlock()
			r.SendError(client, fmt.Sprintf("Not your turn. It is %s's turn.", activePlayer.ID))
			return
		}

		// Reset moved flag for current player's cards
		for _, card := range r.GameState.Cards {
			if card.Owner == activePlayer.Owner {
				card.HasMoved = false
			}
		}

		// Increment turn
		r.GameState.PlayerTurnIndex++
		nextPlayer := r.GameState.GetActivePlayerUnsafe()
		r.GameState.mu.Unlock()

		outMsg := OutgoingMessage{
			Type: EventEndTurn,
			Payload: EndTurnPayload{
				NextPlayerID: nextPlayer.ID,
			},
		}
		b, _ := json.Marshal(outMsg)
		r.Broadcast <- b

	case EventMoveCard:
		var payload MoveCardPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			r.SendError(client, "Invalid payload for move card")
			return
		}

		r.GameState.mu.Lock()
		card := r.GameState.GetCardUnsafe(payload.CardID)
		if card == nil {
			r.GameState.mu.Unlock()
			r.SendError(client, "Card not found")
			return
		}

		activePlayer := r.GameState.GetActivePlayerUnsafe()
		if client.ID != activePlayer.ID {
			r.GameState.mu.Unlock()
			r.SendError(client, fmt.Sprintf("Not your turn. It is %s's turn.", activePlayer.ID))
			return
		}

		if card.HasMoved {
			r.GameState.mu.Unlock()
			r.SendError(client, "Card has already moved this turn")
			return
		}

		if !card.Position.IsAdjacent(payload.TargetTile) {
			r.GameState.mu.Unlock()
			r.SendError(client, "Invalid move: can only move exactly 1 tile horizontally or vertically")
			return
		}

		bounds := float64(r.GameState.GridSize / 2)
		if payload.TargetTile.X < -bounds || payload.TargetTile.X > bounds ||
			payload.TargetTile.Y < -bounds || payload.TargetTile.Y > bounds {
			r.GameState.mu.Unlock()
			r.SendError(client, "Invalid move: target tile is out of bounds")
			return
		}

		card.Position.X = payload.TargetTile.X
		card.Position.Y = payload.TargetTile.Y
		card.HasMoved = true
		r.GameState.mu.Unlock()

		outMsg := OutgoingMessage{
			Type:    EventMoveCard,
			Payload: payload,
		}
		b, _ := json.Marshal(outMsg)
		r.Broadcast <- b

	case EventDrawCard:
		var payload DrawCardPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.BroadcastMessage(EventDrawCard, payload)
		}
	case EventCardDestroyed:
		var payload CardDestroyedPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.BroadcastMessage(EventCardDestroyed, payload)
		}
	case EventCardPlayed:
		var payload CardPlayedPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.BroadcastMessage(EventCardPlayed, payload)
		}
	case EventCardAttacked:
		var payload CardAttackedPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.BroadcastMessage(EventCardAttacked, payload)
		}
	case EventCardActivated:
		var payload CardActivatedPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.BroadcastMessage(EventCardActivated, payload)
		}
	case EventCardChangedPosition:
		var payload CardChangedPositionPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			r.SendError(client, "Invalid payload for card position")
			return
		}

		r.GameState.mu.Lock()
		card := r.GameState.GetCardUnsafe(payload.CardID)
		if card == nil {
			r.GameState.mu.Unlock()
			r.SendError(client, "Card not found")
			return
		}

		// Only the side that owns a card may turn it over, otherwise a client
		// could flip an opponent's card face up just to read it.
		player := r.GameState.getPlayerUnsafe(client.ID)
		if player == nil || card.Owner != player.Owner {
			r.GameState.mu.Unlock()
			r.SendError(client, "That card belongs to the other side")
			return
		}

		card.IsDefenseMode = payload.IsDefenseMode
		card.IsFaceDown = payload.IsFaceDown

		// A face-up card is public knowledge, so hand the room its real data.
		// While it stays face down the broadcast carries nothing identifying.
		if !card.IsFaceDown {
			revealed := *card
			payload.Card = &revealed
		}
		r.GameState.mu.Unlock()

		r.BroadcastMessage(EventCardChangedPosition, payload)

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

// GetCardUnsafe assumes lock is already held
func (s *GameState) GetCardUnsafe(id int) *Card {
	for _, c := range s.Cards {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// GetActivePlayerUnsafe assumes lock is already held
func (s *GameState) GetActivePlayerUnsafe() *Player {
	if len(s.Players) == 0 {
		return nil
	}
	return s.Players[s.PlayerTurnIndex%len(s.Players)]
}

func (r *Room) SendError(client *Client, message string) {
	msg := OutgoingMessage{
		Type: EventError,
		Payload: ErrorPayload{
			Message: message,
		},
	}
	b, _ := json.Marshal(msg)

	// Non-blocking write to avoid panicking if channel is closed
	select {
	case client.Send <- b:
	default:
		log.Printf("Failed to send error message to user %s, channel might be full/closed", client.ID)
	}
}

func (r *Room) BroadcastMessage(msgType string, payload interface{}) {
	msg := OutgoingMessage{
		Type:    msgType,
		Payload: payload,
	}
	b, err := json.Marshal(msg)
	if err == nil {
		r.Broadcast <- b
	}
}

// NewInitialGameState starts a room with no players and an empty board. Seats
// (and their cards) are built as clients join, see seats.go.
func NewInitialGameState() *GameState {
	return &GameState{
		Players:         []*Player{},
		Cards:           []*Card{},
		PlayerTurnIndex: 0,
		GridSize:        11, // large enough to cover coordinates -5 to +5
		cardsByID:       make(map[int]*Card),
	}
}
