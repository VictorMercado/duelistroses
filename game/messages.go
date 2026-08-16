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
	EventError               = "ERROR"
)

// Payloads

type MoveCardPayload struct {
	CardID     int     `json:"cardId"`
	TargetTile Vector3 `json:"targetTile"`
}

type DrawCardPayload struct {
	PlayerID int `json:"playerId"`
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
}

type EndTurnPayload struct {
	NextPlayerID int `json:"nextPlayerId"`
}

// Used to send full state to a newly joined client
type InitStatePayload struct {
	GameState *GameState `json:"gameState"`
	YourID    int        `json:"yourId"` // ID assigned to the client
	YourRole  Role       `json:"yourRole"`
}

type ErrorPayload struct {
	Message string `json:"message"`
}
