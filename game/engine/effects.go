package engine

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// Every card effect in the game is one of the ops below. A card's Effect is
// data, so adding a card that reuses an op needs no code; a new behaviour is
// one new case here.

// matches reports whether an effect's filters select a monster. An effect with
// no filters selects every monster.
func matches(e *Effect, def *CardDef) bool {
	if e == nil || !def.IsMonster() {
		return false
	}
	if len(e.Types) > 0 && !contains(e.Types, def.Type) {
		return false
	}
	if len(e.Attrs) > 0 && !contains(e.Attrs, def.Attribute) {
		return false
	}
	if e.Name != "" && !strings.Contains(strings.ToLower(def.Name), strings.ToLower(e.Name)) {
		return false
	}
	if len(e.Nums) > 0 && !slices.Contains(e.Nums, def.Num) {
		return false
	}
	if e.MaxAtk > 0 && def.Atk > e.MaxAtk {
		return false
	}
	return true
}

func (g *Game) enemies(seat int) []*Seat {
	var out []*Seat
	for _, s := range g.Seats {
		if s.Alive && !g.sameTeam(s.Index, seat) {
			out = append(out, s)
		}
	}
	return out
}

// monsters lists monsters in play, optionally only those a filter accepts.
func (g *Game) monsters(keep func(*Card) bool) []*Card {
	var out []*Card
	for _, c := range g.boardCards() {
		if c.Def.IsMonster() && (keep == nil || keep(c)) {
			out = append(out, c)
		}
	}
	return out
}

func (g *Game) here(c *Card) int { return g.atk(c, g.Tiles[c.Pos]) }

// strongest returns the monster with the highest ATK among cards, nil if none.
func (g *Game) strongest(cards []*Card) *Card {
	var best *Card
	for _, c := range cards {
		if best == nil || g.here(c) > g.here(best) {
			best = c
		}
	}
	return best
}

// reviveOptions lists the monsters lying in graveyards, newest first.
func (g *Game) reviveOptions() []Choice {
	return g.graveOptions(func(_ int, def *CardDef) bool { return def.IsMonster() })
}

// reviveCardOptions are the cards a spell like Copycat may bring back.
func (g *Game) reviveCardOptions(c *Card) []Choice {
	e := c.Def.Effect
	return g.graveOptions(func(seat int, def *CardDef) bool {
		if !g.sideOK(e.Side, c.Owner, seat) {
			return false
		}
		return len(e.Kinds) == 0 || (slices.Contains(e.Kinds, "spell") && !def.IsMonster()) || slices.Contains(e.Kinds, def.Kind)
	})
}

func (g *Game) controlOptions(seat int) []Choice {
	var out []Choice
	for _, c := range g.boardCards() {
		if g.sameTeam(c.Owner, seat) || c.Borrowed || g.warded(c, seat) {
			continue
		}
		label, num := "Face-down card", (*int)(nil)
		if !c.FaceDown {
			label, num = c.Def.Name, cardNum(c.Def.Num)
		}
		out = append(out, Choice{
			Label: fmt.Sprintf("%s at (%d, %d)", label, c.Pos.X, c.Pos.Y),
			Num:   num, cardID: c.ID,
		})
	}
	return out
}

// canActivate refuses a spell that would do nothing, so a card is never
// wasted and the game never waits on a choice with no options.
func (g *Game) canActivate(c *Card) error {
	e := c.Def.Effect
	if c.Def.Kind == KindRitual && (e == nil || e.Op != "ritual") {
		return RuleError("This ritual card has no recipe yet")
	}
	if e == nil {
		return RuleError("That card has no effect yet")
	}
	if e.Op != "equip" && e.Op != "imitation" && e.Op != "morph" && g.anyAura("noSpells") {
		return RuleError("Spell and ritual cards have no effect while Temple of Skulls guards the field")
	}
	switch e.Op {
	case "equip", "imitation", "morph":
		return RuleError("Move this card onto one of your monsters to power it up")
	case "reviveCard":
		if len(g.reviveCardOptions(c)) == 0 {
			return RuleError("There is no card to revive in the graveyards")
		}
	case "magicLabyrinth":
		found := false
		for p, t := range g.Tiles {
			found = found || (t == TerrainLabyrinth && p != c.Pos)
		}
		if !found {
			return RuleError("There is no labyrinth on the field")
		}
	case "ritual":
		return g.canRitual(c)
	case "revive":
		if len(g.reviveOptions()) == 0 {
			return RuleError("There is no monster in any graveyard")
		}
		if g.monstersFull(c.Owner) {
			return g.monsterLimit(c.Owner)
		}
	case "control":
		if !g.canControl() {
			return RuleError("Celtic Guardian prevents taking control of cards")
		}
		if len(g.controlOptions(c.Owner)) == 0 {
			return RuleError("There is no enemy card to take control of")
		}
	case "controlStrongest":
		if !g.canControl() {
			return RuleError("Celtic Guardian prevents taking control of cards")
		}
		if g.strongest(g.monsters(func(m *Card) bool { return !g.sameTeam(m.Owner, c.Owner) })) == nil {
			return RuleError("There is no enemy monster to take control of")
		}
	}
	return nil
}

// activate resolves a spell that was just flipped face up.
func (g *Game) activate(c *Card) {
	g.Seats[c.Owner].Stats.SpellsCast++
	g.emit(Event{Type: "spell", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Text: c.Def.Name})

	// An enemy counter trap can cancel the spell before anything happens.
	g.shielded = nil
	for _, t := range g.boardCards() {
		if !g.trapReady(t, "spell", c.Owner) || !counters(t.Def.Effect, c) {
			continue
		}
		e := t.Def.Effect
		g.springTrap(t)
		if e.Op == "trapShield" {
			// White Hole: the spell goes ahead, but not against this side.
			if g.shielded == nil {
				g.shielded = map[int]bool{}
			}
			g.shielded[g.Seats[t.Owner].Team] = true
			continue
		}
		g.bury(c, "negated", t.Owner)
		// "trapJam" simply cancels the spell; "trapReflect" turns it back.
		if e.Op == "trapReflect" {
			// Goblin Fan: the caster suffers what it meant to do.
			caster := g.Seats[c.Owner]
			g.damage(caster.Index, caster.LP/2, t.Def.Name, t.Owner)
		}
		return
	}

	g.resolve(c)
	g.shielded = nil
	if g.Pending != nil && g.Pending.source == c {
		return // stays on the field until its owner has chosen
	}
	if c.OnBoard {
		g.bury(c, "used", noOne)
	}
}

func (g *Game) resolve(c *Card) {
	e := c.Def.Effect
	owner := g.Seats[c.Owner]
	at := c.Pos
	foe := func(m *Card) bool { return !g.sameTeam(m.Owner, c.Owner) }
	own := func(m *Card) bool { return m.Owner == c.Owner }
	selected := func(m *Card) bool { return matches(e, m.Def) }
	inLine := func(m *Card) bool { return m != c && (m.Pos.X == at.X || m.Pos.Y == at.Y) }
	spells := func(keep func(*Card) bool) []*Card {
		var out []*Card
		for _, m := range g.boardCards() {
			if m != c && !m.Def.IsMonster() && (keep == nil || keep(m)) {
				out = append(out, m)
			}
		}
		return out
	}
	spared := func(m *Card) bool {
		return g.warded(m, owner.Index) || (g.shielded[g.Seats[m.Owner].Team] && !g.sameTeam(m.Owner, owner.Index))
	}
	buryAll := func(cards []*Card) {
		for _, m := range cards {
			if m.OnBoard && !spared(m) {
				g.bury(m, "spell", owner.Index)
			}
		}
	}
	bind := func(cards []*Card, turns int) {
		for _, m := range cards {
			if !spared(m) {
				g.spellbind(m, turns)
			}
		}
	}

	switch e.Op {
	case "ritual":
		g.performRitual(c)
	case "heal", "healTo":
		// With a living teammate, the caster picks whose LP to restore.
		if options := g.healOptions(owner.Index); len(options) > 1 {
			g.Pending = &Pending{Seat: owner.Index, Kind: "heal", Prompt: "Choose whose Life Points to restore", Options: options, source: c}
		} else {
			g.restore(owner.Index, e)
		}
	case "burn":
		for _, s := range g.enemies(owner.Index) {
			g.damage(s.Index, e.Amount, c.Def.Name, owner.Index)
		}
	case "burnPerEnemy":
		count := 0
		for _, m := range g.boardCards() {
			if foe(m) {
				count++
			}
		}
		for _, s := range g.enemies(owner.Index) {
			g.damage(s.Index, e.Amount*count, c.Def.Name, owner.Index)
		}
	case "draw":
		for i := 0; i < e.Amount; i++ {
			g.draw(owner)
		}

	case "destroyAll":
		buryAll(g.monsters(nil))
		buryAll(spells(nil))
	case "destroyCross":
		buryAll(g.monsters(inLine))
	case "destroySpells":
		buryAll(spells(nil))
	case "destroySpellsCross":
		buryAll(spells(inLine))
	case "destroyType":
		buryAll(g.monsters(selected))
	case "destroyWeakest":
		// Only face-up monsters: a face-down card's ATK is not known to the field.
		var weakest *Card
		for _, m := range g.monsters(func(m *Card) bool { return !m.FaceDown }) {
			if weakest == nil || g.here(m) < g.here(weakest) {
				weakest = m
			}
		}
		if weakest != nil && !spared(weakest) {
			g.bury(weakest, "spell", owner.Index)
		}

	case "spellbindType":
		bind(g.monsters(selected), e.Turns)
	case "spellbindExcept":
		bind(g.monsters(func(m *Card) bool { return !selected(m) }), e.Turns)
	case "spellbindStrongest":
		if m := g.strongest(g.monsters(func(m *Card) bool { return !spared(m) })); m != nil {
			g.spellbind(m, e.Turns)
		}
	case "swords":
		for _, m := range g.boardCards() {
			if foe(m) {
				g.reveal(m)
				if m.Def.IsMonster() {
					g.spellbind(m, e.Turns)
				}
			}
		}
	case "revealEnemy":
		for _, m := range g.boardCards() {
			if foe(m) {
				g.reveal(m)
			}
		}
	case "hideAll":
		for _, m := range g.boardCards() {
			if m != c {
				m.FaceDown = true
			}
		}
	case "stopDefense":
		for _, m := range g.monsters(foe) {
			if !spared(m) {
				m.Defense = false
			}
		}

	case "boost":
		for _, m := range g.monsters(selected) {
			g.powerUp(m, e.Amount, e.Amount, owner.Index)
		}
	case "boostOwnDef":
		for _, m := range g.monsters(func(m *Card) bool { return g.sameTeam(m.Owner, c.Owner) }) {
			g.powerUp(m, 0, e.Amount, owner.Index)
		}
	case "swapStats":
		for _, m := range g.monsters(func(m *Card) bool { return !spared(m) }) {
			atk, def := m.Def.Atk+m.AtkMod, m.Def.Def+m.DefMod
			m.AtkMod, m.DefMod = def-m.Def.Atk, atk-m.Def.Def
		}
	case "cleanse":
		for _, m := range g.boardCards() {
			m.AtkMod, m.DefMod, m.Spellbound = 0, 0, 0
		}
	case "halveLP":
		total := 0
		for _, s := range g.enemies(owner.Index) {
			half := s.LP / 2
			total += half
			g.damage(s.Index, half, c.Def.Name, owner.Index)
		}
		for _, m := range g.monsters(own) {
			g.powerUp(m, total, 0, owner.Index)
		}

	case "terrain":
		// A field spell reshapes a diamond around itself: its own square, two
		// squares out along its row and column, and the squares between.
		//       X
		//      XXX
		//     XXCXX
		//      XXX
		//       X
		for p := range g.Tiles {
			if p.Steps(at) <= e.Radius && ValidTerrain(e.Terrain) && g.leaderAt(p) == nil {
				g.Tiles[p] = e.Terrain
			}
		}
		g.emit(Event{Type: "terrain", Seat: owner.Index, X: at.X, Y: at.Y, Text: e.Terrain, Amount: e.Radius})
		// Crush terrain takes whatever is now standing on it.
		for _, m := range g.monsters(nil) {
			if m.OnBoard {
				g.crush(m, owner.Index)
			}
		}
	case "terrainHere":
		g.bury(c, "used", noOne)
		g.Tiles[at] = e.Terrain
		g.emit(Event{Type: "terrain", Seat: owner.Index, X: at.X, Y: at.Y, Text: e.Terrain})

	case "drainStars":
		for _, s := range g.enemies(owner.Index) {
			owner.Stars += s.Stars
			s.Stars = 0
		}
		if owner.Stars > g.Cfg.MaxStars {
			owner.Stars = g.Cfg.MaxStars
		}
	case "extraPlay":
		owner.PlaysLeft++
	case "teleportLeader":
		g.bury(c, "used", noOne)
		owner.Leader = at
		g.emit(Event{Type: "leader", Seat: owner.Index, X: at.X, Y: at.Y})
	case "shift":
		if m := g.strongest(g.monsters(own)); m != nil {
			g.bury(c, "used", noOne)
			g.place(m, at)
			g.emit(Event{Type: "move", Seat: owner.Index, CardID: m.ID, X: at.X, Y: at.Y})
			g.enterTile(m)
		}
	case "recall":
		for _, m := range g.monsters(own) {
			g.dropAbsorbed(m, noOne)
			delete(g.Board, m.Pos)
			delete(g.Cards, m.ID)
			m.OnBoard = false
			if home := g.seat(m.Home); home != nil {
				home.Deck = append(home.Deck, m.Def.Num)
			}
		}
		g.rng.Shuffle(len(owner.Deck), func(a, b int) { owner.Deck[a], owner.Deck[b] = owner.Deck[b], owner.Deck[a] })

	case "controlStrongest":
		if m := g.strongest(g.monsters(func(m *Card) bool { return foe(m) && !spared(m) })); m != nil {
			g.borrow(m, owner.Index)
		}
	case "revive":
		g.Pending = &Pending{Seat: owner.Index, Kind: "revive", Prompt: "Choose a monster to revive", Options: g.reviveOptions(), source: c}
	case "control":
		g.Pending = &Pending{Seat: owner.Index, Kind: "control", Prompt: "Choose a card to control this turn", Options: g.controlOptions(owner.Index), source: c}
	case "reviveCard":
		g.Pending = &Pending{Seat: owner.Index, Kind: "reviveCard", Prompt: "Choose a card to revive", Options: g.reviveCardOptions(c), source: c}

	case "magicLabyrinth":
		// One labyrinth square elsewhere opens up, and this one closes.
		var labs []Pos
		for p, t := range g.Tiles {
			if t == TerrainLabyrinth && p != at {
				labs = append(labs, p)
			}
		}
		sortPos(labs)
		g.bury(c, "used", noOne)
		if len(labs) > 0 {
			open := labs[g.rng.Intn(len(labs))]
			g.Tiles[open] = TerrainNormal
			g.emit(Event{Type: "terrain", Seat: owner.Index, X: open.X, Y: open.Y, Text: TerrainNormal})
		}
		g.Tiles[at] = TerrainLabyrinth
		g.emit(Event{Type: "terrain", Seat: owner.Index, X: at.X, Y: at.Y, Text: TerrainLabyrinth})
	case "peekHand":
		owner.PeekTurn = g.TurnCount
		g.emit(Event{Type: "peek", Seat: owner.Index, Text: "hands"})
	case "spyTypes":
		owner.SpyTurn = g.TurnCount
		g.emit(Event{Type: "peek", Seat: owner.Index, Text: "types"})
	case "meteor":
		squares := make([]Pos, 0, len(g.Tiles))
		for p := range g.Tiles {
			squares = append(squares, p)
		}
		sortPos(squares)
		g.rng.Shuffle(len(squares), func(a, b int) { squares[a], squares[b] = squares[b], squares[a] })
		for _, p := range squares[:min(max(e.Count, 1), len(squares))] {
			if m := g.Board[p]; m != nil && m != c && !spared(m) {
				m.FaceDown = false
				g.bury(m, "spell", owner.Index)
			}
		}
	case "earthshaker":
		g.earthshake(c)
	case "creatureSwap":
		g.creatureSwap(c)

	default:
		// Anything a monster ability can do, a spell can do too.
		g.doAbility(c, e, nil)
	}
}

// counters says whether a counter trap answers a spell being cast.
func counters(e *Effect, spell *Card) bool {
	if len(e.Nums) > 0 && !slices.Contains(e.Nums, spell.Def.Num) {
		return false
	}
	if len(e.Kinds) > 0 && !slices.Contains(e.Kinds, spell.Def.Kind) {
		return false
	}
	if len(e.Counters) > 0 && (spell.Def.Effect == nil || !slices.Contains(e.Counters, spell.Def.Effect.Op)) {
		return false
	}
	return true
}

// earthshake is Earthshaker: labyrinths fall, the terrain is shuffled, and
// every card is moved to a random free square.
func (g *Game) earthshake(c *Card) {
	var squares []Pos
	var terrains []string
	for p, t := range g.Tiles {
		if g.leaderAt(p) != nil {
			continue
		}
		if t == TerrainLabyrinth {
			t = TerrainNormal
		}
		squares = append(squares, p)
		terrains = append(terrains, t)
	}
	sortPos(squares)
	sort.Strings(terrains)
	g.rng.Shuffle(len(terrains), func(a, b int) { terrains[a], terrains[b] = terrains[b], terrains[a] })
	for i, p := range squares {
		g.Tiles[p] = terrains[i]
	}
	g.emit(Event{Type: "terrain", Seat: c.Owner, X: c.Pos.X, Y: c.Pos.Y, Text: "shuffle"})

	cards := g.cardsOf(c, "", nil)
	for _, m := range cards {
		delete(g.Board, m.Pos)
	}
	g.rng.Shuffle(len(squares), func(a, b int) { squares[a], squares[b] = squares[b], squares[a] })
	free := squares[:0]
	for _, p := range squares {
		if p != c.Pos {
			free = append(free, p)
		}
	}
	for i, m := range cards {
		m.OnBoard = false
		g.place(m, free[i%len(free)])
		g.emit(Event{Type: "move", Seat: m.Owner, CardID: m.ID, X: m.Pos.X, Y: m.Pos.Y})
	}
	for _, m := range cards {
		g.enterTile(m)
	}
}

// creatureSwap is Creature Swap: every card crosses to the square opposite
// it through the centre of the field. Cards whose square would be a leader's
// stay where they are.
func (g *Game) creatureSwap(c *Card) {
	cards := g.cardsOf(c, "", nil)
	var moving []*Card
	for _, m := range cards {
		to := Pos{-m.Pos.X, -m.Pos.Y}
		if to != m.Pos && g.leaderAt(to) == nil && to != c.Pos {
			moving = append(moving, m)
			delete(g.Board, m.Pos)
		}
	}
	for _, m := range moving {
		m.OnBoard = false
		g.place(m, Pos{-m.Pos.X, -m.Pos.Y})
		g.emit(Event{Type: "move", Seat: m.Owner, CardID: m.ID, X: m.Pos.X, Y: m.Pos.Y})
	}
	for _, m := range moving {
		g.enterTile(m)
	}
}

func (g *Game) spellbind(c *Card, turns int) {
	if turns == 0 {
		turns = 1
	}
	if c.Spellbound == -1 {
		return
	}
	if turns == -1 || turns > c.Spellbound {
		c.Spellbound = turns
	}
	g.emit(Event{Type: "spellbound", Seat: c.Owner, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y, Amount: turns})
}

func (g *Game) borrow(c *Card, seat int) {
	if !g.canControl() {
		return
	}
	c.Owner, c.Borrowed, c.Acted = seat, true, false
	g.Seats[seat].Stats.Takeovers++
	g.emit(Event{Type: "control", Seat: seat, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y})
}

// healOptions lists the living seats of a team a recovery spell can reach,
// the caster first so the default choice is still the caster.
func (g *Game) healOptions(caster int) []Choice {
	var out []Choice
	add := func(s *Seat, label string) {
		c := Choice{Label: fmt.Sprintf("%s · %d LP", label, s.LP), Seat: cardNum(s.Index), seat: s.Index}
		if s.LeaderDef != nil {
			c.Num = cardNum(s.LeaderDef.Num)
		}
		out = append(out, c)
	}
	add(g.Seats[caster], "You")
	for _, s := range g.Seats {
		if s.Index != caster && s.Alive && g.sameTeam(s.Index, caster) {
			add(s, "Ally")
		}
	}
	return out
}

// restore applies a recovery spell's effect to a seat's LP.
func (g *Game) restore(seat int, e *Effect) {
	s := g.seat(seat)
	if s == nil {
		return
	}
	switch e.Op {
	case "heal":
		g.heal(seat, e.Amount)
	case "healTo":
		if s.LP < e.Amount {
			g.heal(seat, e.Amount-s.LP)
		}
	}
}

// resolveChoice finishes the effect a pending decision belongs to.
func (g *Game) resolveChoice(index int) {
	p := g.Pending
	g.Pending = nil
	option := p.Options[index]
	spell := p.source
	at := spell.Pos
	if spell.OnBoard && !spell.Def.IsMonster() {
		g.bury(spell, "used", noOne)
	}

	switch p.Kind {
	case "reviveCard":
		from := g.seat(option.seat)
		if from == nil || option.Num == nil || option.index >= len(from.Graveyard) || from.Graveyard[option.index] != *option.Num {
			return
		}
		def := g.Cat.Card(*option.Num)
		if def == nil || g.Board[at] != nil || g.leaderAt(at) != nil {
			return
		}
		if def.IsMonster() && g.monstersFull(p.Seat) {
			return
		}
		from.Graveyard = append(from.Graveyard[:option.index], from.Graveyard[option.index+1:]...)
		c := g.newCard(def.Num, p.Seat)
		if c == nil {
			return
		}
		g.place(c, at)
		g.Seats[p.Seat].Stats.Revives++
		if def.IsMonster() {
			c.FaceDown = false
			g.Seats[p.Seat].Stats.Summons++
			g.emit(Event{Type: "summon", Seat: p.Seat, CardID: c.ID, Num: cardNum(def.Num), X: at.X, Y: at.Y, Text: "revived"})
			g.enterTile(c)
			return
		}
		g.emit(Event{Type: "summon", Seat: p.Seat, CardID: c.ID, X: at.X, Y: at.Y, Text: "revived"})
		// A revived spell is cast at once when it can be; otherwise it is set.
		if def.Kind != KindTrap && g.canActivate(c) == nil {
			g.reveal(c)
			g.activate(c)
		}
	case "reviveSpell":
		from := g.seat(option.seat)
		if from == nil || option.Num == nil || option.index >= len(from.Graveyard) || from.Graveyard[option.index] != *option.Num {
			return
		}
		tiles := g.freeSummonTiles(p.Seat, Pos{999, 999})
		if len(tiles) == 0 || g.countOnBoard(p.Seat, false) >= g.Cfg.MaxSpells {
			return
		}
		from.Graveyard = append(from.Graveyard[:option.index], from.Graveyard[option.index+1:]...)
		if c := g.newCard(*option.Num, p.Seat); c != nil {
			g.place(c, tiles[0])
			g.Seats[p.Seat].Stats.Revives++
			g.emit(Event{Type: "summon", Seat: p.Seat, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y, Text: "revived"})
		}
	case "revive":
		from := g.seat(option.seat)
		// The graveyard may have changed while the player was choosing.
		if from == nil || option.Num == nil || option.index >= len(from.Graveyard) || from.Graveyard[option.index] != *option.Num {
			return
		}
		from.Graveyard = append(from.Graveyard[:option.index], from.Graveyard[option.index+1:]...)
		if g.Board[at] != nil || g.leaderAt(at) != nil {
			return
		}
		if c := g.newCard(*option.Num, p.Seat); c != nil {
			c.FaceDown = false
			g.place(c, at)
			g.Seats[p.Seat].Stats.Summons++
			g.Seats[p.Seat].Stats.Revives++
			g.emit(Event{Type: "summon", Seat: p.Seat, CardID: c.ID, Num: cardNum(c.Def.Num), X: at.X, Y: at.Y, Text: "revived"})
			g.enterTile(c)
		}
	case "heal":
		// The ally may have fallen while the caster was choosing.
		if s := g.seat(option.seat); s != nil && s.Alive && g.sameTeam(s.Index, p.Seat) {
			g.restore(s.Index, spell.Def.Effect)
		}
	case "control":
		if c := g.Cards[option.cardID]; c != nil && c.OnBoard && !g.sameTeam(c.Owner, p.Seat) {
			g.borrow(c, p.Seat)
		}
	case "absorb":
		if target := g.Cards[option.cardID]; option.index >= 0 && target != nil {
			g.absorb(spell, target)
		}
	}
}

// --- monster abilities ---------------------------------------------------

// Passive abilities work while their monster sits face up on the field; they
// are never activated.

// damageAfterAbilities is how much of a hit a seat's LP actually takes once
// its team's monsters have had their say.
func (g *Game) damageAfterAbilities(seat, amount int) int {
	halved := false
	for _, m := range g.monsters(func(m *Card) bool { return !m.FaceDown && g.sameTeam(m.Owner, seat) }) {
		// Tenderness: only in defense position, and two of them still only halve once.
		if m.has("halveDamage") != nil {
			halved = halved || m.Defense
		}
	}
	if halved {
		amount /= 2
	}
	return amount
}

// battleBonus is what a monster adds to its ATK and DEF for one battle
// against foe. Kinetic Soldier: +2000 against warriors, attacking or defending.
func (g *Game) battleBonus(c, foe *Card) int {
	if c.FaceDown {
		return 0
	}
	bonus := 0
	for _, e := range c.abilities() {
		switch e.Op {
		case "battleBonus":
			if matches(e, foe.Def) {
				bonus += e.Amount
			}
		}
	}
	return bonus
}

// breaksLabyrinth says whether a monster may enter labyrinth squares: Cannon
// Soldier, while face up (a passive ability, like the others).
func (g *Game) breaksLabyrinth(c *Card) bool {
	if c.FaceDown || !c.Def.IsMonster() {
		return false
	}
	switch {
	case c.has("breakLabyrinth") != nil:
		return true
	}
	return false
}

// clearLabyrinth turns a labyrinth square a monster has entered into normal
// terrain: Cannon Soldier blasts its way through. Squares it walks through on
// a longer move are cleared too, since every square it enters goes through
// enterTile.
func (g *Game) clearLabyrinth(c *Card) {
	if !c.OnBoard || g.Tiles[c.Pos] != TerrainLabyrinth || !g.breaksLabyrinth(c) {
		return
	}
	g.Tiles[c.Pos] = TerrainNormal
	g.emit(Event{Type: "terrain", Seat: c.Owner, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y, Text: TerrainNormal})
}

// blast is Blast Sphere: destroyed in battle, it takes every card in the 3×3
// area around the square it fell on with it, friend or foe. Deck leaders are
// not cards and are untouched. Only a battle sets it off, so a sphere caught
// in another sphere's blast does not explode in turn.
func (g *Game) blast(c *Card) {
	at := c.Pos
	g.emit(Event{Type: "blast", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: at.X, Y: at.Y, Text: c.Def.Name})
	for dx := -1; dx <= 1; dx++ {
		for dy := -1; dy <= 1; dy++ {
			if victim := g.Board[at.Add(dx, dy)]; victim != nil {
				victim.FaceDown = false
				g.bury(victim, "blast", c.Owner)
			}
		}
	}
}

// --- traps ---------------------------------------------------------------

func (g *Game) revealTrap(t *Card) {
	t.FaceDown = false
	g.Seats[t.Owner].Stats.TrapsSprung++
	g.emit(Event{Type: "trap", Seat: t.Owner, CardID: t.ID, Num: cardNum(t.Def.Num), X: t.Pos.X, Y: t.Pos.Y, Text: t.Def.Name})
}

// springTrap shows a trap going off; a disposable one is used up.
func (g *Game) springTrap(t *Card) {
	g.revealTrap(t)
	if !t.Def.Effect.Permanent {
		g.bury(t, "used", noOne)
	}
}

// trapLive says whether a trap may go off at all: Ancient Tree of
// Enlightenment stops every trap, and an enemy Royal Decree stops this one.
func (g *Game) trapLive(t *Card) bool {
	if g.anyAura("noTraps") {
		return false
	}
	for _, d := range g.Board {
		if d.Def.Kind == KindTrap && d.Def.Effect != nil && d.Def.Effect.Op == "trapDecree" && !g.sameTeam(d.Owner, t.Owner) {
			if d.FaceDown {
				g.revealTrap(d)
			}
			return false
		}
	}
	return true
}

// trapReady says whether a trap waits for a trigger set off by an enemy
// seat: set face down (or permanent), and allowed to go off.
func (g *Game) trapReady(t *Card, trigger string, enemy int) bool {
	e := t.Def.Effect
	if !t.OnBoard || t.Def.Kind != KindTrap || e == nil || e.Trigger != trigger || g.sameTeam(t.Owner, enemy) {
		return false
	}
	return (t.FaceDown || e.Permanent) && g.trapLive(t)
}

// trapFires reports whether a face-down trap goes off for a monster that has
// just moved.
func trapFires(t, mover *Card, g *Game) bool {
	e := t.Def.Effect
	if e == nil || e.Trigger != "move" || !t.FaceDown || g.sameTeam(t.Owner, mover.Owner) {
		return false
	}
	if e.Range != "full" && t.Pos.Ring(mover.Pos) > 1 {
		return false
	}
	// White Magical Hat and friends slip past limited-range traps.
	if e.Range != "full" && g.ability(mover, "trapImmune") != nil {
		return false
	}
	if e.Op == "trapDestroy" {
		atk := g.here(mover)
		if (e.MaxAtk > 0 && atk > e.MaxAtk) || atk < e.MinAtk {
			return false
		}
	}
	return g.trapLive(t)
}

// springMoveTraps lets one enemy trap react to a monster that finished a step.
func (g *Game) springMoveTraps(mover *Card) {
	for _, t := range g.boardCards() {
		if t.Def.Kind == KindTrap && t.FaceDown && trapFires(t, mover, g) {
			g.fireMoveTrap(t, mover)
			return
		}
	}
}

func (g *Game) fireMoveTrap(t, mover *Card) {
	e := t.Def.Effect
	g.revealTrap(t)
	g.reveal(mover)
	switch e.Op {
	case "trapBind":
		mover.AtkMod -= e.Amount
		mover.DefMod -= e.Amount
		g.spellbind(mover, e.Turns)
	case "trapDestroy":
		g.bury(mover, "trap", t.Owner)
	case "trapRuin":
		for _, c := range g.boardCards() {
			if c != t && c.Pos.Ring(t.Pos) <= 1 {
				g.bury(c, "trap", t.Owner)
			}
		}
	}
	g.bury(t, "used", noOne)
}

// springAttackTraps lets the defending team answer a declared attack. Every
// attack trap of theirs that is ready goes off, in the order the traps were
// set, until one stops the attack: Mirror Wall weakens the attacker and lets
// the next one go, Negate Attack and Mirror Force end it. A permanent trap
// (Mirror Wall) stays face up and answers every attack after. The attacker
// is face up by now (its attack revealed it). It returns true when the
// attack no longer happens.
func (g *Game) springAttackTraps(att *Card, defender int) bool {
	for _, t := range g.boardCards() {
		if !t.OnBoard || !g.sameTeam(t.Owner, defender) || !g.trapReady(t, "attack", att.Owner) {
			continue
		}
		e := t.Def.Effect
		g.springTrap(t)
		switch e.Op {
		case "trapNegate":
			return true
		case "trapMirrorForce":
			// Only the attacking player's face-up monsters in attack position.
			for _, m := range g.monsters(func(m *Card) bool { return m.Owner == att.Owner && !m.FaceDown && !m.Defense }) {
				g.bury(m, "trap", t.Owner)
			}
			return true
		case "trapWeaken":
			att.AtkMod -= g.here(att) / 2
		}
		if !att.OnBoard {
			return true
		}
	}
	return false
}

// isAttackTrap reports whether c is a trap that answers attacks.
func isAttackTrap(c *Card) bool {
	return c.Def.Kind == KindTrap && c.Def.Effect != nil && c.Def.Effect.Trigger == "attack"
}

// springPositionTraps answers an enemy monster going into defense next to
// a trap (Shadow of Eyes, Gorgon's Eye).
func (g *Game) springPositionTraps(c *Card) {
	for _, t := range g.boardCards() {
		if !g.trapReady(t, "defense", c.Owner) || (t.Def.Effect.Range != "full" && t.Pos.Ring(c.Pos) > 1) {
			continue
		}
		e := t.Def.Effect
		g.springTrap(t)
		g.reveal(c)
		switch e.Op {
		case "trapForceAttack":
			c.Defense = false
			g.emit(Event{Type: "position", Seat: c.Owner, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y})
		case "trapGorgon":
			g.spellbind(c, -1)
		}
		return
	}
}
