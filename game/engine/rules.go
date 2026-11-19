package engine

// Apply runs one action for a seat. On a RuleError nothing has changed. Every
// handler validates fully before it mutates, which is what keeps that promise.
func (g *Game) Apply(seat int, a Action) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return RuleError("You are not in this duel")
	}

	// Conceding is the one thing a player may do out of turn.
	if a.Type == ActConcede {
		s.LP = 0
		s.Conceded = true
		g.emit(Event{Type: "concede", Seat: seat})
		g.settle()
		return nil
	}

	if g.Pending != nil {
		if g.Pending.Seat != seat {
			return RuleError("Waiting for another player to choose")
		}
		if a.Type != ActChoose {
			return RuleError("Make your selection first")
		}
		if a.Choice < 0 || a.Choice >= len(g.Pending.Options) {
			return RuleError("That is not one of the options")
		}
		g.resolveChoice(a.Choice)
		g.settle()
		return nil
	}

	if seat != g.Turn {
		return RuleError("It is not your turn")
	}

	var err error
	switch a.Type {
	case ActSummon:
		err = g.actSummon(s, a)
	case ActMove:
		err = g.actMove(s, a)
	case ActFlip:
		err = g.actFlip(s, a)
	case ActPosition:
		err = g.actPosition(s, a)
	case ActLeader:
		err = g.actLeader(s, a)
	case ActDiscard:
		err = g.actDiscard(s, a)
	case ActEndTurn:
		g.endTurn()
	case ActChoose:
		err = RuleError("There is nothing to choose")
	default:
		err = RuleError("Unknown action")
	}
	if err != nil {
		return err
	}
	g.settle()
	return nil
}

// ownCard finds a card on the board that the seat may give an order to.
func (g *Game) ownCard(s *Seat, id int) (*Card, error) {
	c := g.Cards[id]
	if c == nil || !c.OnBoard {
		return nil, RuleError("That card is not on the field")
	}
	if c.Owner != s.Index {
		return nil, RuleError("That card is not yours")
	}
	if c.Acted {
		return nil, RuleError("That card has already acted this turn")
	}
	if g.bound(c) {
		return nil, RuleError("That card is spellbound")
	}
	return c, nil
}

// --- summoning -----------------------------------------------------------

// SummonTiles are the squares around a leader a card can be played onto.
func (g *Game) SummonTiles(s *Seat) []Pos {
	var out []Pos
	for dx := -1; dx <= 1; dx++ {
		for dy := -1; dy <= 1; dy++ {
			p := s.Leader.Add(dx, dy)
			if (dx == 0 && dy == 0) || !g.InBounds(p) || g.Tiles[p] == TerrainLabyrinth {
				continue
			}
			if g.leaderAt(p) != nil {
				continue
			}
			// Another seat's square only when it is an ally's monster, which
			// can be given power-ups from the hand.
			if occ := g.Board[p]; occ != nil && occ.Owner != s.Index && !(occ.Def.IsMonster() && g.sameTeam(occ.Owner, s.Index)) {
				continue
			}
			out = append(out, p)
		}
	}
	return out
}

// combineKind says how two of a player's cards merge: "" means they cannot.
// A recipe comes first: a few spells (Metalmorph, Cocoon of Evolution...)
// fuse with particular monsters instead of acting as spells.
func (g *Game) combineKind(base, add *CardDef) string {
	if g.Cat.Fuse(base, add) != nil {
		return "fuse"
	}
	switch {
	case base.IsMonster() && add.IsMonster():
		return "fuse"
	case base.IsMonster() && powerUpCard(add):
		return "equip"
	case add.IsMonster() && powerUpCard(base):
		return "equip"
	}
	return ""
}

// allyMerge says whether add can be merged into base, a monster a teammate
// controls: a power-up it takes, or a real fusion recipe (which makes a
// shared monster). Two monsters with no recipe never knock out an ally's.
func (g *Game) allyMerge(base, add *CardDef) bool {
	if !base.IsMonster() {
		return false
	}
	if g.Cat.Fuse(base, add) != nil {
		return true
	}
	return powerUpCard(add) && g.combineKind(base, add) == "equip"
}

// allyChain checks cards merged one by one onto an ally's monster: every
// step that reaches the ally's card must be one allyMerge allows. Once they
// have fused, the result is no longer only the ally's.
func (g *Game) allyChain(base *CardDef, cards []*Card) bool {
	running := base
	for _, c := range cards {
		if !g.allyMerge(running, c.Def) {
			return false
		}
		if fused := g.Cat.Fuse(running, c.Def); fused != nil {
			return true
		}
	}
	return true
}

// powerUpCard is a spell used by merging it into a monster: an equip, or
// Insect Imitation.
func powerUpCard(d *CardDef) bool {
	return !d.IsMonster() && d.Effect != nil && (d.Effect.Op == "equip" || d.Effect.Op == "imitation")
}

// powerUpFitsDef is whether a power-up does anything for a monster.
func powerUpFitsDef(equip, monster *CardDef) bool {
	if equip.Effect.Op == "imitation" {
		for _, e := range monster.Abilities {
			if e.Op == "imitate" {
				return true
			}
		}
		return false
	}
	return matches(equip.Effect, monster)
}

func (g *Game) actSummon(s *Seat, a Action) error {
	ids := a.CardIDs
	if len(ids) == 0 && a.CardID != 0 {
		ids = []int{a.CardID}
	}
	if len(ids) == 0 {
		return RuleError("Pick a card to play")
	}
	if s.PlaysLeft <= 0 && !g.Unlimited {
		return RuleError("You have already played a card this turn")
	}

	var cards []*Card
	seen := map[int]bool{}
	for _, id := range ids {
		c := s.handCard(id)
		if c == nil || seen[id] {
			return RuleError("That card is not in your hand")
		}
		seen[id] = true
		cards = append(cards, c)
	}
	target := Pos{a.X, a.Y}
	legal := false
	for _, p := range g.SummonTiles(s) {
		if p == target {
			legal = true
		}
	}
	if !legal {
		return RuleError("You can only play a card next to your deck leader")
	}

	// The marked cards merge among themselves first, then with whatever of
	// the player's is on the square. When they cannot stand on their own (two
	// fusion or equip spells, say) but the card on the square can take them
	// one by one, they are added to it in the order marked instead.
	occupant := g.Board[target]
	// An ally's monster only takes power-ups and real fusions.
	ally := occupant != nil && occupant.Owner != s.Index
	running, cost, ok := g.mergePlan(nil, cards)
	ontoOccupant := false
	if ok && occupant != nil && (g.combineKind(occupant.Def, running) == "" || (ally && !g.allyMerge(occupant.Def, running))) {
		ok = false
	}
	if !ok && occupant != nil {
		running, cost, ok = g.mergePlan(occupant.Def, cards)
		ontoOccupant = ok
		if ok && ally && !g.allyChain(occupant.Def, cards) {
			ok = false
		}
	}
	if !ok && ally {
		return RuleError("Only a fusion or a power-up can be played onto an ally's monster")
	}
	if !ok {
		return RuleError("Those cards cannot be combined")
	}
	if cost > s.Stars && !g.Unlimited {
		return RuleError("Not enough summoning power")
	}
	// A card with no room on the field may still be played: it lands, and is
	// destroyed on the spot (see overflow). The play and its stars are spent.
	overflow := g.roomFor(s.Index, running.IsMonster(), occupant) != nil

	// --- validated, now commit ---
	if !g.Unlimited {
		s.Stars -= cost
		s.PlaysLeft--
	}
	for _, c := range cards {
		s.removeFromHand(c)
	}

	// Record the merges, so the client can play them back.
	var steps []ChainStep
	g.chain = &steps
	var result *Card
	if ontoOccupant {
		result = occupant
		for _, next := range cards {
			result = g.combine(result, next)
		}
	} else {
		result = cards[0]
		for _, next := range cards[1:] {
			result = g.combine(result, next)
		}
		if occupant != nil {
			result = g.combine(occupant, result)
		}
	}
	g.chain = nil
	if len(steps) > 0 {
		g.emit(Event{Type: "fusionChain", Seat: s.Index, X: target.X, Y: target.Y, Steps: steps})
	}
	if result != nil && result.Owner != s.Index {
		// Power-ups given to an ally's monster: it stays where it is, theirs.
		g.place(result, target)
		return nil
	}
	if result != nil && overflow {
		g.place(result, target)
		g.emit(Event{Type: "summon", Seat: s.Index, CardID: result.ID, X: target.X, Y: target.Y, Num: publicNum(result)})
		// Shown to everyone as it goes, the way a crushed monster is.
		result.FaceDown = false
		g.bury(result, "overflow", noOne)
		return nil
	}
	if result != nil {
		g.place(result, target)
		s.LastPlayed = result.ID
		s.Stats.Summons++
		g.emit(Event{Type: "summon", Seat: s.Index, CardID: result.ID, X: target.X, Y: target.Y, Num: publicNum(result)})
		g.enterTile(result)
	}
	return nil
}

// mergePlan works out what cards become when merged in order, onto base when
// it is given (a card already on the field), and what reaching the field
// costs. Each card must be able to merge with what the ones before it became,
// which is a monster as soon as one is involved. Two monsters with no recipe
// do not fuse: the newer one knocks the older into the graveyard. Only what
// reaches the field is paid for, so a knocked-out card (and whatever was
// merged into it) costs nothing, and base was paid for when it was played.
func (g *Game) mergePlan(base *CardDef, cards []*Card) (*CardDef, int, bool) {
	level := func(d *CardDef) int {
		if d.IsMonster() {
			return d.Level
		}
		return 0
	}
	running, cost, rest := base, 0, cards
	if running == nil {
		running, cost, rest = cards[0].Def, level(cards[0].Def), cards[1:]
	}
	for _, next := range rest {
		switch g.combineKind(running, next.Def) {
		case "":
			return nil, 0, false
		case "fuse":
			if fused := g.Cat.Fuse(running, next.Def); fused != nil {
				running, cost = fused, cost+level(next.Def)
			} else {
				running, cost = next.Def, level(next.Def)
			}
		case "equip":
			cost += level(next.Def)
			if !running.IsMonster() {
				running = next.Def
			}
		}
	}
	return running, cost, true
}

// roomFor checks the field limits for a card arriving on a square: a monster
// landing on an empty square or on a power-up adds a monster, a spell landing
// on an empty square adds a spell, and merging into a monster adds nothing.
func (g *Game) roomFor(seat int, monster bool, occupant *Card) error {
	if g.Unlimited {
		return nil
	}
	switch {
	case monster && (occupant == nil || !occupant.Def.IsMonster()):
		if g.monstersFull(seat) {
			return g.monsterLimit(seat)
		}
	case !monster && occupant == nil:
		if g.countOnBoard(seat, false) >= g.Cfg.MaxSpells {
			return RuleError("You already have 5 spell and trap cards on the field")
		}
	}
	return nil
}

func publicNum(c *Card) *int {
	if c.FaceDown {
		return nil
	}
	return cardNum(c.Def.Num)
}

// combine merges add into base and returns the card that remains. Either card
// may be in a hand or on the board; the survivor keeps base's square.
func (g *Game) combine(base, add *Card) *Card {
	at := base.Pos
	onBoard := base.OnBoard
	// A face-up card on the board is public: opponents may see it in the chain.
	baseOpen := onBoard && !base.FaceDown
	record := func(kind string, result *Card, amount int) {
		if g.chain != nil {
			// A power-up into that face-up monster, which stays as it is, hides nothing.
			open := baseOpen && kind == "equip" && result == base && !result.FaceDown
			*g.chain = append(*g.chain, ChainStep{Base: base.Def.Num, Add: add.Def.Num, Result: result.Def.Num, Kind: kind, Amount: amount, Board: onBoard, baseOpen: baseOpen, open: open})
		}
	}

	switch g.combineKind(base.Def, add.Def) {
	case "equip":
		monster, equip := base, add
		if !base.Def.IsMonster() {
			monster, equip = add, base
		}
		amount := 0
		e := equip.Def.Effect
		switch {
		case e.Op == "imitation":
			if g.imitate(monster) {
				g.Seats[equip.Owner].Stats.Equips++
			}
		case matches(e, monster.Def):
			amount = e.Amount
			if amount > 0 {
				// Maha Vailo: power-ups give more.
				for _, a := range g.auras("equipPlus") {
					amount += a.e.Amount
				}
			}
			amount, _ = g.powerUp(monster, amount, amount, monster.Owner)
			monster.Granted = append(monster.Granted, e.Grant...)
			g.Seats[equip.Owner].Stats.Equips++
			g.emit(Event{Type: "equip", Seat: equip.Owner, CardID: monster.ID, Num: cardNum(equip.Def.Num), Amount: amount, X: at.X, Y: at.Y})
		}
		record("equip", monster, amount)
		g.bury(equip, "used", noOne)
		if onBoard && !monster.OnBoard {
			g.place(monster, at)
		}
		return monster

	case "fuse":
		if fused := g.Cat.Fuse(base.Def, add.Def); fused != nil {
			result := &Card{ID: g.nextID, Def: fused, Owner: add.Owner, Home: add.Home, Pos: at}
			// Two teammates' monsters fused belong to both of them.
			result.Shared = base.Shared || add.Shared || base.Owner != add.Owner
			g.nextID++
			g.Cards[result.ID] = result
			result.Acted = add.Acted
			record("fuse", result, 0)
			g.bury(base, "fusion", noOne)
			g.bury(add, "fusion", noOne)
			g.Seats[result.Owner].Stats.Fusions++
			if onBoard {
				g.place(result, at)
			}
			g.emit(Event{Type: "fusion", Seat: result.Owner, CardID: result.ID, Num: cardNum(fused.Num), X: at.X, Y: at.Y})
			return result
		}
	}

	// No recipe: the newer card simply replaces the older one.
	record("bonk", add, 0)
	g.bury(base, "replaced", noOne)
	if onBoard {
		g.place(add, at)
	}
	return add
}

// --- movement and battle -------------------------------------------------

// reach is how far a card may travel this turn.
func (g *Game) reach(c *Card) int {
	if c.Def.Kind == KindTrap && !c.FaceDown {
		return 0 // a trap stays put once it is face up (sprung, or revealed)
	}
	if !c.Def.IsMonster() {
		return 1
	}
	if c.has("immobile") != nil {
		return 0
	}
	// Serpent Marauder cancels every extra square of movement.
	if c.FaceDown || g.anyAura("noMoveBonus") {
		return 1
	}
	if c.Def.bonus(g.Tiles[c.Pos]) > 0 || g.ability(c, "fastMove") != nil {
		return 2
	}
	for _, a := range g.auras("auraMove") {
		if g.sideOK(a.e.Side, a.src.Owner, c.Owner) && matches(a.e, c.Def) {
			return 2
		}
	}
	return 1
}

// entersLabyrinth says whether a monster may step onto labyrinth squares.
func (g *Game) entersLabyrinth(c *Card) bool {
	return g.breaksLabyrinth(c) || g.ability(c, "enterLabyrinth") != nil
}

// canEnter decides whether c may finish a move on p (an attack counts).
func (g *Game) canEnter(c *Card, p Pos) bool {
	if !g.InBounds(p) {
		return false
	}
	if leader := g.leaderAt(p); leader != nil {
		// Only monsters attack, and only the other team's leader.
		return c.Def.IsMonster() && !g.sameTeam(leader.Index, c.Owner)
	}
	occ := g.Board[p]
	if occ == nil {
		return g.Tiles[p] != TerrainLabyrinth || g.entersLabyrinth(c)
	}
	if occ.Owner == c.Owner {
		return g.combineKind(occ.Def, c.Def) != ""
	}
	if g.sameTeam(occ.Owner, c.Owner) {
		// A teammate's monster takes power-ups and fusions. (A fusion takes
		// the place of their monster, so the team has no more than before.)
		return g.allyMerge(occ.Def, c.Def)
	}
	return c.Def.IsMonster()
}

// MoveTargets maps every square a card can move to (or attack) this turn to
// the square it steps off from, which is where it stays if the attack fails.
func (g *Game) MoveTargets(c *Card) map[Pos]Pos {
	out := map[Pos]Pos{}
	if !c.OnBoard || c.Acted || g.bound(c) {
		return out
	}
	frontier := []Pos{c.Pos}
	for step := 0; step < g.reach(c); step++ {
		var next []Pos
		for _, from := range frontier {
			for _, d := range orthogonal {
				p := from.Add(d.X, d.Y)
				if p == c.Pos || !g.canEnter(c, p) {
					continue
				}
				if _, seen := out[p]; seen {
					continue
				}
				out[p] = from
				// Only an empty square can be walked through.
				if g.Board[p] == nil && g.leaderAt(p) == nil {
					next = append(next, p)
				}
			}
		}
		frontier = next
	}
	return out
}

// castsOnMove is a spell that is cast by moving it (face up, or flipped as
// it moves), as opposed to a power-up, whose use is moving onto a monster.
func castsOnMove(c *Card) bool {
	return c.Def.Kind == KindSpell && !(c.Def.Effect != nil && (powerUpCard(c.Def) || c.Def.Effect.Op == "morph"))
}

func (g *Game) actMove(s *Seat, a Action) error {
	c, err := g.ownCard(s, a.CardID)
	if err != nil {
		return err
	}
	target := Pos{a.X, a.Y}
	// A spell is cast where it lands when it is flipped as part of its move,
	// or when it is already face up: revealing a spell (Dark-Piercing Light)
	// does not cast it, moving it afterwards does. Checked up front so a
	// spell that cannot be cast does not move either. (An equip spell is
	// never cast: moving it onto a monster is its use.)
	castOnLanding := castsOnMove(c) && (a.Flip || !c.FaceDown)
	if castOnLanding {
		if err := g.canActivate(c); err != nil {
			return err
		}
	}
	// Flipping face up first can change how far the card reaches, so the
	// targets are worked out as they will be at the moment of the move.
	wasDown := c.FaceDown
	if a.Flip && c.Def.IsMonster() {
		c.FaceDown = false
	}
	from, ok := g.MoveTargets(c)[target]
	if !ok {
		c.FaceDown = wasDown
		return RuleError("That card cannot move there")
	}
	// A monster never moves in defense position: moving takes it into attack.
	if c.Def.IsMonster() && c.Defense {
		c.Defense = false
		g.emit(Event{Type: "position", Seat: s.Index, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y})
	}

	start := c.Pos
	if wasDown && !c.FaceDown {
		c.FaceDown = true
		c.SelfFlipped = true
		g.reveal(c)
		if !c.OnBoard || c.Pos != start || c.Owner != s.Index {
			return nil // its own flip took it away (Leghul, Hane-Hane...)
		}
	}
	c.Acted = true
	spaces := 1
	if from != c.Pos {
		spaces = 2
	}
	defer func() {
		if c.OnBoard {
			g.moved(c, spaces)
		}
	}()
	if from != c.Pos {
		g.step(c, from)
		if !c.OnBoard || g.bound(c) {
			return nil // stopped on the way (crush terrain or a trap)
		}
	}

	if leader := g.leaderAt(target); leader != nil {
		g.attackLeader(c, leader)
		return nil
	}
	occ := g.Board[target]
	switch {
	case occ == nil:
		g.step(c, target)
		if castOnLanding && c.OnBoard && c.Def.Kind == KindSpell {
			g.reveal(c) // nothing to do if it was face up already
			g.activate(c)
		}
	case g.sameTeam(occ.Owner, c.Owner): // own card, or a power-up for an ally's monster
		origin := c.Pos
		delete(g.Board, origin)
		c.OnBoard = false
		result := g.combine(occ, c)
		g.emit(Event{Type: "move", Seat: s.Index, CardID: result.ID, X: target.X, Y: target.Y})
		g.enterTile(result)
	case occ.Def.IsMonster():
		g.battle(c, occ)
	default:
		g.attackSpell(c, occ)
	}
	return nil
}

// step walks a card onto an empty square and applies what the square does.
func (g *Game) step(c *Card, to Pos) {
	g.place(c, to)
	// Dokurorider leaves wasteland behind it.
	if e := g.ability(c, "moveTerrain"); e != nil && e.On == "move" && g.Tiles[to] != TerrainLabyrinth && ValidTerrain(e.Terrain) {
		g.Tiles[to] = e.Terrain
		g.emit(Event{Type: "terrain", Seat: c.Owner, X: to.X, Y: to.Y, Text: e.Terrain})
	}
	g.emit(Event{Type: "move", Seat: c.Owner, CardID: c.ID, X: to.X, Y: to.Y})
	g.enterTile(c)
	if c.OnBoard && c.Def.IsMonster() {
		g.springMoveTraps(c)
	}
}

// enterTile applies terrain that acts on arrival, and what the arriving card
// does to the terrain.
func (g *Game) enterTile(c *Card) {
	// Shadow Ghoul becomes Wall Shadow inside the labyrinth.
	if e := g.ability(c, "enterLabyrinth"); e != nil && e.Summon != nil && g.Tiles[c.Pos] == TerrainLabyrinth {
		g.transformInto(c, *e.Summon)
	}
	g.clearLabyrinth(c)
	g.crush(c, noOne)
}

// crush destroys a strong monster standing on crush terrain. by is whoever
// put the terrain under an enemy (a field spell), noOne when the monster
// walked onto it.
func (g *Game) crush(c *Card, by int) {
	if !c.OnBoard || !c.Def.IsMonster() {
		return
	}
	if g.Tiles[c.Pos] == TerrainCrush && c.Def.Type != "immortal" && c.Def.Atk >= 1500 {
		c.FaceDown = false
		g.bury(c, "crushed", by)
	}
}

func (g *Game) reveal(c *Card) {
	if c.FaceDown {
		c.FaceDown = false
		g.emit(Event{Type: "reveal", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), X: c.Pos.X, Y: c.Pos.Y})
		g.flipped(c)
	}
}

func (g *Game) attackLeader(c *Card, leader *Seat) {
	from := c.Pos
	g.reveal(c)
	if !c.OnBoard || c.Pos != from || g.bound(c) || g.sameTeam(c.Owner, leader.Index) {
		return
	}
	c.Defense = false
	if g.springAttackTraps(c, leader.Index) {
		return
	}
	amount := g.atk(c, g.Tiles[c.Pos])
	if g.ability(c, "shapesnatch") != nil && leader.LeaderDef != nil {
		amount = leader.LeaderDef.Atk
	}
	st := &g.Seats[c.Owner].Stats
	st.Attacks++
	st.DirectAttacks++
	g.emit(Event{Type: "attack", Seat: c.Owner, CardID: c.ID, Num: cardNum(c.Def.Num), Target: -1, X: leader.Leader.X, Y: leader.Leader.Y, Amount: amount})
	g.damage(leader.Index, amount, "direct attack", c.Owner)
}

func (g *Game) battle(att, def *Card) {
	target, from := def.Pos, att.Pos
	// A battle only goes ahead while both monsters are still where they were,
	// on opposite sides, and the attacker is free: a monster's flip can
	// teleport, spellbind, destroy or take over the other one.
	engaged := func() bool {
		return att.OnBoard && def.OnBoard && att.Pos == from && def.Pos == target &&
			!g.sameTeam(att.Owner, def.Owner) && !g.bound(att)
	}
	g.revealIn(att, def)
	if !engaged() {
		return
	}
	att.Defense = false
	if g.springAttackTraps(att, def.Owner) {
		return
	}
	g.revealIn(def, att)
	if !engaged() {
		return
	}
	g.engage(att, def)
	g.engage(def, att)
	if !engaged() {
		return
	}

	// The fight happens on the defender's square, so its terrain counts for both.
	terrain := g.Tiles[target]
	attSwing, defSwing := g.whimSwing(att), g.whimSwing(def)
	power := g.fight(att, def, terrain, false, attSwing)
	g.Seats[att.Owner].Stats.Attacks++
	g.emit(Event{Type: "attack", Seat: att.Owner, CardID: att.ID, Num: cardNum(att.Def.Num), Target: def.ID, X: target.X, Y: target.Y, Amount: power})

	// Battle damage skips a player whose monster in this fight shields it.
	hurt := func(seat, amount int, by int) {
		for _, m := range []*Card{att, def} {
			if m.Owner == seat && !m.FaceDown && m.has("noBattleDamage") != nil {
				return
			}
		}
		g.damage(seat, amount, "battle", by)
	}
	// A monster that beats one with "banish" is gone for good. One holding an
	// absorbed monster (Relinquished) loses that instead, and stays.
	fall := func(loser, winner *Card) bool {
		if g.shieldWith(loser, winner) {
			return false
		}
		reason := "battle"
		if g.ability(winner, "banish") != nil {
			reason = "banished"
		}
		g.bury(loser, reason, winner.Owner)
		return true
	}

	defenderFell, attackerFell := false, false
	switch {
	case g.ability(att, "autoDestroy") != nil && matches(att.has("autoDestroy"), def.Def):
		defenderFell = fall(def, att)
	case g.ability(def, "autoDestroy") != nil && matches(def.has("autoDestroy"), att.Def):
		if attackerFell = fall(att, def); attackerFell {
			g.Seats[def.Owner].Stats.BattlesWon++
		}
	case def.Defense:
		guard := g.fight(def, att, terrain, true, defSwing)
		switch {
		case power > guard:
			defenderFell = fall(def, att)
		case power < guard:
			hurt(att.Owner, guard-power, def.Owner)
		}
	default:
		other := g.fight(def, att, terrain, false, defSwing)
		switch {
		case power > other:
			hurt(def.Owner, power-other, att.Owner)
			defenderFell = fall(def, att)
		case power < other:
			hurt(att.Owner, other-power, def.Owner)
			if attackerFell = fall(att, def); attackerFell {
				g.Seats[def.Owner].Stats.BattlesWon++
			}
		default:
			attackerFell = fall(att, def)
			defenderFell = fall(def, att)
		}
	}

	if defenderFell {
		g.Seats[att.Owner].Stats.BattlesWon++
	}
	// The winner takes the square, except that nothing stays on a labyrinth.
	if defenderFell && att.OnBoard && g.Tiles[target] != TerrainLabyrinth && g.Board[target] == nil {
		g.place(att, target)
		g.emit(Event{Type: "move", Seat: att.Owner, CardID: att.ID, X: target.X, Y: target.Y})
		g.enterTile(att)
	}
	// What a monster does when destroyed happens once the dust has settled,
	// so a winner that moved onto its square is caught too.
	if defenderFell {
		g.destroyedInBattle(def, att)
	}
	if attackerFell {
		g.destroyedInBattle(att, def)
	}
}

// attackSpell is a monster walking onto an enemy spell or trap. Walking onto
// a trap that answers attacks (Negate Attack, Mirror Force, Mirror Wall) is
// an attack on it: the defending team's attack traps go off first, and the
// trap is only trampled if the attack goes ahead.
func (g *Game) attackSpell(att, spell *Card) {
	from := att.Pos
	g.reveal(att)
	if !att.OnBoard || att.Pos != from || g.bound(att) {
		return // its own flip took it away
	}
	target := spell.Pos
	if isAttackTrap(spell) {
		att.Defense = false
		if g.springAttackTraps(att, spell.Owner) || !att.OnBoard || g.bound(att) {
			return
		}
	}
	sprung := false
	if !spell.OnBoard {
		// Gone already (a disposable attack trap that went off): nothing to trample.
	} else if spell.FaceDown && spell.Def.Kind == KindTrap && trapFires(spell, att, g) {
		sprung = true
		g.fireMoveTrap(spell, att)
	} else {
		g.bury(spell, "trampled", att.Owner)
	}
	if att.OnBoard && !g.bound(att) && g.Board[target] == nil && g.Tiles[target] != TerrainLabyrinth {
		g.place(att, target)
		g.emit(Event{Type: "move", Seat: att.Owner, CardID: att.ID, X: target.X, Y: target.Y})
		g.enterTile(att)
		if !sprung && att.OnBoard {
			g.springMoveTraps(att)
		}
	}
}

// --- other orders --------------------------------------------------------

func (g *Game) actFlip(s *Seat, a Action) error {
	c, err := g.ownCard(s, a.CardID)
	if err != nil {
		return err
	}
	if !c.FaceDown {
		return RuleError("That card is already face up")
	}
	switch c.Def.Kind {
	case KindMonster:
		// Turning a monster face up is free: it may still move or change position.
		c.SelfFlipped = true
		g.reveal(c)
	case KindTrap:
		return RuleError("Traps spring on their own")
	default:
		if err := g.canActivate(c); err != nil {
			return err
		}
		c.Acted = true
		g.reveal(c)
		g.activate(c)
	}
	return nil
}

func (g *Game) actPosition(s *Seat, a Action) error {
	c, err := g.ownCard(s, a.CardID)
	if err != nil {
		return err
	}
	if !c.Def.IsMonster() {
		return RuleError("Only monsters change battle position")
	}
	if c.Defense == a.Defense {
		return RuleError("The card is already in that position")
	}
	c.Defense = a.Defense
	// Going into defense is the card's order for the turn; going into attack
	// leaves it free to move.
	c.Acted = a.Defense
	// A face-down monster may turn face up as part of the same order.
	if a.Flip && c.FaceDown {
		c.SelfFlipped = true
		g.reveal(c)
	}
	g.emit(Event{Type: "position", Seat: s.Index, CardID: c.ID, X: c.Pos.X, Y: c.Pos.Y})
	if c.OnBoard && c.Defense {
		g.springPositionTraps(c)
	}
	return nil
}

// LeaderTargets are the squares a seat's leader can step to: empty ones, and
// ones holding a card of its own, which the leader eats (destroys) on arrival.
func (g *Game) LeaderTargets(s *Seat) []Pos {
	var out []Pos
	if s.LeaderActed {
		return out
	}
	for _, d := range orthogonal {
		p := s.Leader.Add(d.X, d.Y)
		if g.InBounds(p) && g.Tiles[p] != TerrainLabyrinth && g.leaderAt(p) == nil && (g.Board[p] == nil || g.edible(s, g.Board[p])) {
			out = append(out, p)
		}
	}
	return out
}

// edible is true for a card a seat's leader may run over: one of its own,
// never a card only borrowed from someone else.
func (g *Game) edible(s *Seat, c *Card) bool {
	return c.Owner == s.Index && c.Home == s.Index && !c.Borrowed
}

func (g *Game) actLeader(s *Seat, a Action) error {
	target := Pos{a.X, a.Y}
	for _, p := range g.LeaderTargets(s) {
		if p == target {
			if c := g.Board[target]; c != nil {
				g.bury(c, "eaten", noOne)
			}
			s.Leader = target
			s.LeaderActed = true
			g.emit(Event{Type: "leader", Seat: s.Index, X: target.X, Y: target.Y})
			return nil
		}
	}
	if s.LeaderActed {
		return RuleError("Your deck leader has already moved this turn")
	}
	return RuleError("Your deck leader cannot move there")
}

func (g *Game) actDiscard(s *Seat, a Action) error {
	ids := a.CardIDs
	if len(ids) == 0 && a.CardID != 0 {
		ids = []int{a.CardID}
	}
	if len(ids) == 0 {
		return RuleError("Pick a card to discard")
	}
	seen := map[int]bool{}
	for _, id := range ids {
		if s.handCard(id) == nil || seen[id] {
			return RuleError("That card is not in your hand")
		}
		seen[id] = true
	}
	for _, id := range ids {
		c := s.handCard(id)
		s.removeFromHand(c)
		c.Pos = s.Leader
		g.bury(c, "discarded", noOne)
	}
	return nil
}
