package game

import "encoding/json"

// Message envelopes
type IncomingMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type OutgoingMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Client event constants
const (
	EventMoveCard            = "MOVE_CARD"
	EventDrawCard            = "DRAW_CARD"
	EventCardDestroyed       = "CARD_DESTROYED"
	EventCardPlayed          = "CARD_PLAYED"
	EventCardAttacked        = "CARD_ATTACKED"
	EventCardActivated       = "CARD_ACTIVATED"
	EventCardChangedPosition = "CARD_CHANGED_POSITION"
	EventEndTurn             = "END_TURN"
	EventInitState           = "INIT_STATE"
	EventStateSync           = "STATE_SYNC"
	EventUserJoined          = "USER_JOINED"
	EventUserLeft            = "USER_LEFT"
	EventError               = "ERROR"
)

// Payloads

type MoveCardPayload struct {
	CardID     int     `json:"cardId"`
	TargetTile Vector3 `json:"targetTile"`
}

type DrawCardPayload struct {
	PlayerID string `json:"playerId"`
}

type CardDestroyedPayload struct {
	CardID int `json:"cardId"`
}

type CardPlayedPayload struct {
	CardID   int     `json:"cardId"`
	Position Vector3 `json:"position"`
}

type CardAttackedPayload struct {
	AttackerCardID int `json:"attackerCardId"`
	TargetCardID   int `json:"targetCardId"`
}

type CardActivatedPayload struct {
	CardID int `json:"cardId"`
}

type CardChangedPositionPayload struct {
	CardID        int  `json:"cardId"`
	IsDefenseMode bool `json:"isDefenseMode"`
	IsFaceDown    bool `json:"isFaceDown"`
	// Card is attached only when the change leaves the card face up: that is the
	// moment its identity becomes public to the whole room.
	Card *Card `json:"card,omitempty"`
}

type EndTurnPayload struct {
	NextPlayerID string `json:"nextPlayerId"`
}

// Used to send full state to a newly joined client, and to re-sync everybody
// when the roster changes. GameState is projected per client, and YourHand
// carries the card objects only that client is allowed to see.
type InitStatePayload struct {
	GameState GameStateView `json:"gameState"`
	YourID    string        `json:"yourId"` // Seat = user id, empty for spectators
	YourRole  Role          `json:"yourRole"`
	YourHand  []*Card       `json:"yourHand"`
	// You is this connection's user, Users is everybody currently in the room.
	You   User   `json:"you"`
	Users []User `json:"users"`
}

// UserPayload announces a user arriving or leaving, and carries the resulting
// roster so a client never has to reconstruct it from a sequence of events.
type UserPayload struct {
	User  User   `json:"user"`
	Users []User `json:"users"`
}

type ErrorPayload struct {
	Message string `json:"message"`
}
