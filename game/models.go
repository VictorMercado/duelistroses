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
	// Hidden marks a card whose identity has been stripped for the recipient.
	Hidden bool `json:"hidden,omitempty"`
}

// Placeholder identity for a card the viewer is not allowed to know.
const (
	HiddenCardName        = "Face-down card"
	HiddenCardTextureUrl  = "/assets/cards/mysteryCard.png"
	HiddenCardTemplateUrl = "/assets/textures/normalTemplate.png"
	// A blank icon: the client loads the attribute texture for every card, and
	// the real attribute would give the hidden card away.
	HiddenCardAttributeUrl = "/assets/textures/blank_mask.png"
)

// RedactFor hides everything but the physical facts about a card - where it is,
// whose side it belongs to and how it sits on the table - unless the viewer owns
// it or it is face up. Face-down cards are secret, so their identity never
// reaches another player's client at all.
func (c *Card) RedactFor(viewer Owner) *Card {
	if !c.IsFaceDown || c.Owner == viewer {
		return c
	}

	return &Card{
		ID:            c.ID,
		Position:      c.Position,
		Owner:         c.Owner,
		IsFaceDown:    true,
		IsDefenseMode: c.IsDefenseMode,
		HasMoved:      c.HasMoved,
		Hidden:        true,
		Name:          HiddenCardName,
		Attack:        -1,
		Defense:       -1,
		Type:          "normal",
		Rarity:        "common",
		TemplateUrl:   HiddenCardTemplateUrl,
		TextureUrl:    HiddenCardTextureUrl,
		Attribute:     Attribute{Type: "dark", AttributeUrl: HiddenCardAttributeUrl},
	}
}

// Player is one seat at the table: where it stands, which way it faces and what
// it holds. Its ID is the id of the User sitting in it, empty when nobody is.
// Name, clan and emblem live on that User, not here.
type Player struct {
	ID          string    `json:"id"`
	Position    Vector3   `json:"position"`
	Owner       Owner     `json:"owner"`
	Deck        []int     `json:"deck"`
	Hand        []int     `json:"hand"`
	Graveyard   []int     `json:"graveyard"`
	CardsInPlay []int     `json:"cardsInPlay"`
	BoardSide   BoardSide `json:"boardSide"`
	Facing      BoardSide `json:"facing"`
	FirstMove   bool      `json:"firstMove"`
	Connected   bool      `json:"connected"`
}

type GameState struct {
	Players         []*Player `json:"players"`
	Cards           []*Card   `json:"cards"` // Represents the board state / cards in play
	PlayerTurnIndex int       `json:"playerTurnIndex"`
	GridSize        int       `json:"gridSize"` // 11 to fit cards at Y=5 and -5

	// Every card dealt in this room, on the board or not, keyed by id.
	cardsByID map[int]*Card

	mu sync.RWMutex
}

// PlayerView is the per-client projection of a seat, with the seated user's
// identity joined in so the board can draw a name and an emblem. A client sees
// its own hand but only the size of everyone else's.
type PlayerView struct {
	ID          string    `json:"id"`
	Position    Vector3   `json:"position"`
	Owner       Owner     `json:"owner"`
	Name        string    `json:"name"`
	Clan        Clan      `json:"clan"`
	TextureUrl  string    `json:"textureUrl"`
	Hand        []int     `json:"hand"`
	Graveyard   []int     `json:"graveyard"`
	CardsInPlay []int     `json:"cardsInPlay"`
	BoardSide   BoardSide `json:"boardSide"`
	Facing      BoardSide `json:"facing"`
	FirstMove   bool      `json:"firstMove"`
	Connected   bool      `json:"connected"`
	DeckCount   int       `json:"deckCount"`
	HandCount   int       `json:"handCount"`
}

type GameStateView struct {
	Players         []PlayerView `json:"players"`
	Cards           []*Card      `json:"cards"`
	PlayerTurnIndex int          `json:"playerTurnIndex"`
	GridSize        int          `json:"gridSize"`
}

// ViewForUnsafe projects the state for one viewer, joining in the users that
// hold the seats. Assumes the state lock is held.
func (s *GameState) ViewForUnsafe(viewerID string, users map[string]*User) GameStateView {
	// Spectators own no side, so every face-down card stays secret from them.
	var viewerOwner Owner
	if viewer := s.getPlayerUnsafe(viewerID); viewer != nil {
		viewerOwner = viewer.Owner
	}

	visibleCards := make([]*Card, 0, len(s.Cards))
	for _, card := range s.Cards {
		visibleCards = append(visibleCards, card.RedactFor(viewerOwner))
	}

	players := make([]PlayerView, 0, len(s.Players))

	for _, p := range s.Players {
		view := PlayerView{
			ID: p.ID, Position: p.Position, Owner: p.Owner,
			Graveyard: p.Graveyard, CardsInPlay: p.CardsInPlay,
			BoardSide: p.BoardSide, Facing: p.Facing, FirstMove: p.FirstMove,
			Connected: p.Connected,
			DeckCount: len(p.Deck), HandCount: len(p.Hand),
			Hand: []int{},
		}

		// Whoever is sitting here lends the seat its name and colours.
		if user, ok := users[p.ID]; ok && user != nil {
			view.Name = user.Name
			view.Clan = user.Clan
			view.TextureUrl = user.TextureUrl
		}
		// Only the owner of a hand learns what is in it.
		if p.ID == viewerID {
			view.Hand = append([]int{}, p.Hand...)
		}
		players = append(players, view)
	}

	return GameStateView{
		Players:         players,
		Cards:           visibleCards,
		PlayerTurnIndex: s.PlayerTurnIndex,
		GridSize:        s.GridSize,
	}
}

// HandCardsUnsafe returns the card objects held by a player. Assumes the lock is held.
func (s *GameState) HandCardsUnsafe(playerID string) []*Card {
	player := s.getPlayerUnsafe(playerID)
	if player == nil {
		return []*Card{}
	}

	hand := make([]*Card, 0, len(player.Hand))
	for _, id := range player.Hand {
		if card, ok := s.cardsByID[id]; ok {
			hand = append(hand, card)
		}
	}
	return hand
}

func (s *GameState) getPlayerUnsafe(id string) *Player {
	if id == "" {
		return nil
	}
	for _, p := range s.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
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
