package engine

import (
	"fmt"
	"slices"
	"sort"
)

// Monster abilities. A monster's abilities are data (CardDef.Abilities, each
// an Effect whose On says when it works); this file is where they are carried
// out. Most of them reuse a handful of ops with different filters, so a new
// monster usually needs no code.
//
//	""          passive: works while the monster is face up
//	"flip"      once, when the monster is turned face up (by anything)
//	"battleFlip" once, when it is turned face up in a battle with a monster
//	"battle"    every time it fights a monster
//	"destroyed" when it is destroyed in battle
//	"anyDestroy" when it is destroyed by anything: a battle, a spell, a trap,
//	            another card's ability, a blast or crush terrain ("When
//	            destroyed", with no "in battle"). Any op that can be used at
//	            "destroyed" can be used here; outside a battle there is no
//	            opposing monster, so the "...Foe" ops then do nothing.
//	"aura"      while it is face up in defense position
//	"turn"      when its owner's turn begins with it face up in defense
//	"move"      every time it moves

// AbilityOps is every monster ability op the engine carries out, with the
// moments it can be used at. Card validation checks abilities against it.
var AbilityOps = map[string][]string{
	// Passive.
	"trapImmune": {""}, "fastMove": {""}, "enterLabyrinth": {""}, "immobile": {""},
	"noBattleDamage": {""}, "cancelMods": {""}, "autoDestroy": {""}, "banish": {""},
	"shapesnatch": {""}, "whim": {""}, "imitate": {""}, "absorb": {""},
	"battleBonus": {""}, "breakLabyrinth": {""}, "halveDamage": {""},
	"blastOnDestroy": {"", "destroyed"}, "flipBoostMachines": {"", "flip"},
	// While face up in defense.
	"auraBoost": {"aura"}, "auraBind": {"aura"}, "auraMove": {"aura"},
	"noSpells": {"aura"}, "noTraps": {"aura"}, "noControl": {"aura"}, "noMoveBonus": {"aura"},
	"dragonWard": {"aura"}, "freezeCountdown": {"aura"}, "fastCountdown": {"aura"},
	"starsMinus": {"aura"}, "starsPlus": {"aura"}, "healDouble": {"aura"}, "damagePlus": {"aura"},
	"equipPlus": {"aura"}, "noLeader": {"aura"}, "seeClass": {"aura"},
	// Things that happen.
	"boost":          {"flip", "turn", "destroyed"},
	"boostIfLeader":  {"flip"},
	"boostPerGrave":  {"flip"},
	"boostPerField":  {"flip"},
	"copyStrongest":  {"flip"},
	"terrain":        {"flip", "battle", "destroyed"},
	"destroyTerrain": {"flip"},
	"reveal":         {"flip"},
	"hide":           {"flip"},
	"bind":           {"flip"},
	"unbind":         {"flip"},
	"position":       {"flip"},
	"destroyNear":    {"flip", "destroyed"},
	"destroyRandom":  {"flip"},
	"discardHands":   {"flip"},
	"heal":           {"flip", "turn"},
	"maxStars":       {"flip"},
	"extraPlay":      {"flip", "destroyed"},
	"summon":         {"flip"},
	"returnSelf":     {"flip", "destroyed"},
	"reviveSpell":    {"flip"},
	"controlAll":     {"flip"},
	"jigen":          {"flip"},
	"revealLast":     {"flip"},
	"identify":       {"flip"},
	"teleport":       {"flip"},
	"convert":        {"flip"},
	"transform":      {"flip"},
	"spellbindFoe":   {"battleFlip", "destroyed"},
	"destroyFoe":     {"battleFlip", "destroyed"},
	"weakenFoe":      {"battleFlip", "destroyed"},
	"controlFoe":     {"battleFlip"},
	"convertFoe":     {"battleFlip"},
	"copyFoe":        {"battleFlip"},
	"returnFoe":      {"battleFlip"},
	"burn":           {"destroyed"},
	"zeroStars":      {"destroyed"},
	"weakenCross":    {"destroyed"},
	"reviveSelf":     {"destroyed"},
	"rally":          {"destroyed"},
	"massRevive":     {"destroyed"},
	"battleCost":     {"battle"},
	"souleater":      {"turn"},
	"caratPull":      {"turn"},
	"evolve":         {"turn"},
	"jigenBlast":     {"turn"},
	"moveTerrain":    {"move"},
	"moveCost":       {"move"},
	"moveBurn":       {"move"},
}

// abilities is everything a card can do by itself: the abilities printed on
// it (a monster's Effect counts as one) and those a power-up gave it.
//
// It is called from nearly every rule check, so it only allocates when it
// has to put more than one list together. Callers only read the result.
func (c *Card) abilities() []*Effect {
	printed := c.Def.IsMonster() && c.Def.Effect != nil
	switch {
	case !printed && len(c.Granted) == 0:
		return c.Def.Abilities
	case !printed && len(c.Def.Abilities) == 0:
		return c.Granted
	}
	out := make([]*Effect, 0, 1+len(c.Def.Abilities)+len(c.Granted))
	if printed {
		out = append(out, c.Def.Effect)
	}
	out = append(out, c.Def.Abilities...)
	return append(out, c.Granted...)
}

// has finds an ability by op, in the order abilities lists them, without building the list.
func (c *Card) has(op string) *Effect {
	if c.Def.IsMonster() && c.Def.Effect != nil && c.Def.Effect.Op == op {
		return c.Def.Effect
	}
	for _, e := range c.Def.Abilities {
		if e.Op == op {
			return e
		}
	}
	for _, e := range c.Granted {
		if e.Op == op {
			return e
		}
	}
	return nil
}

// ability returns a passive ability of a monster face up on the field.
func (g *Game) ability(c *Card, op string) *Effect {
	if c == nil || !c.OnBoard || c.FaceDown || !c.Def.IsMonster() {
		return nil
	}
	return c.has(op)
}

func guarding(c *Card) bool {
	return c.OnBoard && !c.FaceDown && c.Defense && c.Def.IsMonster()
}

type aura struct {
	src *Card
	e   *Effect
}

// auras lists the auras of one op in force: monsters face up in defense.
func (g *Game) auras(op string) []aura {
	var out []aura
	for _, c := range g.Board {
		if !guarding(c) {
			continue
		}
		for _, e := range c.abilities() {
			if e.On == "aura" && e.Op == op {
				out = append(out, aura{c, e})
			}
		}
	}
	return out
}

func (g *Game) anyAura(op string) bool { return len(g.auras(op)) > 0 }

// sideOK says whether a card of seat target is on the side an effect of a
// card controlled by seat source reaches.
func (g *Game) sideOK(side string, source, target int) bool {
	if side == "own" {
		return g.sameTeam(source, target)
	}
	if side == "enemy" {
		return !g.sameTeam(source, target)
	}
	return true
}

// --- strength --------------------------------------------------------------

func (g *Game) auraBonus(c *Card) (atk, def int) {
	if !c.Def.IsMonster() {
		return 0, 0
	}
	for _, a := range g.auras("auraBoost") {
		if g.sideOK(a.e.Side, a.src.Owner, c.Owner) && matches(a.e, c.Def) {
			if a.e.Stat != "def" {
				atk += a.e.Amount
			}
			def += a.e.Amount
		}
	}
	return atk, def
}

// atk / def are a monster's strength standing on a terrain, auras included.
// strengthOn is atk and def together, scanning the auras once.
func (g *Game) strengthOn(c *Card, terrain string) (atk, def int) {
	auraAtk, auraDef := g.auraBonus(c)
	baseAtk, baseDef := c.baseStats()
	b := c.Def.bonus(terrain)
	return floor0(baseAtk + c.AtkMod + auraAtk + b), floor0(baseDef + c.DefMod + auraDef + b)
}

func (g *Game) atk(c *Card, terrain string) int {
	a, _ := g.auraBonus(c)
	base, _ := c.baseStats()
	return floor0(base + c.AtkMod + a + c.Def.bonus(terrain))
}

func (g *Game) def(c *Card, terrain string) int {
	_, d := g.auraBonus(c)
	_, base := c.baseStats()
	return floor0(base + c.DefMod + d + c.Def.bonus(terrain))
}

// fight is what a monster fights foe with on a terrain: its ATK, or its DEF
// when useDef, with everything that applies to this one battle.
func (g *Game) fight(c, foe *Card, terrain string, useDef bool, swing int) int {
	auraAtk, auraDef := g.auraBonus(c)
	baseAtk, baseDef := c.baseStats()
	base, mod, aura := baseAtk, c.AtkMod, auraAtk
	if useDef {
		base, mod, aura = baseDef, c.DefMod, auraDef
	}
	if g.ability(c, "shapesnatch") != nil {
		// The enemy leader's ATK when attacking, its own leader's DEF otherwise.
		if useDef || c.Owner != g.Turn {
			if l := g.Seats[c.Owner].LeaderDef; l != nil {
				base = l.Def
			}
		} else if l := g.seat(foe.Owner); l != nil && l.LeaderDef != nil {
			base = l.LeaderDef.Atk
		}
	}
	if g.ability(foe, "cancelMods") != nil {
		mod, aura = 0, 0
	}
	return floor0(base + mod + aura + c.Def.bonus(terrain) + g.battleBonus(c, foe) + swing)
}

// whimSwing is Goddess of Whim's luck for one battle: up to Amount either way.
func (g *Game) whimSwing(c *Card) int {
	e := g.ability(c, "whim")
	if e == nil || e.Amount <= 0 {
		return 0
	}
	steps := e.Amount / 100
	return (g.rng.Intn(2*steps+1) - steps) * 100
}

// bound is whether a card sits out: spellbound, or held by an aura.
func (g *Game) bound(c *Card) bool {
	if c.Spellbound != 0 {
		return true
	}
	if !c.Def.IsMonster() {
		return false
	}
	for _, a := range g.auras("auraBind") {
		if a.src != c && g.sideOK(a.e.Side, a.src.Owner, c.Owner) && matches(a.e, c.Def) {
			return true
		}
	}
	return false
}

// powerUp raises (or lowers) a monster's ATK and DEF on behalf of seat by.
// An enemy Reverse Trap turns a rise into a fall. It returns the change.
func (g *Game) powerUp(m *Card, atk, def, by int) (int, int) {
	if atk > 0 || def > 0 {
		for _, t := range g.boardCards() {
			if g.trapReady(t, "powerUp", by) && t.Def.Effect.Op == "trapReverse" {
				g.springTrap(t)
				atk, def = -atk, -def
				break
			}
		}
	}
	m.AtkMod += atk
	m.DefMod += def
	return atk, def
}

// warded is a dragon a Lord of D. on its side shields from enemy spells.
func (g *Game) warded(m *Card, caster int) bool {
	if !m.Def.IsMonster() || m.Def.Type != "dragon" || g.sameTeam(m.Owner, caster) {
		return false
	}
	for _, a := range g.auras("dragonWard") {
		if g.sameTeam(a.src.Owner, m.Owner) {
			return true
		}
	}
	return false
}

func (g *Game) canControl() bool { return !g.anyAura("noControl") }

// --- moments ---------------------------------------------------------------

// revealIn turns a card face up as part of a battle with foe.
func (g *Game) revealIn(c, foe *Card) {
	if c.FaceDown {
		g.battleFoe = foe
		g.reveal(c)
		g.battleFoe = nil
	}
}

// flipped sets off what a monster does when it is turned face up on the
// field, by its owner or by anything else (a battle, Swords of Revealing
// Light...). A monster that arrives face up (a ritual, a revival) is not
// flipped.
func (g *Game) flipped(c *Card) {
	foe := g.battleFoe
	g.battleFoe = nil
	if !c.Def.IsMonster() {
		return
	}
	for _, e := range c.abilities() {
		if !c.OnBoard {
			return
		}
		switch {
		case e.Op == "flipBoostMachines":
			g.flipBoostMachines(c, e)
		case e.On == "flip":
			g.doAbility(c, e, nil)
		case e.On == "battleFlip" && foe != nil:
			g.doAbility(c, e, foe)
		}
	}
}

// flipBoostMachines is Machine King: +100 ATK and DEF for every face-up
// machine on the field, on either side, itself included.
func (g *Game) flipBoostMachines(c *Card, e *Effect) {
	machines := len(g.monsters(func(m *Card) bool { return !m.FaceDown && m.Def.Type == "machine" }))
	amount := e.Amount * machines
	if amount == 0 {
		return
	}
	c.AtkMod += amount
	c.DefMod += amount
	g.emit(Event{Type: "flipBoost", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Amount: amount, Text: c.Def.Name})
}

// engage runs what a monster does every time it fights.
func (g *Game) engage(c, foe *Card) {
	if c.FaceDown || !c.OnBoard {
		return
	}
	for _, e := range c.abilities() {
		if e.On == "battle" {
			g.doAbility(c, e, foe)
		}
	}
}

// destroyedInBattle sets off what a monster does when it falls in battle.
func (g *Game) destroyedInBattle(c, foe *Card) {
	for _, e := range c.abilities() {
		switch {
		case e.Op == "blastOnDestroy":
			g.blast(c)
		case e.On == "destroyed" || e.On == "anyDestroy":
			g.doAbility(c, e, foe)
		}
	}
}

// destroyedBy are the bury reasons that are a card being destroyed outside a
// battle. Not destroyed: a card used up, fused, replaced, discarded, eaten by
// its leader, sacrificed to a ritual, trampled, banished, or removed by the
// test tools. A battle sets abilities off itself (destroyedInBattle), once
// the fight is over.
var destroyedBy = map[string]bool{"spell": true, "trap": true, "ability": true, "blast": true, "crushed": true, "negated": true}

// destroyedElsewhere sets off the "anyDestroy" abilities of a monster just
// destroyed by something other than a battle (see bury). There is no
// opposing monster.
func (g *Game) destroyedElsewhere(c *Card, reason string) {
	if !destroyedBy[reason] || !c.Def.IsMonster() {
		return
	}
	for _, e := range c.abilities() {
		if e.On == "anyDestroy" {
			g.doAbility(c, e, nil)
		}
	}
}

// guardTurn runs at the start of a seat's turn for each of its monsters:
// those face up in defense count the turn and use their "turn" abilities.
func (g *Game) guardTurn(s *Seat) {
	for _, c := range g.boardCards() {
		if c.Owner != s.Index || !c.Def.IsMonster() || !c.OnBoard {
			continue
		}
		if !guarding(c) {
			c.Guard = 0
			continue
		}
		if c.SelfFlipped {
			c.Guard++
		}
		for _, e := range c.abilities() {
			if e.On == "turn" && c.OnBoard {
				g.doAbility(c, e, nil)
			}
		}
	}
}

// moved runs what a monster does when it has moved spaces squares.
func (g *Game) moved(c *Card, spaces int) {
	if c.FaceDown {
		return
	}
	for _, e := range c.abilities() {
		if e.On != "move" {
			continue
		}
		switch e.Op {
		case "moveCost":
			g.payLP(c.Owner, e.Amount*spaces, c.Def.Name)
		case "moveBurn":
			for _, s := range g.enemies(c.Owner) {
				g.damage(s.Index, e.Amount, c.Def.Name, c.Owner)
			}
		}
	}
}

// --- what abilities do ----------------------------------------------------

// pick lists the monsters an ability reaches: on its side, through its filters.
func (g *Game) pick(c *Card, e *Effect) []*Card {
	return g.monsters(func(m *Card) bool {
		if !g.sideOK(e.Side, c.Owner, m.Owner) || !matches(e, m.Def) {
			return false
		}
		return e.Terrain == "" || g.Tiles[m.Pos] == e.Terrain
	})
}

// cardsOf lists the cards in play (not c) on a side, of the given kinds.
func (g *Game) cardsOf(c *Card, side string, kinds []string) []*Card {
	var out []*Card
	for _, m := range g.boardCards() {
		if m == c || !g.sideOK(side, c.Owner, m.Owner) {
			continue
		}
		if len(kinds) > 0 && !slices.Contains(kinds, m.Def.Kind) && !(slices.Contains(kinds, "spell") && !m.Def.IsMonster()) {
			continue
		}
		out = append(out, m)
	}
	return out
}

func (g *Game) announce(c *Card, amount int) {
	g.emit(Event{Type: "ability", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Amount: amount, Text: c.Def.Name})
}

// doAbility carries out one ability of c; foe is the monster it is fighting,
// if any.
func (g *Game) doAbility(c *Card, e *Effect, foe *Card) {
	owner := g.seat(c.Owner)
	if owner == nil {
		return
	}
	// What the ability destroys, or the LP it takes, is the monster's doing.
	defer g.crediting(c)()
	foeHere := foe != nil && foe.OnBoard
	self := func(atk, def int) {
		if atk != 0 || def != 0 {
			c.AtkMod += atk
			c.DefMod += def
			g.announce(c, atk)
		}
	}

	switch e.Op {
	case "boost":
		for _, m := range g.pick(c, e) {
			g.powerUp(m, e.Amount, e.Amount, c.Owner)
		}
		g.announce(c, e.Amount)
	case "boostIfLeader":
		if l := owner.LeaderDef; l != nil && matches(e, l) {
			self(e.Amount, e.Amount)
		}
	case "boostPerGrave":
		n := 0
		for _, s := range g.Seats {
			if e.Side == "own" && s.Index != c.Home {
				continue
			}
			for _, num := range s.Graveyard {
				if def := g.Cat.Card(num); def != nil && matches(e, def) {
					n++
				}
			}
		}
		self(e.Amount*n, e.Amount*n)
	case "boostPerField":
		n := len(g.monsters(func(m *Card) bool { return m != c && matches(e, m.Def) }))
		self(e.Amount*n, e.Amount*n)
	case "copyStrongest":
		if best := g.strongest(g.monsters(func(m *Card) bool { return m != c && !m.FaceDown })); best != nil {
			g.copyStats(c, best)
		}
	case "copyFoe":
		if foeHere {
			g.copyStats(c, foe)
		}

	case "terrain":
		g.reshape(c, e)
	case "destroyTerrain":
		for _, m := range g.cardsOf(c, "", nil) {
			if g.Tiles[m.Pos] == e.Terrain {
				g.bury(m, "ability", c.Owner)
			}
		}
		g.announce(c, 0)
	case "reveal":
		for _, m := range g.cardsOf(c, e.Side, e.Kinds) {
			if e.MaxAtk > 0 && (!m.Def.IsMonster() || m.Def.Atk > e.MaxAtk) {
				continue
			}
			g.reveal(m)
		}
	case "hide":
		for _, m := range g.cardsOf(c, e.Side, e.Kinds) {
			m.FaceDown = true
		}
		g.announce(c, 0)
	case "bind":
		for _, m := range g.cardsOf(c, e.Side, e.Kinds) {
			if len(e.Types) == 0 || matches(e, m.Def) {
				g.spellbind(m, e.Turns)
			}
		}
	case "unbind":
		for _, m := range g.cardsOf(c, e.Side, nil) {
			m.Spellbound = 0
		}
		g.announce(c, 0)
	case "position":
		for _, m := range g.monsters(func(m *Card) bool { return g.sideOK(e.Side, c.Owner, m.Owner) }) {
			m.Defense = e.Position == "defense"
		}
		g.announce(c, 0)
	case "destroyNear":
		radius := max(e.Radius, 1)
		for _, m := range g.cardsOf(c, e.Side, e.Kinds) {
			if m.Pos.Ring(c.Pos) <= radius {
				g.bury(m, "ability", c.Owner)
			}
		}
	case "destroyRandom":
		victims := g.cardsOf(c, "enemy", nil)
		if len(victims) > 0 {
			v := victims[g.rng.Intn(len(victims))]
			v.FaceDown = false
			g.bury(v, "ability", c.Owner)
		}
	case "discardHands":
		for _, s := range g.Seats {
			for _, h := range append([]*Card(nil), s.Hand...) {
				s.removeFromHand(h)
				h.Pos = s.Leader
				g.bury(h, "discarded", noOne)
			}
		}
	case "heal":
		g.heal(owner.Index, e.Amount)
	case "maxStars":
		owner.Stars = g.Cfg.MaxStars
		g.announce(c, 0)
	case "extraPlay":
		if g.Turn == owner.Index && owner.PlaysLeft == 0 {
			owner.PlaysLeft = 1
			g.announce(c, 0)
		}
	case "summon":
		if e.Summon != nil {
			g.summonNear(owner.Index, *e.Summon, e.FaceDown, c.Pos)
		}
	case "returnSelf":
		g.toDeck(c)
	case "returnFoe":
		if foeHere {
			g.toDeck(foe)
		}
	case "reviveSpell":
		// Only on the turn of the player controlling it.
		if g.Turn != owner.Index || g.Pending != nil || len(g.freeSummonTiles(owner.Index, Pos{999, 999})) == 0 {
			return
		}
		options := g.graveOptions(func(_ int, def *CardDef) bool { return !def.IsMonster() })
		if len(options) > 0 {
			g.Pending = &Pending{Seat: owner.Index, Kind: "reviveSpell", Prompt: "Choose a spell to set in your summoning area", Options: options, source: c}
		}
	case "controlAll":
		if !g.canControl() {
			return
		}
		for _, m := range g.monsters(func(m *Card) bool { return !g.sameTeam(m.Owner, c.Owner) && matches(e, m.Def) }) {
			g.borrow(m, owner.Index)
		}
	case "controlFoe":
		if foeHere && g.canControl() && !g.sameTeam(foe.Owner, c.Owner) && matches(e, foe.Def) {
			g.borrow(foe, owner.Index)
		}
	case "jigen":
		for _, m := range g.cardsOf(c, "", nil) {
			if m.Pos.Ring(c.Pos) == 1 && slices.Contains(e.Nums, m.Def.Num) {
				if p, ok := g.enemySummonTile(owner.Index); ok {
					g.place(m, p)
					g.emit(Event{Type: "move", Seat: m.Owner, CardID: m.ID, X: p.X, Y: p.Y})
				}
				break
			}
		}
	case "revealLast":
		for _, s := range g.enemies(owner.Index) {
			if m := g.Cards[s.LastPlayed]; m != nil && m.OnBoard {
				g.reveal(m)
			}
		}
	case "identify":
		var hidden []*Card
		for _, m := range g.cardsOf(c, "enemy", nil) {
			if m.FaceDown && !slices.Contains(m.KnownBy, owner.Team) {
				hidden = append(hidden, m)
			}
		}
		if len(hidden) > 0 {
			m := hidden[g.rng.Intn(len(hidden))]
			m.KnownBy = append(m.KnownBy, owner.Team)
			g.announce(c, 0)
		}
	case "teleport":
		var p Pos
		ok := false
		if e.Side == "enemy" {
			p, ok = g.enemySummonTile(owner.Index)
		} else if tiles := g.freeSummonTiles(owner.Index, c.Pos); len(tiles) > 0 {
			p, ok = tiles[g.rng.Intn(len(tiles))], true
		}
		if ok {
			g.place(c, p)
			g.emit(Event{Type: "move", Seat: c.Owner, CardID: c.ID, X: p.X, Y: p.Y})
		}
	case "convert":
		for _, m := range g.pick(c, e) {
			g.retype(m, e.ToType, e.ToAttr)
		}
		g.announce(c, 0)
	case "convertFoe":
		if foeHere {
			g.retype(foe, e.ToType, e.ToAttr)
		}
	case "transform":
		if e.Summon != nil {
			for _, m := range g.pick(c, e) {
				g.transformInto(m, *e.Summon)
			}
		}

	case "spellbindFoe":
		if foeHere {
			g.spellbind(foe, e.Turns)
		}
	case "destroyFoe":
		if foeHere && matches(e, foe.Def) {
			foe.FaceDown = false
			g.bury(foe, "ability", c.Owner)
		}
	case "weakenFoe":
		if foeHere {
			foe.AtkMod -= e.Amount
			foe.DefMod -= e.Amount
			g.announce(c, -e.Amount)
		}
	case "weakenCross":
		for _, m := range g.monsters(func(m *Card) bool { return m != c && m.Pos.Steps(c.Pos) == 1 }) {
			m.AtkMod -= e.Amount
			m.DefMod -= e.Amount
		}
		g.announce(c, -e.Amount)
	case "burn":
		for _, s := range g.enemies(owner.Index) {
			g.damage(s.Index, e.Amount, c.Def.Name, owner.Index)
		}
	case "zeroStars":
		for _, s := range g.enemies(owner.Index) {
			s.Stars = 0
		}
		g.announce(c, 0)
	case "reviveSelf":
		num := c.Def.Num
		if e.Summon != nil {
			num = *e.Summon
		}
		if g.monstersFull(owner.Index) {
			return
		}
		tiles := g.freeSummonTiles(owner.Index, c.Pos)
		if len(tiles) == 0 {
			return
		}
		g.takeFromGraveyard(c.Home, c.Def.Num)
		if r := g.newCard(num, owner.Index); r != nil {
			at := tiles[g.rng.Intn(len(tiles))]
			r.Home = c.Home
			g.place(r, at)
			g.emit(Event{Type: "summon", Seat: owner.Index, CardID: r.ID, X: at.X, Y: at.Y, Text: "revived"})
			g.enterTile(r)
		}
	case "rally":
		if owner.LP > e.MinLP {
			for _, m := range g.monsters(func(m *Card) bool { return m.Owner == owner.Index }) {
				g.powerUp(m, e.Amount, e.Amount, owner.Index)
			}
			g.payLP(owner.Index, e.Cost, c.Def.Name)
		}
	case "massRevive":
		if owner.LP > e.MinLP {
			g.massRevive(owner, e.Count)
			g.payLP(owner.Index, e.Cost, c.Def.Name)
		}

	case "battleCost":
		g.payLP(owner.Index, e.Amount, c.Def.Name)
	case "souleater":
		n := 0
		for _, s := range g.Seats {
			kept := s.Graveyard[:0]
			for _, num := range s.Graveyard {
				if def := g.Cat.Card(num); def != nil && def.IsMonster() {
					n++
				} else {
					kept = append(kept, num)
				}
			}
			s.Graveyard = kept
		}
		self(e.Amount*n, e.Amount*n)
	case "caratPull":
		g.caratPull(c)
	case "evolve":
		if e.Summon != nil && c.Guard >= e.Turns {
			g.transformInto(c, *e.Summon)
		}
	case "jigenBlast":
		if c.Guard >= e.Turns {
			g.blast(c)
		}
	}
}

func (g *Game) copyStats(c, from *Card) {
	c.AtkMod = from.Def.Atk + from.AtkMod - c.Def.Atk
	c.DefMod = from.Def.Def + from.DefMod - c.Def.Def
	g.announce(c, 0)
}

// payLP takes LP a card's own effect costs its player.
func (g *Game) payLP(seat, amount int, reason string) {
	s := g.seat(seat)
	if s == nil || !s.Alive || amount <= 0 {
		return
	}
	lost := min(amount, s.LP)
	s.LP -= lost
	g.emit(Event{Type: "damage", Seat: seat, Amount: lost, Text: reason, X: s.Leader.X, Y: s.Leader.Y})
}

// reshape changes the terrain in an area around a card.
func (g *Game) reshape(c *Card, e *Effect) {
	if !ValidTerrain(e.Terrain) {
		return
	}
	at := c.Pos
	for p := range g.Tiles {
		in := p.Steps(at) <= e.Radius // the default, a diamond
		if e.Shape == "here" {
			in = p == at
		} else if e.Shape == "ring" {
			in = p.Ring(at) <= max(e.Radius, 1)
		} else if e.Shape == "row" {
			in = p.Y == at.Y
		}
		if in && g.leaderAt(p) == nil {
			g.Tiles[p] = e.Terrain
		}
	}
	g.emit(Event{Type: "terrain", Seat: c.Owner, X: at.X, Y: at.Y, Text: e.Terrain, Amount: e.Radius})
	for _, m := range g.monsters(nil) {
		if m.OnBoard {
			g.crush(m, c.Owner)
		}
	}
}

// retype turns a monster into another type or attribute.
func (g *Game) retype(m *Card, typ, attr string) {
	if !m.Def.IsMonster() || (typ == "" && attr == "") {
		return
	}
	def := *m.Def
	if typ != "" {
		def.Type = typ
	}
	if attr != "" {
		def.Attribute = attr
	}
	m.Def = &def
}

// transformInto turns a card in play into another card, keeping its place.
func (g *Game) transformInto(m *Card, num int) {
	def := g.Cat.Card(num)
	if def == nil || !m.OnBoard {
		return
	}
	m.Def = def
	m.AtkMod, m.DefMod, m.Guard = 0, 0, 0
	ev := Event{Type: "transform", Seat: m.Owner, CardID: m.ID, Num: publicNum(m), X: m.Pos.X, Y: m.Pos.Y}
	if !m.FaceDown {
		ev.Text = def.Name // events never name a face-down card
	}
	g.emit(ev)
}

// imitate is Insect Imitation: the monster becomes a random monster the
// card's "imitate" ability describes.
func (g *Game) imitate(m *Card) bool {
	e := m.has("imitate")
	if e == nil {
		return false
	}
	var pool []int
	for num := 0; num < 1000; num++ {
		if def := g.Cat.Card(num); def != nil && def.IsMonster() && num != m.Def.Num && matches(e, def) {
			pool = append(pool, num)
		}
	}
	if len(pool) == 0 {
		return false
	}
	g.transformInto(m, pool[g.rng.Intn(len(pool))])
	return true
}

// toDeck returns a card to its home deck and shuffles it.
func (g *Game) toDeck(c *Card) {
	home := g.seat(c.Home)
	if home == nil {
		return
	}
	if c.OnBoard {
		g.dropAbsorbed(c, noOne)
		delete(g.Board, c.Pos)
		delete(g.Cards, c.ID)
		c.OnBoard = false
		g.emit(Event{Type: "destroyed", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Text: "returned"})
	} else if !g.takeFromGraveyard(c.Home, c.Def.Num) {
		return
	}
	home.Deck = append(home.Deck, c.Def.Num)
	g.rng.Shuffle(len(home.Deck), func(a, b int) { home.Deck[a], home.Deck[b] = home.Deck[b], home.Deck[a] })
}

// takeFromGraveyard removes the newest copy of a card from a graveyard.
func (g *Game) takeFromGraveyard(seat, num int) bool {
	s := g.seat(seat)
	if s == nil {
		return false
	}
	for i := len(s.Graveyard) - 1; i >= 0; i-- {
		if s.Graveyard[i] == num {
			s.Graveyard = append(s.Graveyard[:i], s.Graveyard[i+1:]...)
			return true
		}
	}
	return false
}

// freeSummonTiles are the empty squares around a seat's leader, except one.
func (g *Game) freeSummonTiles(seat int, except Pos) []Pos {
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return nil
	}
	var out []Pos
	for _, p := range g.SummonTiles(s) {
		if p != except && g.Board[p] == nil {
			out = append(out, p)
		}
	}
	sortPos(out)
	return out
}

// enemySummonTile picks an empty square around an enemy leader.
func (g *Game) enemySummonTile(seat int) (Pos, bool) {
	var all []Pos
	for _, s := range g.enemies(seat) {
		all = append(all, g.freeSummonTiles(s.Index, Pos{999, 999})...)
	}
	if len(all) == 0 {
		return Pos{}, false
	}
	return all[g.rng.Intn(len(all))], true
}

// summonNear puts a new card from outside the deck into a seat's summoning area.
func (g *Game) summonNear(seat, num int, faceDown bool, except Pos) *Card {
	def := g.Cat.Card(num)
	if def == nil || (def.IsMonster() && g.monstersFull(seat)) {
		return nil
	}
	tiles := g.freeSummonTiles(seat, except)
	if len(tiles) == 0 {
		return nil
	}
	c := g.newCard(num, seat)
	c.FaceDown = faceDown
	at := tiles[g.rng.Intn(len(tiles))]
	g.place(c, at)
	g.Seats[seat].Stats.Summons++
	g.emit(Event{Type: "summon", Seat: seat, CardID: c.ID, Num: publicNum(c), X: at.X, Y: at.Y})
	g.enterTile(c)
	return c
}

// massRevive is Hourglass of Life: the strongest monsters in every graveyard
// come back under the seat's control, as many as fit, up to count.
func (g *Game) massRevive(owner *Seat, count int) {
	type grave struct{ seat, num, atk int }
	var all []grave
	for _, s := range g.Seats {
		for _, num := range s.Graveyard {
			if def := g.Cat.Card(num); def != nil && def.IsMonster() {
				all = append(all, grave{s.Index, num, def.Atk})
			}
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].atk > all[j].atk })
	for i := 0; i < len(all) && i < count; i++ {
		if g.summonNear(owner.Index, all[i].num, false, Pos{999, 999}) == nil {
			return
		}
		g.takeFromGraveyard(all[i].seat, all[i].num)
		owner.Stats.Revives++
	}
}

// caratPull is Carat Idol: every card is drawn one square towards it.
func (g *Game) caratPull(idol *Card) {
	sign := func(v int) int {
		if v > 0 {
			return 1
		}
		if v < 0 {
			return -1
		}
		return 0
	}
	cards := g.cardsOf(idol, "", nil)
	sort.SliceStable(cards, func(i, j int) bool { return cards[i].Pos.Steps(idol.Pos) < cards[j].Pos.Steps(idol.Pos) })
	for _, m := range cards {
		dx, dy := idol.Pos.X-m.Pos.X, idol.Pos.Y-m.Pos.Y
		step := Pos{sign(dx), 0}
		if abs(dy) > abs(dx) {
			step = Pos{0, sign(dy)}
		}
		to := m.Pos.Add(step.X, step.Y)
		if !m.OnBoard || to == m.Pos || to == idol.Pos || g.Board[to] != nil || g.leaderAt(to) != nil || !g.InBounds(to) {
			continue
		}
		g.place(m, to)
		g.emit(Event{Type: "move", Seat: m.Owner, CardID: m.ID, X: to.X, Y: to.Y})
		g.enterTile(m)
	}
}

// graveOptions lists cards lying in graveyards that keep accepts, newest first.
func (g *Game) graveOptions(keep func(seat int, def *CardDef) bool) []Choice {
	var out []Choice
	for _, s := range g.Seats {
		for i := len(s.Graveyard) - 1; i >= 0 && len(out) < 24; i-- {
			def := g.Cat.Card(s.Graveyard[i])
			if def != nil && keep(s.Index, def) {
				label := def.Name
				if def.IsMonster() {
					label = fmt.Sprintf("%s (%d/%d)", def.Name, def.Atk, def.Def)
				}
				out = append(out, Choice{
					Label: label, Num: cardNum(def.Num), seat: s.Index, index: i,
					From: cardNum(s.Index), Slot: cardNum(i),
				})
			}
		}
	}
	return out
}
