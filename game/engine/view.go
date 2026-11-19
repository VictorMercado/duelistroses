package engine

import (
	"slices"
	"sort"
)

// seesClass is Tainted Wisdom: its team can tell what class of card each
// hidden card is.
func (g *Game) seesClass(viewer int) bool {
	for _, a := range g.auras("seeClass") {
		if g.sameTeam(a.src.Owner, viewer) {
			return true
		}
	}
	return false
}

// The view is what one seat is allowed to know. Hidden information is removed
// here, on the server, so it never reaches a client that should not have it:
// another team's face-down cards have no identity, and only the owner of a
// hand or of a pending choice sees what is in it.

type CardView struct {
	ID    int `json:"id"`
	Num   int `json:"num"` // HiddenNum (-1) when hidden from this viewer
	Owner int `json:"owner"`
	X     int `json:"x"`
	Y     int `json:"y"`

	FaceDown   bool `json:"faceDown"`
	Defense    bool `json:"defense"`
	Acted      bool `json:"acted"`
	Hidden     bool `json:"hidden,omitempty"`
	Borrowed   bool `json:"borrowed,omitempty"`
	Shared     bool `json:"shared,omitempty"`
	Spellbound int  `json:"spellbound,omitempty"`
	// Class and Type of a hidden card the viewer has found out about
	// (Hiro's Shadow Scout, Tainted Wisdom, The Inexperienced Spy).
	Class string `json:"class,omitempty"`
	Type  string `json:"type,omitempty"`

	// Current strength on the square the card stands on. Zero when hidden.
	Atk    int `json:"atk"`
	Def    int `json:"def"`
	AtkMod int `json:"atkMod,omitempty"`
	DefMod int `json:"defMod,omitempty"`
	// Terrain is what the square adds to the monster's ATK and DEF (already
	// in Atk and Def): positive where it is strong, negative where weak.
	Terrain int `json:"terrain,omitempty"`
}

type HandCardView struct {
	ID  int `json:"id"`
	Num int `json:"num"`
}

type SeatView struct {
	Index       int  `json:"index"`
	Team        int  `json:"team"`
	Alive       bool `json:"alive"`
	LP          int  `json:"lp"`
	Stars       int  `json:"stars"`
	LeaderX     int  `json:"leaderX"`
	LeaderY     int  `json:"leaderY"`
	LeaderActed bool `json:"leaderActed"`
	// LeaderNum is the deck leader's card, shown on its emblem (-1: none).
	LeaderNum int   `json:"leaderNum"`
	HandCount int   `json:"handCount"`
	DeckCount int   `json:"deckCount"`
	PlaysLeft int   `json:"playsLeft"`
	Graveyard []int `json:"graveyard"`
	// Rank is the deck leader's rank this duel (1 to MaxRank).
	Rank int `json:"rank"`
}

type PendingView struct {
	Seat    int      `json:"seat"`
	Kind    string   `json:"kind"`
	Prompt  string   `json:"prompt"`
	Options []Choice `json:"options,omitempty"`
}

// LegalView tells the seat to move what it can do, so the client never has to
// reimplement the rules to highlight squares.
type LegalView struct {
	Moves map[int][]Pos `json:"moves"`
	// FlipMoves are the moves of a face-down monster if it turns face up as
	// part of the move: face up, terrain it is strong on lets it reach further.
	FlipMoves map[int][]Pos `json:"flipMoves,omitempty"`
	Summon    []Pos         `json:"summon"`
	Leader    []Pos         `json:"leader"`
	// Strength is what each of the seat's monsters would fight with on each
	// terrain of the map, keyed by card ID and then by terrain name as it is
	// written in View.Tiles, so a player can see the terrain's effect before
	// moving there.
	Strength map[int]map[string]Strength `json:"strength,omitempty"`
}

// Strength is a monster's ATK and DEF standing on a particular terrain.
type Strength struct {
	Atk int `json:"atk"`
	Def int `json:"def"`
}

func leaderNum(s *Seat) int {
	if s.LeaderDef == nil {
		return -1
	}
	return s.LeaderDef.Num
}

type View struct {
	Phase     Phase    `json:"phase"`
	Size      int      `json:"size"`
	Tiles     []string `json:"tiles"` // row by row from the south-west corner
	Turn      int      `json:"turn"`
	TurnCount int      `json:"turnCount"`
	// Round is what players call the turn number: everyone has one turn a round.
	Round int `json:"round"`
	// QuietTurns is how many turns have begun since the last fight (see Game.QuietTurns).
	QuietTurns int `json:"quietTurns"`
	WinnerTeam int `json:"winnerTeam"`
	MaxStars   int `json:"maxStars"`
	// The field limits per duelist (a team shares MaxMonsters × its duelists),
	// so a client can tell a play will fit before the server answers.
	MaxMonsters int            `json:"maxMonsters"`
	MaxSpells   int            `json:"maxSpells"`
	Seats       []SeatView     `json:"seats"`
	Cards       []CardView     `json:"cards"`
	Hand        []HandCardView `json:"hand"`
	Pending     *PendingView   `json:"pending,omitempty"`
	Legal       *LegalView     `json:"legal,omitempty"`
	// Reveal is only ever set on the administrator's view.
	Reveal *RevealView `json:"reveal,omitempty"`
	// Deck is the viewer's own remaining deck, top card first. Only an
	// administrator playing a duel gets it, for the test tools.
	Deck []int `json:"deck,omitempty"`
	// FusionHints is the fusions the viewer's hand can make, in the sandbox only.
	FusionHints []FusionHint `json:"fusionHints,omitempty"`
	// Peek is the opponents' hands, for the turn the viewer cast The Eye of Truth.
	Peek []PeekView `json:"peek,omitempty"`
}

// PeekView is one opponent's hand, seen through The Eye of Truth.
type PeekView struct {
	Seat  int   `json:"seat"`
	Cards []int `json:"cards"`
}

// cardClass is what kind of card a card is, as a scout reports it.
func cardClass(d *CardDef) string {
	if d.Effect != nil && (d.Effect.Op == "equip" || d.Effect.Op == "imitation" || d.Effect.Op == "morph") {
		return "power-up"
	}
	return d.Kind
}

// RevealView is everything a normal view keeps back: each seat's hand and the
// rest of its deck, top card first.
type RevealView struct {
	Hands [][]HandCardView `json:"hands"`
	Decks [][]int          `json:"decks"`
}

func sortPos(ps []Pos) {
	sort.Slice(ps, func(i, j int) bool {
		if ps[i].Y != ps[j].Y {
			return ps[i].Y < ps[j].Y
		}
		return ps[i].X < ps[j].X
	})
}

// ViewFor projects the game for a seat; pass -1 for a spectator.
func (g *Game) ViewFor(viewer int) View { return g.view(viewer, false) }

// ViewAll is the game with nothing hidden: every card face, hand and deck.
// It exists for administrators and must never be sent to a player.
func (g *Game) ViewAll() View {
	v := g.view(-1, true)
	reveal := &RevealView{}
	for _, s := range g.Seats {
		hand := []HandCardView{}
		for _, c := range s.Hand {
			hand = append(hand, HandCardView{ID: c.ID, Num: c.Def.Num})
		}
		reveal.Hands = append(reveal.Hands, hand)
		reveal.Decks = append(reveal.Decks, append([]int{}, s.Deck...))
	}
	v.Reveal = reveal
	return v
}

func (g *Game) view(viewer int, all bool) View {
	half := g.Cfg.Size / 2
	v := View{
		Phase: g.Phase, Size: g.Cfg.Size, Turn: g.Turn, TurnCount: g.TurnCount, Round: g.Round, QuietTurns: g.QuietTurns,
		WinnerTeam: g.WinnerTeam, MaxStars: g.Cfg.MaxStars, MaxMonsters: g.Cfg.MaxMonsters, MaxSpells: g.Cfg.MaxSpells,
		Tiles: make([]string, 0, g.Cfg.Size*g.Cfg.Size),
		Hand:  []HandCardView{}, Cards: []CardView{},
	}
	for y := -half; y <= half; y++ {
		for x := -half; x <= half; x++ {
			v.Tiles = append(v.Tiles, g.Tiles[Pos{x, y}])
		}
	}

	for _, s := range g.Seats {
		graveyard := append([]int{}, s.Graveyard...)
		v.Seats = append(v.Seats, SeatView{
			Index: s.Index, Team: s.Team, Alive: s.Alive, LP: s.LP, Stars: s.Stars,
			LeaderX: s.Leader.X, LeaderY: s.Leader.Y, LeaderActed: s.LeaderActed,
			LeaderNum: leaderNum(s),
			HandCount: len(s.Hand), DeckCount: len(s.Deck), PlaysLeft: s.PlaysLeft,
			Graveyard: graveyard, Rank: s.Rank,
		})
	}

	for _, c := range g.boardCards() {
		cv := CardView{
			ID: c.ID, Owner: c.Owner, X: c.Pos.X, Y: c.Pos.Y,
			FaceDown: c.FaceDown, Defense: c.Defense, Acted: c.Acted,
			Borrowed: c.Borrowed, Shared: c.Shared, Spellbound: c.Spellbound,
		}
		if cv.Spellbound == 0 && g.bound(c) {
			cv.Spellbound = -1 // held by an aura for as long as it lasts
		}
		if !all && c.FaceDown && (viewer < 0 || !g.sameTeam(c.Owner, viewer)) {
			cv.Hidden = true
			cv.Num = HiddenNum
			if vs := g.seat(viewer); vs != nil {
				spy := vs.SpyTurn == g.TurnCount && vs.SpyTurn > 0
				if spy || slices.Contains(c.KnownBy, vs.Team) || g.seesClass(viewer) {
					cv.Class = cardClass(c.Def)
				}
				if spy && c.Def.IsMonster() {
					cv.Type = c.Def.Type
				}
			}
		} else {
			cv.Num = c.Def.Num
			cv.AtkMod, cv.DefMod = c.AtkMod, c.DefMod
			if c.Def.IsMonster() {
				cv.Atk, cv.Def = g.atk(c, g.Tiles[c.Pos]), g.def(c, g.Tiles[c.Pos])
				cv.Terrain = c.Def.bonus(g.Tiles[c.Pos])
			}
		}
		v.Cards = append(v.Cards, cv)
	}

	if s := g.seat(viewer); s != nil {
		for _, c := range s.Hand {
			v.Hand = append(v.Hand, HandCardView{ID: c.ID, Num: c.Def.Num})
		}
		if s.PeekTurn > 0 && s.PeekTurn == g.TurnCount {
			for _, o := range g.enemies(s.Index) {
				pv := PeekView{Seat: o.Index, Cards: []int{}}
				for _, c := range o.Hand {
					pv.Cards = append(pv.Cards, c.Def.Num)
				}
				v.Peek = append(v.Peek, pv)
			}
		}
	}

	if p := g.Pending; p != nil {
		pv := &PendingView{Seat: p.Seat, Kind: p.Kind, Prompt: p.Prompt}
		if p.Seat == viewer {
			pv.Options = p.Options
		}
		v.Pending = pv
	}

	if g.Phase == PhasePlaying && g.Pending == nil && viewer == g.Turn {
		s := g.Seats[viewer]
		legal := &LegalView{Moves: map[int][]Pos{}, Summon: []Pos{}, Leader: g.LeaderTargets(s)}
		if legal.Leader == nil {
			legal.Leader = []Pos{}
		}
		for _, c := range g.boardCards() {
			if c.Owner != viewer {
				continue
			}
			targets := []Pos{}
			// A face-up spell moves only to be cast (see actMove).
			if c.FaceDown || !castsOnMove(c) || g.canActivate(c) == nil {
				for p := range g.MoveTargets(c) {
					targets = append(targets, p)
				}
			}
			sortPos(targets)
			legal.Moves[c.ID] = targets
			if c.FaceDown && c.Def.IsMonster() {
				// Worked out exactly as actMove does: face up for the moment of the move.
				c.FaceDown = false
				flipped := []Pos{}
				for p := range g.MoveTargets(c) {
					flipped = append(flipped, p)
				}
				c.FaceDown = true
				sortPos(flipped)
				if legal.FlipMoves == nil {
					legal.FlipMoves = map[int][]Pos{}
				}
				legal.FlipMoves[c.ID] = flipped
			}
		}
		if s.PlaysLeft > 0 {
			legal.Summon = append(legal.Summon, g.SummonTiles(s)...)
		}
		terrains := map[string]bool{}
		for _, t := range v.Tiles {
			terrains[t] = true
		}
		for _, c := range g.boardCards() {
			if c.Owner != viewer || !c.Def.IsMonster() {
				continue
			}
			if legal.Strength == nil {
				legal.Strength = map[int]map[string]Strength{}
			}
			byTerrain := map[string]Strength{}
			for t := range terrains {
				byTerrain[t] = Strength{Atk: g.atk(c, t), Def: g.def(c, t)}
			}
			legal.Strength[c.ID] = byTerrain
		}
		v.Legal = legal
	}
	return v
}

// LegalActions enumerates what a seat can do right now. It is what bots pick
// from, and it is never empty for the seat the game is waiting on: ending the
// turn (or choosing an option) is always possible.
func (g *Game) LegalActions(seat int) []Action {
	if g.Phase != PhasePlaying {
		return nil
	}
	if p := g.Pending; p != nil {
		if p.Seat != seat {
			return nil
		}
		out := make([]Action, len(p.Options))
		for i := range p.Options {
			out[i] = Action{Type: ActChoose, Choice: i}
		}
		return out
	}
	if seat != g.Turn {
		return nil
	}
	s := g.Seats[seat]
	var out []Action

	if s.PlaysLeft > 0 {
		tiles := g.SummonTiles(s)
		sortPos(tiles)
		for _, c := range s.Hand {
			if c.Def.IsMonster() && c.Def.Level > s.Stars {
				continue
			}
			for _, p := range tiles {
				occ := g.Board[p]
				// Onto one of our own cards: only offer merges that do something.
				if occ != nil && !g.worthCombining(occ.Def, c.Def) {
					continue
				}
				if occ != nil && occ.Owner != seat {
					if !g.allyMerge(occ.Def, c.Def) {
						continue
					}
				}
				if g.roomFor(seat, c.Def.IsMonster(), occ) != nil {
					continue
				}
				out = append(out, Action{Type: ActSummon, CardIDs: []int{c.ID}, X: p.X, Y: p.Y})
			}
		}
	}

	for _, c := range g.boardCards() {
		if c.Owner != seat || c.Acted || g.bound(c) {
			continue
		}
		// A face-up spell is cast by moving it: it only moves when it can be cast.
		if !c.FaceDown && castsOnMove(c) && g.canActivate(c) != nil {
			continue
		}
		targets := []Pos{}
		for p := range g.MoveTargets(c) {
			if occ := g.Board[p]; occ != nil && g.sameTeam(occ.Owner, seat) && !g.worthCombining(occ.Def, c.Def) {
				continue
			}
			targets = append(targets, p)
		}
		sortPos(targets)
		for _, p := range targets {
			out = append(out, Action{Type: ActMove, CardID: c.ID, X: p.X, Y: p.Y})
		}
		if c.FaceDown && c.Def.Kind != KindTrap {
			if c.Def.IsMonster() || g.canActivate(c) == nil {
				out = append(out, Action{Type: ActFlip, CardID: c.ID})
			}
		}
		if c.Def.IsMonster() {
			out = append(out, Action{Type: ActPosition, CardID: c.ID, Defense: !c.Defense})
		}
	}

	for _, p := range g.LeaderTargets(s) {
		out = append(out, Action{Type: ActLeader, X: p.X, Y: p.Y})
	}
	return append(out, Action{Type: ActEndTurn})
}

// worthCombining is true when merging two of a player's cards produces
// something: a real fusion, or a power-up the monster can use.
func (g *Game) worthCombining(base, add *CardDef) bool {
	switch g.combineKind(base, add) {
	case "fuse":
		return g.Cat.Fuse(base, add) != nil
	case "equip":
		if base.IsMonster() {
			return powerUpFitsDef(add, base)
		}
		return powerUpFitsDef(base, add)
	}
	return false
}
