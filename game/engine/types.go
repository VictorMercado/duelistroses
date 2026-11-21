// Package engine is the rules of the game and nothing else: no sockets, no
// goroutines, no clocks. A Game is mutated only through Apply, which either
// rejects an action and leaves the state untouched, or applies it completely
// and records what happened as events. That makes the rules testable in
// isolation and lets the room, the bots and replays all drive the same code.
package engine

import "math/rand"

// Pos is a board square. Coordinates are centred on the origin, so a 7x7
// board runs from -3 to +3 on both axes (the same grid the client draws).
type Pos struct {
	X int `json:"x"`
	Y int `json:"y"`
}

func (p Pos) Add(dx, dy int) Pos { return Pos{p.X + dx, p.Y + dy} }

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Chebyshev distance: 1 for all eight surrounding squares.
func (p Pos) Ring(o Pos) int {
	dx, dy := abs(p.X-o.X), abs(p.Y-o.Y)
	if dx > dy {
		return dx
	}
	return dy
}

// Steps is the walking distance: squares moved along rows and columns. The
// squares within 2 steps form the diamond a field spell covers.
func (p Pos) Steps(o Pos) int { return abs(p.X-o.X) + abs(p.Y-o.Y) }

var orthogonal = []Pos{{0, 1}, {0, -1}, {1, 0}, {-1, 0}}

// Terrain names, shared with the client and the map editor.
const (
	TerrainNormal    = "normal"
	TerrainSogen     = "sogen"
	TerrainForest    = "forest"
	TerrainWasteland = "wasteland"
	TerrainMountain  = "mountain"
	TerrainUmi       = "umi"
	TerrainYami      = "yami"
	TerrainToon      = "toon"
	TerrainCrush     = "crush"
	TerrainLabyrinth = "labyrinth"
)

var AllTerrains = []string{
	TerrainNormal, TerrainSogen, TerrainForest, TerrainWasteland, TerrainMountain,
	TerrainUmi, TerrainYami, TerrainToon, TerrainCrush, TerrainLabyrinth,
}

func ValidTerrain(t string) bool {
	for _, known := range AllTerrains {
		if known == t {
			return true
		}
	}
	return false
}

// Card kinds.
const (
	KindMonster = "monster"
	KindSpell   = "spell"
	KindTrap    = "trap"
	KindRitual  = "ritual"
)

// Effect describes what a card does as data, so the catalog can add
// cards without the engine changing. Op selects the behaviour (see effects.go);
// the remaining fields are its parameters and are ignored when irrelevant.
type Effect struct {
	Op      string   `json:"op"`
	Amount  int      `json:"amount,omitempty"`
	Turns   int      `json:"turns,omitempty"` // spellbind length, -1 = permanent
	Types   []string `json:"types,omitempty"`
	Attrs   []string `json:"attrs,omitempty"`
	Name    string   `json:"name,omitempty"` // substring a card name must contain
	Terrain string   `json:"terrain,omitempty"`
	Radius  int      `json:"radius,omitempty"`
	MaxAtk  int      `json:"maxAtk,omitempty"`
	MinAtk  int      `json:"minAtk,omitempty"`
	// Traps only: what sets it off ("move", "attack", "spell") and how far it
	// reaches ("limited" = the eight surrounding squares, "full" = anywhere).
	Trigger string `json:"trigger,omitempty"`
	Range   string `json:"range,omitempty"`
	// Rituals only: the monster summoned (a pointer, since card 0 is a real
	// card) and the monsters sacrificed for it, one requirement each.
	Summon   *int      `json:"summon,omitempty"`
	Tributes []Tribute `json:"tributes,omitempty"`

	// Monster abilities (CardDef.Abilities, see abilities.go): On is the
	// moment the ability works ("flip", "battleFlip", "battle", "destroyed",
	// "aura", "turn", "move"; empty for a passive ability that works while
	// the monster is face up).
	On string `json:"on,omitempty"`
	// Side narrows who an effect touches, from its card's point of view:
	// "own", "enemy" or "" for everybody.
	Side string `json:"side,omitempty"`
	// Nums limits the effect to these card numbers; Kinds to these card kinds.
	Nums  []int    `json:"nums,omitempty"`
	Kinds []string `json:"kinds,omitempty"`
	// Shape is the area terrain changes cover around the card: "diamond"
	// (the default, squares within Radius steps), "ring" (within Radius
	// squares, diagonals included), "row" or "here".
	Shape string `json:"shape,omitempty"`
	// ToType / ToAttr is what a monster is turned into.
	ToType string `json:"toType,omitempty"`
	ToAttr string `json:"toAttr,omitempty"`
	// Stat "def" makes a boost apply to DEF only.
	Stat string `json:"stat,omitempty"`
	// Position is "attack" or "defense".
	Position string `json:"position,omitempty"`
	// FaceDown: a card the effect summons arrives face down.
	FaceDown bool `json:"faceDown,omitempty"`
	// Permanent traps stay on the field after they go off.
	Permanent bool `json:"permanent,omitempty"`
	// MinLP is the LP its owner must have above it; Cost is LP paid.
	MinLP int `json:"minLP,omitempty"`
	Cost  int `json:"cost,omitempty"`
	Count int `json:"count,omitempty"`
	// Counters lists the spell ops a counter trap answers (none: any).
	Counters []string `json:"counters,omitempty"`
	// Grant is what a power-up gives the monster it is used on, on top of
	// any ATK and DEF.
	Grant []*Effect `json:"grant,omitempty"`
}

// CardDef is a card as printed: identity and base stats, no game state.
type CardDef struct {
	Num       int    `json:"num"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Type      string `json:"type,omitempty"`      // monster type: "dragon", "winged-beast"...
	Attribute string `json:"attribute,omitempty"` // "light", "dark"...
	Level     int    `json:"level,omitempty"`
	Atk       int    `json:"atk,omitempty"`
	Def       int    `json:"def,omitempty"`
	DeckCost  int    `json:"deckCost,omitempty"`
	Text      string `json:"text,omitempty"`
	// Flavor is a normal monster's description: shown, never played. Kept
	// apart from Text, since a monster with text is an effect monster.
	Flavor string  `json:"flavor,omitempty"`
	Effect *Effect `json:"effect,omitempty"`
	// Abilities are what a monster does by itself (see abilities.go).
	Abilities []*Effect `json:"abilities,omitempty"`
	// Favors lists terrains this card is strong on beyond what its type gives.
	Favors []string `json:"favors,omitempty"`
	// Leader is what this monster can do as a deck leader, if anything.
	Leader *LeaderAbility `json:"leader,omitempty"`
	// Fusion marks a fusion monster, drawn on the fusion frame. Being the
	// result of a fusion recipe does not make one: the game's fusion table
	// also produces ordinary monsters such as Mystical Elf.
	Fusion bool `json:"fusion,omitempty"`
	// OwnFrame names a template only this card is drawn on, in place of the
	// one worked out from what the card is: textures/<OwnFrame>Template.png.
	// Each Egyptian God has one ("godObelisk", "godSlifer", "godRa").
	OwnFrame string `json:"ownFrame,omitempty"`
	// Locked cards (the Egyptian Gods) are in the catalog but no deck may
	// hold them, nor have one as its leader, until players earn access.
	Locked bool `json:"locked,omitempty"`
}

// IsGod is an Egyptian God card: a deck holds at most one.
func (d *CardDef) IsGod() bool { return d.Type == "divine-beast" }

// LeaderAbility is a deck leader's passive power (see leader.go).
type LeaderAbility struct {
	// Op "assembleLimbs" (Exodia): the seat wins when one of its turns begins
	// with every card in Cards on the field under its control, face up and
	// not spellbound.
	Op    string `json:"op"`
	Cards []int  `json:"cards,omitempty"`
}

func (d *CardDef) IsMonster() bool { return d.Kind == KindMonster }

// Catalog is where card definitions and fusion recipes come from. The engine
// never knows what cards exist; production wires this to the content package.
type Catalog interface {
	Card(num int) *CardDef
	// Fuse returns the monster two monsters combine into, or nil.
	Fuse(a, b *CardDef) *CardDef
}

// Card is one physical card in a game: in a hand or on the board.
type Card struct {
	ID  int
	Def *CardDef
	// Owner is the seat currently controlling the card. Home is the seat whose
	// deck it came from, which is where it goes when it leaves play.
	Owner int
	Home  int
	Pos   Pos

	OnBoard  bool
	FaceDown bool
	Defense  bool
	Acted    bool

	AtkMod int
	DefMod int
	// Spellbound counts the owner's turns the card still sits out; -1 never ends.
	Spellbound int
	// Borrowed marks a card controlled for one turn (Change of Heart).
	Borrowed bool
	// Shared is a monster fused from two teammates' monsters: whichever of
	// the team is taking its turn controls it.
	Shared bool

	// Granted are abilities a power-up gave this card.
	Granted []*Effect
	// SelfFlipped is set when the card's own player turned it face up.
	// Guard counts the owner's turns it has since begun face up in defense.
	SelfFlipped bool
	Guard       int
	// KnownBy lists the teams that know what class of card this is.
	KnownBy []int

	// Absorbed is the enemy monster this one took in (Relinquished), off the
	// field; AbsorbAtk / AbsorbDef are the strength it took with it.
	Absorbed             *Card
	AbsorbAtk, AbsorbDef int
	// AbsorbTurn is the turn it last absorbed; AbsorbDeclined the last offer
	// its player turned down (see offerAbsorb).
	AbsorbTurn     int
	AbsorbDeclined string
}

type Seat struct {
	Index int
	Team  int
	Alive bool

	LP    int
	Stars int

	Leader      Pos
	LeaderActed bool
	// LeaderDef is the deck leader's card (nil when the deck named none).
	LeaderDef *CardDef

	Deck      []int // card numbers, top of the deck first
	Hand      []*Card
	Graveyard []int // card numbers, most recent last

	// PlaysLeft is how many cards may still leave the hand this turn.
	PlaysLeft  int
	TurnsTaken int

	// Conceded is set when the seat gave up rather than being beaten.
	Conceded bool
	// Rank is the deck leader's rank this duel, from 1 to MaxRank, earned by
	// destroying enemy monsters (see destiny.go).
	Rank int
	// LastDestiny is the TurnsTaken of the seat's last Destiny Draw (0: none).
	LastDestiny int
	// Destinies counts the seat's Destiny Draws this duel (see destinyMaxPerDuel).
	Destinies int
	// Stats is what this seat has done so far (see stats.go).
	Stats Stats
	// RarityBase is the rarity points the player had before this duel, by
	// card number; nil for a seat that keeps none (a bot, a guest). CardPoints
	// is what its cards earned this duel. See rarity.go.
	RarityBase map[int]int
	CardPoints map[int]int
	// Unlocked is the rarities the player unlocked by card number outside the
	// points (RarityCosmic): it overrides what the points give.
	Unlocked map[int]string

	// LastPlayed is the card the seat last played from its hand.
	LastPlayed int
	// PeekTurn / SpyTurn are the turn (Game.TurnCount) during which the seat
	// sees its opponents' hands / the class and type of their cards.
	PeekTurn int
	SpyTurn  int
}

type Phase string

const (
	PhasePlaying  Phase = "playing"
	PhaseFinished Phase = "finished"
)

type Config struct {
	Size         int
	StartLP      int
	StartStars   int
	StarsPerTurn int
	MaxStars     int
	HandSize     int
	MaxMonsters  int
	MaxSpells    int
	// MaxRounds ends a game that will not end itself (after that many rounds,
	// see Game.Round); the side with more LP wins.
	MaxRounds int
	// DestinyPool lists the cards a Destiny Draw may give (none: no Destiny Draws).
	DestinyPool []int
}

func DefaultConfig(size int) Config {
	return Config{
		Size: size, StartLP: 4000, StartStars: 4, StarsPerTurn: 3, MaxStars: 12,
		HandSize: 5, MaxMonsters: 5, MaxSpells: 5, MaxRounds: 100,
	}
}

// HiddenNum is the card number a viewer gets for a card hidden from them.
// It is never 0: card 0 is a real card.
const HiddenNum = -1

// cardNum is a card number for an optional field. Card 0 is a real card, so
// "no card" is nil, never 0.
func cardNum(n int) *int { return &n }

// Choice is one option of a pending decision.
type Choice struct {
	Label string `json:"label"`
	Num   *int   `json:"num,omitempty"` // nil when the option has no visible card
	// For a card in a graveyard: whose graveyard, and where in it (0 = oldest).
	// Graveyards are public, so this lets the client show the choice in place.
	From *int `json:"from,omitempty"`
	Slot *int `json:"slot,omitempty"`
	// For a choice between players (whose LP to restore): that seat.
	Seat *int `json:"seat,omitempty"`
	// What the option refers to, private to the engine.
	seat   int
	index  int
	cardID int
}

// Pending is a decision the game is blocked on. It always has at least one
// option and Choose(0) is always valid, so a timeout can resolve it.
type Pending struct {
	Seat    int
	Kind    string
	Prompt  string
	Options []Choice
	source  *Card
}

type Game struct {
	Cfg   Config
	Cat   Catalog
	Tiles map[Pos]string
	Seats []*Seat
	// credited is the card a blow being dealt now is credited to, for rarity
	// points (see crediting); nil when no card is.
	credited *Card

	Board map[Pos]*Card
	Cards map[int]*Card

	Turn int // seat index
	// TurnCount counts every seat's turn, so it names one turn: the engine
	// and the room use it to tell "this turn" apart (the turn clock, the Eye
	// of Truth, absorbing). Players count Rounds instead.
	TurnCount int
	// Round is the round being played, from 1: it goes up when a seat is
	// about to take its second turn of the round, so once everyone still in
	// the duel has had a turn (a knocked-out seat is not waited for).
	Round int
	// playedThisRound is the seats that have had their turn this round.
	playedThisRound map[int]bool
	// QuietTurns counts the turns begun since anything was attacked, damaged
	// or destroyed: how long the duel has stalled. Bots use it to break a
	// standoff (see bot.Heuristic).
	QuietTurns int
	Phase      Phase
	WinnerTeam int // -1 while playing, or on a draw
	Pending    *Pending
	// Unlimited is the administrators' sandbox: playing from the hand costs
	// nothing and is never used up, and the field limits are off. Every seat
	// is topped up to full summoning power after each action (see settle).
	Unlimited bool

	nextID int
	rng    *rand.Rand
	// destinyRng decides Destiny Draws (see destiny.go).
	destinyRng *rand.Rand
	// battleFoe is the monster a card being turned face up is fighting.
	battleFoe *Card
	// shielded marks teams a White Hole protects while a spell resolves.
	shielded map[int]bool
	events   []Event
	// chain, while cards played together are merging, collects each step
	// for the fusionChain event.
	chain *[]ChainStep
}

// Event is something that happened, for the client to animate and log. Events
// never carry hidden information: a face-down card has no Num here (nil).
type Event struct {
	Type   string `json:"type"`
	Seat   int    `json:"seat"`
	CardID int    `json:"cardId,omitempty"`
	Num    *int   `json:"num,omitempty"`
	Target int    `json:"target,omitempty"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Amount int    `json:"amount,omitempty"`
	Text   string `json:"text,omitempty"`
	// Steps is set on a fusionChain event: the merges of cards played
	// together, in the order they happened.
	Steps []ChainStep `json:"steps,omitempty"`
}

// ChainStep is one merge of a fusion chain: Add came to Base and Result is
// what remained. Kind is "fuse" (a recipe made a new monster), "bonk" (no
// recipe: Add knocked Base into the graveyard) or "equip" (a power-up of
// Amount). Board marks a Base that was already standing on the square. Card
// numbers are HiddenNum for a viewer not allowed to see the played cards.
type ChainStep struct {
	Base   int    `json:"base"`
	Add    int    `json:"add"`
	Result int    `json:"result"`
	Kind   string `json:"kind"`
	Amount int    `json:"amount,omitempty"`
	Board  bool   `json:"board,omitempty"`
	// baseOpen: Base was face up on the board, so everyone already knew it.
	// open: the whole step is public. A power-up went into a face-up monster
	// on the board, which stays face up: the equip event names the power-up,
	// and it ends in the graveyard, which is public too.
	baseOpen, open bool
}

// HideChain returns a copy of the step list as a viewer who did not see the
// played cards may know it: cards from the hand, and whatever they became,
// are face down; a face-up card already on the board stays shown, and a
// power-up going into one is shown in full.
func HideChain(steps []ChainStep) []ChainStep {
	hidden := make([]ChainStep, len(steps))
	for i, st := range steps {
		if !st.open {
			st.Add, st.Result = HiddenNum, HiddenNum
			if !st.baseOpen {
				st.Base = HiddenNum
			}
		}
		hidden[i] = st
	}
	return hidden
}

// Action is a player's intent. Which fields matter depends on Type.
type Action struct {
	Type    string `json:"type"`
	CardID  int    `json:"cardId,omitempty"`
	CardIDs []int  `json:"cardIds,omitempty"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Flip    bool   `json:"flip,omitempty"`
	Defense bool   `json:"defense,omitempty"`
	// Attack, on a move, switches a defending monster to attack position first.
	// Moving always does that now; the field is still accepted from older clients.
	Attack bool `json:"attack,omitempty"`
	Choice int  `json:"choice,omitempty"`
}

const (
	ActSummon   = "summon"
	ActMove     = "move"
	ActFlip     = "flip"
	ActPosition = "position"
	ActLeader   = "leader"
	ActDiscard  = "discard"
	ActChoose   = "choose"
	ActEndTurn  = "endTurn"
	ActConcede  = "concede"
)

// RuleError is an action the rules refuse. Its text is shown to the player.
type RuleError string

func (e RuleError) Error() string { return string(e) }
