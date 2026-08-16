package game

import "sync"

type Rarity string
type MonsterType string
type SpellType string
type TrapType string
type Clan string
type Owner string
type BoardSide string

const (
	PlayerOwner   Owner = "player"
	OpponentOwner Owner = "opponent"
)

type TerrainType string

type Terrain struct {
	Type            TerrainType `json:"type"`
	Name            string      `json:"name"`
	TextureUrl      string      `json:"textureUrl"`
	DisplacementUrl string      `json:"displacementUrl,omitempty"`
}

type MonsterKind struct {
	Monster  MonsterType   `json:"monster"`
	StrongIn []TerrainType `json:"strongIn"`
	WeakIn   []TerrainType `json:"weakIn"`
}

type Attribute struct {
	Type         string `json:"type"`
	AttributeUrl string `json:"attributeUrl"`
}

type Card struct {
	ID            int          `json:"id"`
	Position      Vector3      `json:"position"`
	Owner         Owner        `json:"owner"`
	Name          string       `json:"name"`
	Attack        int          `json:"attack"`
	Defense       int          `json:"defense"`
	Description   string       `json:"description"`
	Level         int          `json:"level"`
	Monster       *MonsterKind `json:"monster"`
	Type          string       `json:"type"` // Monster, Spell, or Trap
	TemplateUrl   string       `json:"templateUrl"`
	Attribute     Attribute    `json:"attribute"`
	Rarity        Rarity       `json:"rarity"`
	TextureUrl    string       `json:"textureUrl"`
	MaskUrl       string       `json:"maskUrl,omitempty"`
	IsFaceDown    bool         `json:"isFaceDown"`
	IsDefenseMode bool         `json:"isDefenseMode"`
	HasMoved      bool         `json:"hasMoved"`
}

type Player struct {
	ID          int       `json:"id"`
	Position    Vector3   `json:"position"`
	Owner       Owner     `json:"owner"`
	Name        string    `json:"name"`
	Clan        Clan      `json:"clan"`
	TextureUrl  string    `json:"textureUrl"`
	AllCards    []Card    `json:"allCards"`
	Deck        []int     `json:"deck"`
	Hand        []int     `json:"hand"`
	Graveyard   []int     `json:"graveyard"`
	CardsInPlay []int     `json:"cardsInPlay"`
	BoardSide   BoardSide `json:"boardSide"`
	FirstMove   bool      `json:"firstMove"`
}

type GameState struct {
	Players         []*Player `json:"players"`
	Cards           []*Card   `json:"cards"` // Represents the board state / cards in play
	PlayerTurnIndex int       `json:"playerTurnIndex"`
	GridSize        int       `json:"gridSize"` // 11 to fit cards at Y=5 and -5
	mu              sync.RWMutex
}

// Helper to get a card by ID
func (s *GameState) GetCard(id int) *Card {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.Cards {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// Helper to get active player
func (s *GameState) GetActivePlayer() *Player {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.Players) == 0 {
		return nil
	}
	return s.Players[s.PlayerTurnIndex%len(s.Players)]
}
