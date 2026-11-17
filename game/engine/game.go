package engine

import (
	"fmt"
	"math/rand"
	"sort"
)

// SeatSetup is what a seat brings to the table.
type SeatSetup struct {
	Team   int
	Deck   []int // card numbers
	Leader int   // the deck leader's card number (unknown: none)
}

// seatEdges places leaders in the middle of an edge: south, north, east, west.
func seatEdge(index, half int) Pos {
	switch index {
	case 0:
		return Pos{0, -half}
	case 1:
		return Pos{0, half}
	case 2:
		return Pos{half, 0}
	default:
		return Pos{-half, 0}
	}
}

// New starts a game. tiles maps every square to a terrain; missing squares are
// normal. The seed makes shuffles and random effects reproducible.
func New(cfg Config, cat Catalog, tiles map[Pos]string, seats []SeatSetup, seed int64) *Game {
	g := &Game{
		Cfg: cfg, Cat: cat,
		Tiles: map[Pos]string{}, Board: map[Pos]*Card{}, Cards: map[int]*Card{},
		Phase: PhasePlaying, WinnerTeam: -1, nextID: 1,
		rng: rand.New(rand.NewSource(seed)),
		// Its own source, so Destiny Draw never shifts shuffles or effects.
		destinyRng: rand.New(rand.NewSource(seed ^ 0x5eed_de57)),
	}
	half := cfg.Size / 2
	for x := -half; x <= half; x++ {
		for y := -half; y <= half; y++ {
			p := Pos{x, y}
			t := tiles[p]
			if !ValidTerrain(t) {
				t = TerrainNormal
			}
			g.Tiles[p] = t
		}
	}

	for i, setup := range seats {
		deck := make([]int, 0, len(setup.Deck))
		for _, num := range setup.Deck {
			if cat.Card(num) != nil {
				deck = append(deck, num)
			}
		}
		g.rng.Shuffle(len(deck), func(a, b int) { deck[a], deck[b] = deck[b], deck[a] })
		leader := seatEdge(i, half)
		// A leader never starts walled in.
		g.Tiles[leader] = TerrainNormal
		g.Seats = append(g.Seats, &Seat{
			Index: i, Team: setup.Team, Alive: true,
			LP: cfg.StartLP, Stars: cfg.StartStars, Leader: leader, Deck: deck, Rank: 1,
		})
		if def := cat.Card(setup.Leader); def != nil && def.IsMonster() {
			g.Seats[i].LeaderDef = def
		}
	}

	g.Turn = 0
	g.beginTurn()
	g.events = nil
	return g
}

// TakeEvents hands over what happened since the last call.
func (g *Game) TakeEvents() []Event {
	ev := g.events
	g.events = nil
	return ev
}

// fighting is the events that end a standoff (see Game.QuietTurns).
var fighting = map[string]bool{"attack": true, "damage": true, "destroyed": true, "eliminated": true, "control": true}

func (g *Game) emit(e Event) {
	if fighting[e.Type] {
		g.QuietTurns = 0
	}
	g.events = append(g.events, e)
}

func (g *Game) InBounds(p Pos) bool {
	half := g.Cfg.Size / 2
	return p.X >= -half && p.X <= half && p.Y >= -half && p.Y <= half
}

func (g *Game) seat(i int) *Seat {
	if i < 0 || i >= len(g.Seats) {
		return nil
	}
	return g.Seats[i]
}

func (g *Game) sameTeam(a, b int) bool {
	sa, sb := g.seat(a), g.seat(b)
	return sa != nil && sb != nil && sa.Team == sb.Team
}

// leaderAt returns the living seat whose leader stands on p.
func (g *Game) leaderAt(p Pos) *Seat {
	for _, s := range g.Seats {
		if s.Alive && s.Leader == p {
			return s
		}
	}
	return nil
}

// boardCards lists cards in play in a stable order, so anything that iterates
// them (traps, mass effects) behaves the same on every run.
func (g *Game) boardCards() []*Card {
	out := make([]*Card, 0, len(g.Board))
	for _, c := range g.Board {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// monstersFull reports whether a seat's side of the field has no room for
// another monster. The limit is per team: MaxMonsters for each duelist on
// it, so 5 in a 1v1 and 10 for a 2v2 team, however the team splits them.
func (g *Game) monstersFull(seat int) bool {
	if g.Unlimited {
		return false
	}
	team := g.Seats[seat].Team
	n, duelists := 0, 0
	for _, s := range g.Seats {
		if s.Team == team {
			duelists++
			n += g.countOnBoard(s.Index, true)
		}
	}
	return n >= g.Cfg.MaxMonsters*duelists
}

// monsterLimit is the error for a side with no room for another monster.
func (g *Game) monsterLimit(seat int) error {
	team := g.Seats[seat].Team
	duelists := 0
	for _, s := range g.Seats {
		if s.Team == team {
			duelists++
		}
	}
	if duelists > 1 {
		return RuleError(fmt.Sprintf("Your team already has %d monsters on the field", g.Cfg.MaxMonsters*duelists))
	}
	return RuleError(fmt.Sprintf("You already have %d monsters on the field", g.Cfg.MaxMonsters))
}

func (g *Game) countOnBoard(seat int, monsters bool) int {
	n := 0
	for _, c := range g.Board {
		if c.Owner == seat && !c.Borrowed && c.Def.IsMonster() == monsters {
			n++
		}
	}
	return n
}

// --- stats ---------------------------------------------------------------

// typeTerrain says where each monster type is strong (+500 ATK and DEF, and a
// second square of movement) and where it is weak (-500). It is the same table
// as the MonsterKind constants in web/src/const.ts; keep the two in step. The
// server's copy is the one that decides battles.
var typeTerrain = map[string]struct{ strong, weak []string }{
	"aqua":          {[]string{TerrainUmi}, []string{TerrainToon, TerrainWasteland}},
	"beast":         {[]string{TerrainForest}, []string{TerrainToon}},
	"beast-warrior": {[]string{TerrainSogen, TerrainForest}, []string{TerrainToon}},
	"dinosaur":      {[]string{TerrainWasteland}, []string{TerrainToon}},
	"dragon":        {[]string{TerrainMountain}, []string{TerrainToon}},
	"fairy":         {[]string{TerrainMountain}, []string{TerrainYami, TerrainToon}},
	"fish":          {[]string{TerrainUmi}, []string{TerrainToon, TerrainWasteland}},
	"fiend":         {[]string{TerrainYami}, []string{TerrainToon}},
	"immortal":      {[]string{TerrainCrush}, []string{TerrainToon}},
	"insect":        {[]string{TerrainForest}, []string{TerrainToon}},
	"machine":       {[]string{TerrainWasteland}, []string{TerrainToon, TerrainUmi}},
	"plant":         {[]string{TerrainForest}, []string{TerrainToon, TerrainWasteland}},
	"pyro":          {[]string{TerrainForest}, []string{TerrainToon, TerrainUmi}},
	"reptile":       {nil, []string{TerrainToon}},
	"rock":          {[]string{TerrainWasteland}, []string{TerrainToon}},
	"sea-serpent":   {[]string{TerrainUmi}, []string{TerrainToon, TerrainWasteland}},
	"spellcaster":   {[]string{TerrainYami}, []string{TerrainToon, TerrainSogen}},
	"toon":          {[]string{TerrainToon}, nil},
	"thunder":       {[]string{TerrainMountain, TerrainUmi}, []string{TerrainToon}},
	"warrior":       {[]string{TerrainSogen}, []string{TerrainToon}},
	"winged-beast":  {[]string{TerrainMountain}, []string{TerrainToon}},
	"zombie":        {[]string{TerrainYami, TerrainWasteland}, []string{TerrainMountain, TerrainToon}},
}

const terrainSwing = 500

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

// TerrainBonus is what a terrain does to a monster type: +500, -500 or 0.
func TerrainBonus(terrain, monsterType string) int {
	kind := typeTerrain[monsterType]
	switch {
	case contains(kind.strong, terrain):
		return terrainSwing
	case contains(kind.weak, terrain):
		return -terrainSwing
	}
	return 0
}

func floor0(v int) int {
	if v < 0 {
		return 0
	}
	return v
}

// bonus is what a terrain does to this particular card.
func (d *CardDef) bonus(terrain string) int {
	if contains(d.Favors, terrain) {
		return terrainSwing
	}
	return TerrainBonus(terrain, d.Type)
}

// Bonus is the terrain swing this card gets standing on a terrain.
func (d *CardDef) Bonus(terrain string) int { return d.bonus(terrain) }

// AtkOn / DefOn are a monster's fighting strength standing on a terrain.
func (c *Card) AtkOn(terrain string) int {
	return floor0(c.Def.Atk + c.AtkMod + c.Def.bonus(terrain))
}

func (c *Card) DefOn(terrain string) int {
	return floor0(c.Def.Def + c.DefMod + c.Def.bonus(terrain))
}

// --- zones ---------------------------------------------------------------

func (g *Game) place(c *Card, p Pos) {
	if c.OnBoard {
		delete(g.Board, c.Pos)
	}
	c.Pos, c.OnBoard = p, true
	g.Board[p] = c
}

// bury takes a card out of play and puts it in its home graveyard. by is the
// seat that destroyed it, or noOne when it was not destroyed by anybody (used
// up, fused, replaced, discarded).
func (g *Game) bury(c *Card, reason string, by int) {
	g.creditDestroy(c, by)
	g.dropAbsorbed(c, by)
	if c.OnBoard && g.Board[c.Pos] == c {
		delete(g.Board, c.Pos)
	}
	c.OnBoard = false
	delete(g.Cards, c.ID)
	// A banished card (Dimensional Warrior) never reaches the graveyard.
	if home := g.seat(c.Home); home != nil && reason != "banished" {
		home.Graveyard = append(home.Graveyard, c.Def.Num)
	}
	g.emit(Event{Type: "destroyed", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Text: reason})
	g.destroyedElsewhere(c, reason)
}

func (g *Game) newCard(num, seat int) *Card {
	def := g.Cat.Card(num)
	if def == nil {
		return nil
	}
	c := &Card{ID: g.nextID, Def: def, Owner: seat, Home: seat, FaceDown: true}
	g.nextID++
	g.Cards[c.ID] = c
	return c
}

func (s *Seat) handCard(id int) *Card {
	for _, c := range s.Hand {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func (s *Seat) removeFromHand(c *Card) {
	for i, h := range s.Hand {
		if h == c {
			s.Hand = append(s.Hand[:i], s.Hand[i+1:]...)
			return
		}
	}
}

// --- life, turns and the end of the game --------------------------------

// damage takes LP from a seat; by is who dealt it (noOne for nobody).
func (g *Game) damage(seat, amount int, reason string, by int) {
	s := g.seat(seat)
	if s == nil || !s.Alive || amount <= 0 {
		return
	}
	// Midnight Fiend, Kryuel: every hit to LP is heavier.
	for _, a := range g.auras("damagePlus") {
		amount += a.e.Amount
	}
	amount = g.damageAfterAbilities(seat, amount)
	if amount <= 0 {
		return
	}
	lost := min(amount, s.LP)
	s.LP -= lost
	g.creditDamage(seat, by, lost)
	// Only what the seat actually lost: damage beyond its last LP is gone, it
	// never spills onto a teammate.
	g.emit(Event{Type: "damage", Seat: seat, Amount: lost, Text: reason, X: s.Leader.X, Y: s.Leader.Y})
}

func (g *Game) heal(seat, amount int) {
	s := g.seat(seat)
	if s == nil || !s.Alive || amount <= 0 {
		return
	}
	// Bad Reaction to Simochi: an enemy's recovery hurts instead.
	for _, t := range g.boardCards() {
		if g.trapReady(t, "heal", seat) && t.Def.Effect.Op == "trapBackfire" {
			g.springTrap(t)
			g.damage(seat, amount, t.Def.Name, t.Owner)
			return
		}
	}
	// Frog the Jam: every recovery is doubled.
	for range g.auras("healDouble") {
		amount *= 2
	}
	s.LP += amount
	s.Stats.Healed += amount
	g.emit(Event{Type: "heal", Seat: seat, Amount: amount, X: s.Leader.X, Y: s.Leader.Y})
}

// livingTeammate is another seat of s's team still playing, if any.
func (g *Game) livingTeammate(s *Seat) *Seat {
	for _, o := range g.Seats {
		if o != s && o.Alive && o.Team == s.Team {
			return o
		}
	}
	return nil
}

// eliminate removes a seat and everything it controls from the game.
func (g *Game) eliminate(s *Seat, reason string) {
	if !s.Alive {
		return
	}
	s.Alive = false
	for _, c := range g.boardCards() {
		if c.Shared && !c.Borrowed && (c.Owner == s.Index || c.Home == s.Index) && g.Seats[c.Home].Team == s.Team {
			if mate := g.livingTeammate(s); mate != nil {
				// A shared monster stays in play with the teammate left.
				c.Owner, c.Home = mate.Index, mate.Index
				continue
			}
		}
		switch {
		case c.Home == s.Index:
			// Off the field, but not into the graveyard: it keeps what it had.
			delete(g.Board, c.Pos)
			delete(g.Cards, c.ID)
			c.OnBoard = false
		case c.Owner == s.Index:
			// Something borrowed from a seat still playing goes back to it.
			c.Owner, c.Borrowed = c.Home, false
		}
	}
	for _, c := range s.Hand {
		delete(g.Cards, c.ID)
	}
	s.Hand = nil
	g.emit(Event{Type: "eliminated", Seat: s.Index, Text: reason})
}

// settle runs after every action: it removes seats that ran out of life, ends
// the game when one team is left, and keeps the turn on a living seat.
func (g *Game) settle() {
	if g.Phase == PhaseFinished {
		return
	}
	for _, s := range g.Seats {
		if s.Alive && s.LP <= 0 {
			g.eliminate(s, "life points reached 0")
		}
	}

	teams := map[int]bool{}
	for _, s := range g.Seats {
		if s.Alive {
			teams[s.Team] = true
		}
	}
	if len(teams) <= 1 {
		winner := -1
		for t := range teams {
			winner = t
		}
		g.finish(winner, "last team standing")
		return
	}

	if g.Pending != nil && !g.Seats[g.Pending.Seat].Alive {
		g.Pending = nil
	}
	if !g.Seats[g.Turn].Alive {
		g.advanceTurn()
	}
	g.topUp()
	g.offerAbsorb()
}

// topUp gives every seat full summoning power and a card to play, in the
// sandbox (Unlimited). It runs after every action, so what a test changes
// never leaves a seat short.
func (g *Game) topUp() {
	if !g.Unlimited {
		return
	}
	for _, s := range g.Seats {
		if s.Alive {
			s.Stars = g.Cfg.MaxStars
			s.PlaysLeft = max(s.PlaysLeft, 1)
		}
	}
}

func (g *Game) finish(winnerTeam int, reason string) {
	g.Phase = PhaseFinished
	g.WinnerTeam = winnerTeam
	g.Pending = nil
	g.emit(Event{Type: "gameOver", Seat: winnerTeam, Text: reason})
}

// endTurn wraps up the current seat's turn and hands over.
func (g *Game) endTurn() {
	seat := g.Turn
	// Ancient Jar stops spellbinding counting down; Timeater doubles its pace.
	countdown := 1
	if g.anyAura("fastCountdown") {
		countdown = 2
	}
	if g.anyAura("freezeCountdown") {
		countdown = 0
	}
	for _, c := range g.boardCards() {
		if c.Owner != seat {
			continue
		}
		if c.Spellbound > 0 {
			c.Spellbound = max(c.Spellbound-countdown, 0)
		}
		if c.Borrowed {
			// A borrowed card goes home when the turn it was taken for ends.
			c.Borrowed = false
			c.Owner = c.Home
			c.Acted = false
		}
	}
	g.advanceTurn()
}

func (g *Game) advanceTurn() {
	for step := 1; step <= len(g.Seats); step++ {
		next := (g.Turn + step) % len(g.Seats)
		if g.Seats[next].Alive {
			g.Turn = next
			g.beginTurn()
			return
		}
	}
}

func (g *Game) beginTurn() {
	g.TurnCount++
	g.QuietTurns++
	if g.Round == 0 || g.playedThisRound[g.Turn] {
		g.Round++
		g.playedThisRound = map[int]bool{}
	}
	g.playedThisRound[g.Turn] = true
	if g.Cfg.MaxRounds > 0 && g.Round > g.Cfg.MaxRounds {
		g.finishOnPoints()
		return
	}

	s := g.Seats[g.Turn]
	if s.TurnsTaken > 0 {
		// Servant of Catabolism adds a star a turn; an enemy Fiend's Mirror takes one.
		gain := g.Cfg.StarsPerTurn
		for _, a := range g.auras("starsPlus") {
			if g.sameTeam(a.src.Owner, s.Index) {
				gain++
			}
		}
		for _, a := range g.auras("starsMinus") {
			if !g.sameTeam(a.src.Owner, s.Index) {
				gain--
			}
		}
		s.Stars += max(gain, 0)
		if s.Stars > g.Cfg.MaxStars {
			s.Stars = g.Cfg.MaxStars
		}
	}
	s.TurnsTaken++
	s.PlaysLeft = 1
	s.LeaderActed = false
	for _, c := range g.Board {
		// A shared monster is controlled by whichever teammate's turn it is.
		if c.Shared && !c.Borrowed && c.Owner != s.Index && g.sameTeam(c.Owner, s.Index) {
			c.Owner = s.Index
		}
		if c.Owner == s.Index {
			c.Acted = false
		}
	}
	g.emit(Event{Type: "turn", Seat: s.Index, Amount: g.TurnCount, X: s.Leader.X, Y: s.Leader.Y})
	// Monsters face up in defense count the turn and do what they do each turn.
	g.guardTurn(s)
	if g.Phase != PhasePlaying {
		return
	}

	// Exodia: the seat's turn begins with every limb on the field, face up and free.
	if g.limbsAssembled(s) {
		g.emit(Event{Type: "leaderWin", Seat: s.Index, Num: cardNum(s.LeaderDef.Num), X: s.Leader.X, Y: s.Leader.Y, Text: s.LeaderDef.Name})
		g.finish(s.Team, s.LeaderDef.Name)
		return
	}

	// Destiny Draw: in trouble (or high in rank), one card may come from
	// outside the deck, in place of a draw.
	if len(s.Hand) < g.Cfg.HandSize {
		g.destinyDraw(s)
	}
	for len(s.Hand) < g.Cfg.HandSize {
		if len(s.Deck) == 0 {
			// Nothing left to draw: the duelist has lost.
			g.eliminate(s, "deck ran out")
			g.settle()
			return
		}
		g.draw(s)
	}

	// Checkmate: boxed in with nowhere to play a card and nowhere to step.
	if g.cornered(s) {
		g.eliminate(s, "checkmate: the deck leader is cornered")
		g.settle()
	}
}

// cornered is true when a seat's leader has no square around it to play a
// card onto and cannot step anywhere.
func (g *Game) cornered(s *Seat) bool {
	if len(g.LeaderTargets(s)) > 0 {
		return false
	}
	// An ally's monster only takes power-ups: it is not a square to play onto.
	for _, p := range g.SummonTiles(s) {
		if occ := g.Board[p]; occ == nil || occ.Owner == s.Index {
			return false
		}
	}
	return true
}

func (g *Game) draw(s *Seat) *Card {
	if len(s.Deck) == 0 {
		return nil
	}
	c := g.newCard(s.Deck[0], s.Index)
	s.Deck = s.Deck[1:]
	if c == nil {
		return nil
	}
	s.Hand = append(s.Hand, c)
	s.Stats.CardsDrawn++
	g.emit(Event{Type: "draw", Seat: s.Index, CardID: c.ID, X: s.Leader.X, Y: s.Leader.Y})
	return c
}

func (g *Game) finishOnPoints() {
	totals := map[int]int{}
	for _, s := range g.Seats {
		if s.Alive {
			totals[s.Team] += s.LP
		}
	}
	best, winner, tie := -1, -1, false
	for team, lp := range totals {
		switch {
		case lp > best:
			best, winner, tie = lp, team, false
		case lp == best:
			tie = true
		}
	}
	if tie {
		winner = -1
	}
	g.finish(winner, "round limit reached")
}
