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

	// Track players vs spectators count
	PlayersCount    int
	SpectatorsCount int
	AvailablePlayerSlots []int
	mu              sync.Mutex

	Hub *Hub
}

func NewRoom(id string, hub *Hub) *Room {
	return &Room{
		ID:         id,
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[*Client]bool),
		GameState:  NewInitialGameState(),
		Hub:        hub,
		AvailablePlayerSlots: []int{0, 1, 2, 3}, // indices into GameState.Players
	}
}

// AddClient returns true if the client can join as the requested role, and updates the counters safely.
func (r *Room) TryAddClient(client *Client) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if client.Role == RolePlayer {
		if len(r.AvailablePlayerSlots) > 0 {
			// pop first available slot
			slot := r.AvailablePlayerSlots[0]
			r.AvailablePlayerSlots = r.AvailablePlayerSlots[1:]

			// Assign Player ID deterministically to avoid races
			if slot < len(r.GameState.Players) {
				client.ID = r.GameState.Players[slot].ID
				client.PlayerSlot = slot
			}
			r.PlayersCount++
			return true
		}
		return false
	} else {
		if r.SpectatorsCount < 20 {
			r.SpectatorsCount++
			return true
		}
		return false
	}
}

func (r *Room) Run() {
	for {
		select {
		case client := <-r.Register:
			r.Clients[client] = true

			// Send initial state safely
			r.GameState.mu.RLock()
			initState := InitStatePayload{
				GameState: r.GameState,
				YourID:    client.ID,
				YourRole:  client.Role,
			}
			b, _ := json.Marshal(OutgoingMessage{
				Type:    EventInitState,
				Payload: initState,
			})
			r.GameState.mu.RUnlock()

			client.Send <- b

		case client := <-r.Unregister:
			if _, ok := r.Clients[client]; ok {
				delete(r.Clients, client)
				close(client.Send)

				r.mu.Lock()
				if client.Role == RolePlayer {
					r.PlayersCount--
					// push slot back
					r.AvailablePlayerSlots = append(r.AvailablePlayerSlots, client.PlayerSlot)
				} else {
					r.SpectatorsCount--
				}
				r.mu.Unlock()

				if len(r.Clients) == 0 {
					r.Hub.RemoveRoom(r.ID)
					return // stop room goroutine
				}
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
		if client.ID != activePlayer.ID {
			r.GameState.mu.Unlock()
			r.SendError(client, fmt.Sprintf("Not your turn. It is player %d's turn.", activePlayer.ID))
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
			Type:    EventEndTurn,
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
			r.SendError(client, fmt.Sprintf("Not your turn. It is player %d's turn.", activePlayer.ID))
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
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			r.GameState.mu.Lock()
			card := r.GameState.GetCardUnsafe(payload.CardID)
			if card != nil {
				card.IsDefenseMode = payload.IsDefenseMode
				card.IsFaceDown = payload.IsFaceDown
			}
			r.GameState.mu.Unlock()
			r.BroadcastMessage(EventCardChangedPosition, payload)
		}
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
		log.Printf("Failed to send error message to client %d, channel might be full/closed", client.ID)
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

func NewInitialGameState() *GameState {

	darkMagician := &Card{
		ID: 1, Name: "Dark Magician", Attack: 2500, Defense: 2100, Owner: PlayerOwner,
		Position: Vector3{X: 2, Y: -5, Z: 0.11}, IsFaceDown: true, IsDefenseMode: false, HasMoved: false,
		Rarity: "ultra", Level: 8, Type: "normal", Attribute: Attribute{Type: "dark"},
		TemplateUrl: "/assets/textures/normalTemplate.png", TextureUrl: "/assets/cards/Dark_Magician.png", MaskUrl: "/assets/cards/Dark_Magician_Mask.png",
		Monster: &MonsterKind{Monster: "spellcaster", StrongIn: []TerrainType{}, WeakIn: []TerrainType{}},
	}

	blueEyes := &Card{
		ID: 2, Name: "Blue-Eyes White Dragon", Attack: 3000, Defense: 2500, Owner: OpponentOwner,
		Position: Vector3{X: 0, Y: 4, Z: 0.12}, IsFaceDown: true, IsDefenseMode: false, HasMoved: false,
		Rarity: "ultra", Level: 8, Type: "normal", Attribute: Attribute{Type: "light"},
		TemplateUrl: "/assets/textures/normalTemplate.png", TextureUrl: "/assets/cards/Blue_Eyes_White_Dragon.png", MaskUrl: "/assets/cards/Blue_Eyes_White_Dragon_Mask.png",
		Monster: &MonsterKind{Monster: "dragon", StrongIn: []TerrainType{}, WeakIn: []TerrainType{}},
	}

	dmGirl := &Card{
		ID: 3, Name: "Dark Magician Girl", Attack: 2000, Defense: 1600, Owner: PlayerOwner,
		Position: Vector3{X: -2, Y: -5, Z: 0.13}, IsFaceDown: true, IsDefenseMode: false, HasMoved: false,
		Rarity: "ultra", Level: 6, Type: "effect", Attribute: Attribute{Type: "dark"},
		TemplateUrl: "/assets/textures/effectTemplate.png", TextureUrl: "/assets/cards/Dark_Magician_Girl.png", MaskUrl: "/assets/cards/Dark_Magician_Girl_Mask.png",
		Monster: &MonsterKind{Monster: "spellcaster", StrongIn: []TerrainType{}, WeakIn: []TerrainType{}},
	}

	redEyes := &Card{
		ID: 4, Name: "Red-Eyes Black Dragon", Attack: 2400, Defense: 2000, Owner: OpponentOwner,
		Position: Vector3{X: 2, Y: 5, Z: 0.14}, IsFaceDown: false, IsDefenseMode: false, HasMoved: false,
		Rarity: "common", Level: 7, Type: "normal", Attribute: Attribute{Type: "dark"},
		TemplateUrl: "/assets/textures/normalTemplate.png", TextureUrl: "/assets/cards/Red_Eyes_Black_Dragon.png",
		Monster: &MonsterKind{Monster: "dragon", StrongIn: []TerrainType{}, WeakIn: []TerrainType{}},
	}

	p1 := &Player{
		ID: 100, Name: "Player_1", Clan: "Yorkists", Owner: PlayerOwner,
		BoardSide: "S", CardsInPlay: []int{1, 3},
	}

	p2 := &Player{
		ID: 200, Name: "Opponent", Clan: "Lancastrians", Owner: OpponentOwner,
		BoardSide: "N", CardsInPlay: []int{2, 4},
	}

	p3 := &Player{
		ID: 300, Name: "Opponent_2", Clan: "Lancastrians", Owner: OpponentOwner,
		BoardSide: "E", CardsInPlay: []int{},
	}

	p4 := &Player{
		ID: 400, Name: "Player_2", Clan: "Yorkists", Owner: PlayerOwner,
		BoardSide: "W", CardsInPlay: []int{},
	}

	return &GameState{
		Players: []*Player{p1, p2, p3, p4},
		Cards: []*Card{darkMagician, blueEyes, dmGirl, redEyes},
		PlayerTurnIndex: 0,
		GridSize: 11, // large enough to cover coordinates -5 to +5
	}
}
