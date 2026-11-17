package engine

import (
	"math/rand"
	"slices"
	"sort"
	"testing"
)

// A small made-up card set: the rules are tested without any real card data.
type testCatalog map[int]*CardDef

func (c testCatalog) Card(num int) *CardDef { return c[num] }

func (c testCatalog) Fuse(a, b *CardDef) *CardDef {
	pair := func(x, y int) bool { return (a.Num == x && b.Num == y) || (a.Num == y && b.Num == x) }
	switch {
	case pair(1, 2), pair(1, 60):
		return c[9]
	case pair(9, 61):
		return c[3]
	}
	return nil
}

var cat = testCatalog{
	1:  {Num: 1, Name: "Grunt", Kind: KindMonster, Type: "warrior", Attribute: "earth", Level: 3, Atk: 1200, Def: 1000},
	2:  {Num: 2, Name: "Drake", Kind: KindMonster, Type: "dragon", Attribute: "wind", Level: 4, Atk: 1600, Def: 1400},
	3:  {Num: 3, Name: "Titan", Kind: KindMonster, Type: "rock", Attribute: "earth", Level: 8, Atk: 3000, Def: 2500},
	4:  {Num: 4, Name: "Wall", Kind: KindMonster, Type: "rock", Attribute: "earth", Level: 2, Atk: 300, Def: 2000},
	5:  {Num: 5, Name: "Tenderness", Kind: KindMonster, Type: "fairy", Attribute: "light", Level: 3, Atk: 700, Def: 1400, Effect: &Effect{Op: "halveDamage"}},
	9:  {Num: 9, Name: "Drake Knight", Kind: KindMonster, Type: "dragon", Attribute: "wind", Level: 6, Atk: 2400, Def: 2000},
	20: {Num: 20, Name: "Medicine", Kind: KindSpell, Effect: &Effect{Op: "heal", Amount: 500}},
	21: {Num: 21, Name: "Fire", Kind: KindSpell, Effect: &Effect{Op: "burn", Amount: 1000}},
	22: {Num: 22, Name: "Sword", Kind: KindSpell, Effect: &Effect{Op: "equip", Amount: 500, Types: []string{"warrior"}}},
	23: {Num: 23, Name: "Reborn", Kind: KindSpell, Effect: &Effect{Op: "revive"}},
	24: {Num: 24, Name: "Lightning", Kind: KindSpell, Effect: &Effect{Op: "destroyCross"}},
	25: {Num: 25, Name: "Heart", Kind: KindSpell, Effect: &Effect{Op: "control"}},
	26: {Num: 26, Name: "Hole", Kind: KindSpell, Effect: &Effect{Op: "destroyAll"}},
	27: {Num: 27, Name: "Greed", Kind: KindSpell, Effect: &Effect{Op: "draw", Amount: 2}},
	6:  {Num: 6, Name: "Sphere", Kind: KindMonster, Type: "machine", Attribute: "dark", Level: 4, Atk: 1400, Def: 1400, Effect: &Effect{Op: "blastOnDestroy"}},
	7:  {Num: 7, Name: "Cannon", Kind: KindMonster, Type: "machine", Attribute: "dark", Level: 4, Atk: 1400, Def: 1300, Effect: &Effect{Op: "breakLabyrinth"}},
	8:  {Num: 8, Name: "King", Kind: KindMonster, Type: "machine", Attribute: "earth", Level: 6, Atk: 2200, Def: 2000, Effect: &Effect{Op: "flipBoostMachines", Amount: 100}},
	60: {Num: 60, Name: "Morph", Kind: KindSpell},
	61: {Num: 61, Name: "Ascend", Kind: KindSpell},
	54: {Num: 54, Name: "Right Leg", Kind: KindMonster, Type: "spellcaster", Level: 1, Atk: 200, Def: 300},
	55: {Num: 55, Name: "Left Leg", Kind: KindMonster, Type: "spellcaster", Level: 1, Atk: 200, Def: 300},
	56: {Num: 56, Name: "Right Arm", Kind: KindMonster, Type: "spellcaster", Level: 1, Atk: 200, Def: 300},
	57: {Num: 57, Name: "Left Arm", Kind: KindMonster, Type: "spellcaster", Level: 1, Atk: 200, Def: 300},
	58: {Num: 58, Name: "Exodia", Kind: KindMonster, Type: "spellcaster", Level: 3, Atk: 1000, Def: 1000, Leader: &LeaderAbility{Op: "assembleLimbs", Cards: []int{54, 55, 56, 57}}},
	29: {Num: 29, Name: "Fissure", Kind: KindSpell, Effect: &Effect{Op: "destroyWeakest"}},
	28: {Num: 28, Name: "Peak", Kind: KindSpell, Effect: &Effect{Op: "terrain", Terrain: TerrainMountain, Radius: 2}},
	30: {Num: 30, Name: "Pit", Kind: KindTrap, Effect: &Effect{Op: "trapDestroy", MaxAtk: 2000, Trigger: "move", Range: "limited"}},
	31: {Num: 31, Name: "Circle", Kind: KindTrap, Effect: &Effect{Op: "trapBind", Turns: 3, Amount: 600, Trigger: "move", Range: "limited"}},
	32: {Num: 32, Name: "Negate", Kind: KindTrap, Effect: &Effect{Op: "trapNegate", Trigger: "attack", Range: "full"}},
	33: {Num: 33, Name: "Jammer", Kind: KindTrap, Effect: &Effect{Op: "trapJam", Trigger: "spell", Range: "full"}},
	34: {Num: 34, Name: "Piercing Light", Kind: KindSpell, Effect: &Effect{Op: "revealEnemy"}},
}

func deckOf(nums ...int) []int {
	var deck []int
	for len(deck) < 40 {
		deck = append(deck, nums...)
	}
	return deck[:40]
}

func duel(t *testing.T, deck ...int) *Game {
	t.Helper()
	if len(deck) == 0 {
		deck = []int{1, 2}
	}
	return New(DefaultConfig(7), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(deck...)}, {Team: 1, Deck: deckOf(deck...)}}, 1)
}

// put drops a card straight onto the board, bypassing the hand.
func put(g *Game, num, seat, x, y int, faceDown bool) *Card {
	c := g.newCard(num, seat)
	c.FaceDown = faceDown
	g.place(c, Pos{x, y})
	return c
}

func must(t *testing.T, g *Game, seat int, a Action) {
	t.Helper()
	if err := g.Apply(seat, a); err != nil {
		t.Fatalf("%+v rejected: %v", a, err)
	}
}

func refuse(t *testing.T, g *Game, seat int, a Action) {
	t.Helper()
	if err := g.Apply(seat, a); err == nil {
		t.Fatalf("%+v should have been rejected", a)
	}
}

func TestOpeningState(t *testing.T) {
	g := duel(t)
	for _, s := range g.Seats {
		if s.LP != 4000 || s.Stars != 4 {
			t.Fatalf("seat %d starts with %d LP and %d stars", s.Index, s.LP, s.Stars)
		}
	}
	if len(g.Seats[0].Hand) != 5 || len(g.Seats[1].Hand) != 0 {
		t.Fatal("only the seat to move has drawn")
	}
	if g.Seats[0].Leader != (Pos{0, -3}) || g.Seats[1].Leader != (Pos{0, 3}) {
		t.Fatal("leaders start in the middle of their edges")
	}
}

func TestStarsAccumulateAndCap(t *testing.T) {
	g := duel(t)
	want := []int{4, 7, 10, 12, 12}
	for round, stars := range want {
		if g.Seats[0].Stars != stars {
			t.Fatalf("round %d: %d stars, want %d", round, g.Seats[0].Stars, stars)
		}
		must(t, g, 0, Action{Type: ActEndTurn})
		must(t, g, 1, Action{Type: ActEndTurn})
	}
}

func TestSummonCostsStarsAndIsOncePerTurn(t *testing.T) {
	g := duel(t, 1, 3)
	s := g.Seats[0]
	var grunt, titan *Card
	for _, c := range s.Hand {
		if c.Def.Num == 1 && grunt == nil {
			grunt = c
		}
		if c.Def.Num == 3 {
			titan = c
		}
	}
	refuse(t, g, 0, Action{Type: ActSummon, CardID: titan.ID, X: 0, Y: -2}) // level 8, 4 stars
	refuse(t, g, 0, Action{Type: ActSummon, CardID: grunt.ID, X: 0, Y: 0})  // not beside the leader
	refuse(t, g, 1, Action{Type: ActSummon, CardID: grunt.ID, X: 0, Y: -2}) // not their turn
	must(t, g, 0, Action{Type: ActSummon, CardID: grunt.ID, X: 0, Y: -2})
	if s.Stars != 1 || !grunt.OnBoard || !grunt.FaceDown {
		t.Fatalf("summon: stars %d onBoard %v faceDown %v", s.Stars, grunt.OnBoard, grunt.FaceDown)
	}
	refuse(t, g, 0, Action{Type: ActSummon, CardID: s.Hand[0].ID, X: 1, Y: -2})
}

// A leader boxed in by enemy cards, with nowhere to play a card or step,
// loses when its turn comes round.
func TestCorneredLeaderLoses(t *testing.T) {
	g := duel(t)
	must(t, g, 0, Action{Type: ActEndTurn})
	for _, p := range []Pos{{-1, -3}, {1, -3}, {-1, -2}, {0, -2}, {1, -2}} {
		put(g, 1, 1, p.X, p.Y, false)
	}
	if !g.cornered(g.Seats[0]) {
		t.Fatal("the leader should be cornered")
	}
	must(t, g, 1, Action{Type: ActEndTurn})
	if g.Seats[0].Alive || g.Phase != PhaseFinished || g.WinnerTeam != 1 {
		t.Fatalf("alive %v phase %v winner %d", g.Seats[0].Alive, g.Phase, g.WinnerTeam)
	}

	// One free square is enough to play on: not checkmate.
	g = duel(t)
	must(t, g, 0, Action{Type: ActEndTurn})
	for _, p := range []Pos{{-1, -3}, {1, -3}, {-1, -2}, {0, -2}} {
		put(g, 1, 1, p.X, p.Y, false)
	}
	must(t, g, 1, Action{Type: ActEndTurn})
	if !g.Seats[0].Alive || g.Phase == PhaseFinished {
		t.Fatal("a leader with a diagonal square free is not cornered")
	}
}

func TestFieldLimit(t *testing.T) {
	g := duel(t, 1)
	for i, x := range []int{-3, -2, 1, 2, 3} {
		put(g, 1, 0, x, -1, true)
		_ = i
	}
	refuse(t, g, 0, Action{Type: ActSummon, CardID: g.Seats[0].Hand[0].ID, X: 0, Y: -2})
}

func TestBattleAttackVersusAttack(t *testing.T) {
	g := duel(t)
	att := put(g, 2, 0, 0, 0, false) // 1600
	def := put(g, 1, 1, 0, 1, false) // 1200
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if def.OnBoard || att.Pos != (Pos{0, 1}) {
		t.Fatal("the stronger attacker destroys the defender and takes its square")
	}
	if g.Seats[1].LP != 3600 {
		t.Fatalf("defender LP %d, want 3600", g.Seats[1].LP)
	}
	if len(g.Seats[1].Graveyard) != 1 {
		t.Fatal("the destroyed card goes to its owner's graveyard")
	}
	refuse(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 2}) // one order per turn
}

func TestBattleLosingAndTies(t *testing.T) {
	g := duel(t)
	weak := put(g, 1, 0, 0, 0, false)
	strong := put(g, 2, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: weak.ID, X: 0, Y: 1})
	if weak.OnBoard || !strong.OnBoard || g.Seats[0].LP != 3600 {
		t.Fatal("a weaker attacker is destroyed and its owner takes the difference")
	}

	g = duel(t)
	a := put(g, 1, 0, 0, 0, false)
	b := put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: a.ID, X: 0, Y: 1})
	if a.OnBoard || b.OnBoard || g.Seats[0].LP != 4000 || g.Seats[1].LP != 4000 {
		t.Fatal("equal attack destroys both and hurts nobody")
	}
}

func TestBattleVersusDefense(t *testing.T) {
	g := duel(t)
	att := put(g, 2, 0, 0, 0, false) // 1600
	wall := put(g, 4, 1, 0, 1, true) // DEF 2000, face down
	wall.Defense = true
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if !att.OnBoard || !wall.OnBoard || wall.FaceDown {
		t.Fatal("a failed attack on a defender destroys nothing and reveals it")
	}
	if g.Seats[0].LP != 3600 || g.Seats[1].LP != 4000 {
		t.Fatalf("LP %d / %d", g.Seats[0].LP, g.Seats[1].LP)
	}
}

func TestPositionChangeCanFlipFaceUp(t *testing.T) {
	g := duel(t)
	c := put(g, 2, 0, 0, 0, true)
	must(t, g, 0, Action{Type: ActPosition, CardID: c.ID, Defense: true, Flip: true})
	if !c.Defense || c.FaceDown || !c.Acted {
		t.Fatal("one order turns the monster to defense and face up")
	}

	g = duel(t)
	c = put(g, 2, 0, 0, 0, true)
	must(t, g, 0, Action{Type: ActPosition, CardID: c.ID, Defense: true})
	if !c.Defense || !c.FaceDown {
		t.Fatal("without Flip the monster stays face down")
	}
}

func TestFlippingAndAttackPositionLeaveTheCardFreeToMove(t *testing.T) {
	g := duel(t)
	c := put(g, 2, 0, 0, 0, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: c.ID})
	if c.FaceDown || c.Acted {
		t.Fatal("a monster turned face up can still act")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1})
	if c.Pos != (Pos{0, 1}) || !c.Acted {
		t.Fatal("it moves after flipping, and that is its order")
	}

	g = duel(t)
	c = put(g, 2, 0, 0, 0, false)
	c.Defense = true
	must(t, g, 0, Action{Type: ActPosition, CardID: c.ID, Defense: false})
	if c.Defense || c.Acted {
		t.Fatal("switching to attack leaves the card free to move")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1})

	g = duel(t)
	c = put(g, 2, 0, 0, 0, true)
	c.Defense = true
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1, Flip: true, Attack: true})
	if c.Defense || c.FaceDown || c.Pos != (Pos{0, 1}) {
		t.Fatal("one move can turn the card face up and into attack on the way")
	}

	g = duel(t)
	c = put(g, 2, 0, 0, 0, false)
	must(t, g, 0, Action{Type: ActPosition, CardID: c.ID, Defense: true})
	refuse(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1}) // defense is the whole order
}

func TestMonstersNeverMoveInDefense(t *testing.T) {
	// A monster left in defense from an earlier turn may move, but it moves in attack position.
	g := duel(t)
	c := put(g, 2, 0, 0, 0, false)
	c.Defense = true
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1})
	if c.Defense || c.Pos != (Pos{0, 1}) || !c.Acted {
		t.Fatal("moving takes a defending monster into attack position")
	}

	// Face down and in defense: flip up and move in one order, ending face up in attack.
	g = duel(t)
	c = put(g, 2, 0, 0, 0, true)
	c.Defense = true
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1, Flip: true})
	if c.Defense || c.FaceDown || c.Pos != (Pos{0, 1}) {
		t.Fatal("flip and move in one order ends face up in attack position")
	}

	// Flip up first, as its own order, and the card can still move afterwards.
	g = duel(t)
	c = put(g, 2, 0, 0, 0, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: c.ID})
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1})
	if c.FaceDown || c.Defense || c.Pos != (Pos{0, 1}) {
		t.Fatal("a card flipped face up keeps its move")
	}
}

func TestDirectAttackAndVictory(t *testing.T) {
	g := duel(t)
	att := put(g, 3, 0, 0, 2, false)
	g.Seats[1].LP = 2500
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	if g.Phase != PhaseFinished || g.WinnerTeam != 0 {
		t.Fatalf("phase %s winner %d", g.Phase, g.WinnerTeam)
	}
	if att.Pos != (Pos{0, 2}) {
		t.Fatal("a monster does not move onto a leader")
	}
	refuse(t, g, 0, Action{Type: ActEndTurn})
}

func TestTerrainBonusAndDoubleMove(t *testing.T) {
	tiles := map[Pos]string{{0, 0}: TerrainMountain}
	g := New(DefaultConfig(7), cat, tiles, []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}, 1)
	drake := put(g, 2, 0, 0, 0, false)
	if g.here(drake) != 2100 {
		t.Fatalf("dragon on mountain has %d ATK", g.here(drake))
	}
	targets := g.MoveTargets(drake)
	if _, ok := targets[Pos{1, 1}]; !ok {
		t.Fatal("a favoured monster can move two squares, including diagonally")
	}
	if _, ok := targets[Pos{0, 3}]; ok {
		t.Fatal("never more than two squares")
	}
	grunt := put(g, 1, 0, 2, 0, false)
	if len(g.MoveTargets(grunt)) != 4 {
		t.Fatalf("an ordinary monster has %d moves, want 4", len(g.MoveTargets(grunt)))
	}
}

func TestLabyrinthAndCrush(t *testing.T) {
	tiles := map[Pos]string{{0, 1}: TerrainLabyrinth, {1, 0}: TerrainCrush}
	g := New(DefaultConfig(7), cat, tiles, []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}, 1)
	titan := put(g, 3, 0, 0, 0, false)
	refuse(t, g, 0, Action{Type: ActMove, CardID: titan.ID, X: 0, Y: 1})
	must(t, g, 0, Action{Type: ActMove, CardID: titan.ID, X: 1, Y: 0})
	if titan.OnBoard {
		t.Fatal("crush terrain destroys a monster with 1500 or more ATK")
	}
}

func TestFusionAndEquip(t *testing.T) {
	g := duel(t)
	grunt := put(g, 1, 0, 0, 0, false)
	drake := put(g, 2, 0, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: drake.ID, X: 0, Y: 0})
	fused := g.Board[Pos{0, 0}]
	if fused == nil || fused.Def.Num != 9 || grunt.OnBoard || drake.OnBoard {
		t.Fatal("two matching monsters fuse into the recipe's result")
	}

	g = duel(t)
	grunt = put(g, 1, 0, 0, 0, false)
	sword := put(g, 22, 0, 0, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: sword.ID, X: 0, Y: 0})
	if g.here(grunt) != 1700 || sword.OnBoard || g.Board[Pos{0, 0}] != grunt {
		t.Fatalf("equip: ATK %d", g.here(grunt))
	}
}

// A power-up for another type of monster still merges into it (eating the
// card) but gives no boost, from the hand or moved on the field.
func TestEquipWrongTypeMergesWithoutBoost(t *testing.T) {
	g := duel(t)
	s := g.Seats[0]
	drake := put(g, 2, 0, 0, -2, false)
	sword := g.newCard(22, 0)
	s.Hand = append(s.Hand, sword)
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{sword.ID}, X: 0, Y: -2})
	if g.Board[Pos{0, -2}] != drake || g.here(drake) != 1600 || slices.Contains(s.Hand, sword) {
		t.Fatalf("hand play: ATK %d", g.here(drake))
	}

	g = duel(t)
	drake = put(g, 2, 0, 0, 0, false)
	onField := put(g, 22, 0, 0, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: onField.ID, X: 0, Y: 0})
	if g.Board[Pos{0, 0}] != drake || g.here(drake) != 1600 || onField.OnBoard {
		t.Fatalf("field move: ATK %d", g.here(drake))
	}
}

// Two monsters from the hand with no recipe: the first is knocked into the
// graveyard and only the last one is played, and paid for.
func TestHandFusionWithoutRecipe(t *testing.T) {
	g := duel(t, 1, 4)
	s := g.Seats[0]
	var grunt, wall *Card
	for _, c := range s.Hand {
		if c.Def.Num == 1 && grunt == nil {
			grunt = c
		}
		if c.Def.Num == 4 && wall == nil {
			wall = c
		}
	}
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{grunt.ID, wall.ID}, X: 0, Y: -2})
	if g.Board[Pos{0, -2}] != wall || grunt.OnBoard || s.Stars != 2 {
		t.Fatalf("board %v, grunt on board %v, stars %d", g.Board[Pos{0, -2}], grunt.OnBoard, s.Stars)
	}
	if len(s.Graveyard) != 1 || s.Graveyard[0] != 1 {
		t.Fatalf("graveyard %v", s.Graveyard)
	}
	bonked := false
	for _, e := range g.TakeEvents() {
		if e.Type == "destroyed" && e.Text == "replaced" {
			bonked = true
		}
	}
	if !bonked {
		t.Fatal("the knocked-out card is reported so the client plays the bonk")
	}
}

// Two fusion spells marked onto your own monster on a summoning square: each
// fuses in turn with what the one before made.
func TestFusionSpellsOntoFieldMonster(t *testing.T) {
	g := duel(t)
	s := g.Seats[0]
	grunt := put(g, 1, 0, 0, -2, false)
	morph, ascend := g.newCard(60, 0), g.newCard(61, 0)
	s.Hand = append(s.Hand, morph, ascend)
	stars := s.Stars
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{morph.ID, ascend.ID}, X: 0, Y: -2})
	got := g.Board[Pos{0, -2}]
	if got == nil || got.Def.Num != 3 || grunt.OnBoard || s.Stars != stars {
		t.Fatalf("board %+v, grunt on board %v, stars %d", got, grunt.OnBoard, s.Stars)
	}
	fusions := 0
	for _, e := range g.TakeEvents() {
		if e.Type == "fusion" {
			fusions++
		}
	}
	if fusions != 2 {
		t.Fatalf("%d fusion events, want 2", fusions)
	}

	// Two equip spells stack onto the monster the same way.
	g = duel(t)
	s = g.Seats[0]
	grunt = put(g, 1, 0, 0, -2, false)
	a, b := g.newCard(22, 0), g.newCard(22, 0)
	s.Hand = append(s.Hand, a, b)
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{a.ID, b.ID}, X: 0, Y: -2})
	if g.Board[Pos{0, -2}] != grunt || g.here(grunt) != 2200 {
		t.Fatalf("double equip: ATK %d", g.here(grunt))
	}

	// Without a card of yours on the square, two spells still cannot combine.
	g = duel(t)
	s = g.Seats[0]
	morph, ascend = g.newCard(60, 0), g.newCard(61, 0)
	s.Hand = append(s.Hand, morph, ascend)
	refuse(t, g, 0, Action{Type: ActSummon, CardIDs: []int{morph.ID, ascend.ID}, X: 0, Y: -2})
}

// The seat to move sees what each of its monsters would fight with on every
// terrain of the map, to judge a move before making it.
func TestViewStrengthByTerrain(t *testing.T) {
	tiles := map[Pos]string{{1, 0}: TerrainMountain}
	g := New(DefaultConfig(7), cat, tiles, []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}, 1)
	drake := put(g, 2, 0, 0, 0, false)
	put(g, 1, 1, 0, 2, false)
	v := g.ViewFor(0)
	byTerrain := v.Legal.Strength[drake.ID]
	plain, mountain := byTerrain[TerrainNormal], byTerrain[TerrainMountain]
	if plain.Atk != 1600 || mountain.Atk != drake.AtkOn(TerrainMountain) || mountain.Def != drake.DefOn(TerrainMountain) {
		t.Fatalf("strength %+v", byTerrain)
	}
	if len(v.Legal.Strength) != 1 {
		t.Fatalf("only the viewer's monsters: %+v", v.Legal.Strength)
	}
}

// Blast Sphere destroyed in battle takes every card in the 3×3 area around
// its square with it: the attacker that moved in, its neighbours on both
// sides, face-down cards too. Further away nothing happens.
func TestBlastSphere(t *testing.T) {
	g := duel(t)
	sphere := put(g, 6, 1, 0, 0, false)
	titan := put(g, 3, 0, 0, -1, false)  // attacks and wins: lands on the sphere's square
	ownSide := put(g, 1, 0, 1, 1, false) // the attacker's own monster, in range
	ally := put(g, 4, 1, -1, 0, true)    // the sphere's owner's own face-down card, in range
	spell := put(g, 21, 1, 1, -1, true)  // a set spell, in range
	far := put(g, 2, 1, 2, 0, false)     // out of range
	must(t, g, 0, Action{Type: ActMove, CardID: titan.ID, X: 0, Y: 0})
	for _, c := range []*Card{sphere, titan, ownSide, ally, spell} {
		if c.OnBoard {
			t.Fatalf("%s survived the blast", c.Def.Name)
		}
	}
	if !far.OnBoard {
		t.Fatal("the blast reaches only the surrounding squares")
	}
	blasts := 0
	for _, e := range g.TakeEvents() {
		if e.Type == "blast" {
			blasts++
		}
	}
	if blasts != 1 {
		t.Fatalf("%d blast events", blasts)
	}

	// Surviving a battle does not set it off.
	g = duel(t)
	sphere = put(g, 6, 1, 0, 0, false)
	grunt := put(g, 1, 0, 0, -1, false) // 1200 against 1400: the attacker loses
	neighbour := put(g, 2, 1, 1, 0, false)
	must(t, g, 0, Action{Type: ActMove, CardID: grunt.ID, X: 0, Y: 0})
	if !sphere.OnBoard || !neighbour.OnBoard || grunt.OnBoard {
		t.Fatal("a sphere that wins its battle does not explode")
	}
}

// Machine King, turned face up, gains 100 ATK and DEF for every face-up
// machine on the field, either side, itself included. Face-down machines and
// other types do not count, and it happens only when it is flipped.
func TestMachineKingFlip(t *testing.T) {
	g := duel(t)
	king := put(g, 8, 0, 0, 0, true)
	put(g, 6, 0, 1, 0, false)  // a face-up machine of ours
	put(g, 7, 1, 0, 2, false)  // a face-up machine of theirs
	put(g, 7, 1, 2, 2, true)   // face down: unknown, does not count
	put(g, 1, 0, -1, 0, false) // not a machine
	must(t, g, 0, Action{Type: ActFlip, CardID: king.ID})
	if king.AtkMod != 300 || king.DefMod != 300 || g.here(king) != 2500 {
		t.Fatalf("mods %d/%d, ATK %d", king.AtkMod, king.DefMod, g.here(king))
	}

	// Defending face down, it is flipped by the attack and fights boosted.
	g = duel(t)
	king = put(g, 8, 1, 0, 0, true)
	put(g, 7, 1, 1, 0, false)
	titan := put(g, 3, 0, 0, -1, false) // 3000
	must(t, g, 0, Action{Type: ActMove, CardID: titan.ID, X: 0, Y: 0})
	if king.AtkMod != 200 {
		t.Fatalf("flipped by an attack: mod %d", king.AtkMod)
	}
}

// Cannon Soldier, face up, can enter labyrinth squares and turns each one it
// enters into normal terrain. Other monsters, and a face-down Cannon Soldier,
// are still kept out.
func TestCannonSoldierLabyrinth(t *testing.T) {
	tiles := map[Pos]string{{0, 1}: TerrainLabyrinth, {1, 0}: TerrainLabyrinth}
	g := New(DefaultConfig(7), cat, tiles, []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}, 1)
	cannon := put(g, 7, 0, 0, 0, false)
	grunt := put(g, 1, 0, 1, 1, false)
	refuse(t, g, 0, Action{Type: ActMove, CardID: grunt.ID, X: 1, Y: 0})
	must(t, g, 0, Action{Type: ActMove, CardID: cannon.ID, X: 0, Y: 1})
	if g.Tiles[Pos{0, 1}] != TerrainNormal || g.Board[Pos{0, 1}] != cannon {
		t.Fatalf("tile %q, board %v", g.Tiles[Pos{0, 1}], g.Board[Pos{0, 1}])
	}

	hidden := put(g, 7, 0, 2, 0, true)
	refuse(t, g, 0, Action{Type: ActMove, CardID: hidden.ID, X: 1, Y: 0})
	// Turning face up as part of the move lets it in.
	must(t, g, 0, Action{Type: ActMove, CardID: hidden.ID, X: 1, Y: 0, Flip: true})
	if g.Tiles[Pos{1, 0}] != TerrainNormal {
		t.Fatal("a cannon soldier flipped as it moves clears the labyrinth too")
	}
}

func TestSpells(t *testing.T) {
	g := duel(t)
	g.Seats[0].LP = 1000
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 20, 0, 0, 0, true).ID})
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 21, 0, 1, 0, true).ID})
	if g.Seats[0].LP != 1500 || g.Seats[1].LP != 3000 {
		t.Fatalf("LP %d / %d", g.Seats[0].LP, g.Seats[1].LP)
	}
	if len(g.Board) != 0 {
		t.Fatal("a used spell leaves the field")
	}

	g = duel(t)
	inLine := put(g, 1, 1, 0, 2, true)
	offLine := put(g, 1, 1, 1, 2, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 24, 0, 0, 0, true).ID})
	if inLine.OnBoard || !offLine.OnBoard {
		t.Fatal("lightning destroys monsters in the spell's row and column only")
	}

	g = duel(t)
	before := len(g.Seats[0].Hand)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 27, 0, 0, 0, true).ID})
	if len(g.Seats[0].Hand) != before+2 {
		t.Fatal("drawing two cards")
	}
}

func TestReviveIsAChoice(t *testing.T) {
	g := duel(t)
	reborn := put(g, 23, 0, 0, 0, true)
	refuse(t, g, 0, Action{Type: ActFlip, CardID: reborn.ID}) // empty graveyards
	g.Seats[1].Graveyard = []int{3}
	must(t, g, 0, Action{Type: ActFlip, CardID: reborn.ID})
	if g.Pending == nil || g.Pending.Seat != 0 {
		t.Fatal("reviving asks its owner to choose")
	}
	if o := g.Pending.Options[0]; o.From == nil || *o.From != 1 || o.Slot == nil || *o.Slot != 0 {
		t.Fatal("each option says which graveyard slot it is")
	}
	refuse(t, g, 0, Action{Type: ActEndTurn}) // must choose first
	refuse(t, g, 1, Action{Type: ActChoose, Choice: 0})
	must(t, g, 0, Action{Type: ActChoose, Choice: 0})
	revived := g.Board[Pos{0, 0}]
	if revived == nil || revived.Def.Num != 3 || revived.Owner != 0 || len(g.Seats[1].Graveyard) != 0 {
		t.Fatal("the chosen monster returns under the caster's control")
	}
}

func TestControlLastsOneTurn(t *testing.T) {
	g := duel(t)
	theirs := put(g, 3, 1, 0, 2, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 25, 0, 0, 0, true).ID})
	must(t, g, 0, Action{Type: ActChoose, Choice: 0})
	if theirs.Owner != 0 {
		t.Fatal("the card changes sides")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: theirs.ID, X: 0, Y: 3})
	if g.Seats[1].LP != 1000 {
		t.Fatalf("LP %d", g.Seats[1].LP)
	}
	must(t, g, 0, Action{Type: ActEndTurn})
	if theirs.Owner != 1 || theirs.Borrowed {
		t.Fatal("the card goes home at the end of the turn")
	}
}

func TestTraps(t *testing.T) {
	g := duel(t)
	pit := put(g, 30, 1, 1, 1, true)
	walker := put(g, 1, 0, 0, -1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: walker.ID, X: 0, Y: 0})
	if walker.OnBoard || pit.OnBoard {
		t.Fatal("a limited range trap destroys a monster that steps next to it")
	}

	g = duel(t)
	pit = put(g, 30, 1, 1, 1, true)
	titan := put(g, 3, 0, 0, -1, false) // 3000 ATK, above the trap's limit
	must(t, g, 0, Action{Type: ActMove, CardID: titan.ID, X: 0, Y: 0})
	if !titan.OnBoard || !pit.OnBoard {
		t.Fatal("the trap ignores monsters too strong for it")
	}

	g = duel(t)
	put(g, 31, 1, 1, 1, true)
	walker = put(g, 1, 0, 0, -1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: walker.ID, X: 0, Y: 0})
	if walker.Spellbound != 3 || g.here(walker) != 600 {
		t.Fatalf("spellbound %d ATK %d", walker.Spellbound, g.here(walker))
	}
	for i := 0; i < 3; i++ {
		must(t, g, 0, Action{Type: ActEndTurn})
		must(t, g, 1, Action{Type: ActEndTurn})
	}
	if walker.Spellbound != 0 {
		t.Fatal("a spellbind wears off")
	}

	g = duel(t)
	put(g, 32, 1, 3, 3, true)
	att := put(g, 3, 0, 0, 2, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	if g.Seats[1].LP != 4000 || !att.Acted {
		t.Fatal("a negated attack does nothing but still uses the card's order")
	}

	g = duel(t)
	put(g, 33, 1, 3, 3, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 21, 0, 0, 0, true).ID})
	if g.Seats[1].LP != 4000 {
		t.Fatal("a jammed spell has no effect")
	}
}

func TestDeckOutLoses(t *testing.T) {
	g := duel(t)
	g.Seats[1].Deck = nil
	must(t, g, 0, Action{Type: ActEndTurn})
	if g.Phase != PhaseFinished || g.WinnerTeam != 0 {
		t.Fatal("a duelist who cannot draw loses")
	}
}

func TestHiddenInformation(t *testing.T) {
	g := duel(t)
	put(g, 3, 1, 0, 2, true)
	view := g.ViewFor(0)
	if c := view.Cards[0]; !c.Hidden || c.Num != HiddenNum || c.Atk != 0 {
		t.Fatalf("an enemy face-down card leaked: %+v", c)
	}
	if own := g.ViewFor(1); own.Cards[0].Num != 3 || len(own.Hand) != 0 {
		t.Fatal("its owner sees it")
	}
	if len(view.Hand) != 5 || view.Legal == nil {
		t.Fatal("the seat to move sees its hand and its options")
	}
	if spectator := g.ViewFor(-1); len(spectator.Hand) != 0 || !spectator.Cards[0].Hidden || spectator.Legal != nil {
		t.Fatal("a spectator sees no hidden information")
	}
}

func TestAdminViewHidesNothing(t *testing.T) {
	g := duel(t)
	put(g, 3, 1, 0, 2, true)
	v := g.ViewAll()
	if v.Cards[0].Hidden || v.Cards[0].Num != 3 {
		t.Fatal("the admin view shows face-down cards")
	}
	if len(v.Reveal.Hands[0]) != 5 || len(v.Reveal.Decks[0]) != 35 || len(v.Reveal.Decks[1]) != 40 {
		t.Fatalf("hands and decks: %d / %d / %d", len(v.Reveal.Hands[0]), len(v.Reveal.Decks[0]), len(v.Reveal.Decks[1]))
	}
	if v.Legal != nil || g.ViewFor(0).Reveal != nil {
		t.Fatal("the admin view cannot act, and no player view reveals anything")
	}
}

func TestTeamGameEndsWhenATeamIsOut(t *testing.T) {
	seats := []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}, {Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}
	g := New(DefaultConfig(9), cat, nil, seats, 1)
	must(t, g, 1, Action{Type: ActConcede})
	if g.Phase != PhasePlaying {
		t.Fatal("one member of a team conceding does not end the game")
	}
	must(t, g, 0, Action{Type: ActEndTurn})
	if g.Turn != 2 {
		t.Fatalf("turn went to seat %d, want 2 (seat 1 is out)", g.Turn)
	}
	must(t, g, 3, Action{Type: ActConcede})
	if g.Phase != PhaseFinished || g.WinnerTeam != 0 {
		t.Fatal("the game ends when a whole team is out")
	}
}

// TestRandomPlayouts plays whole games by picking uniformly among the legal
// actions. It proves three things on every step: everything the engine offers
// is accepted (no dead ends), the board never breaks its invariants, and every
// game finishes.
func TestRandomPlayouts(t *testing.T) {
	nums := make([]int, 0, len(cat))
	for num := range cat {
		if num != 9 {
			nums = append(nums, num)
		}
	}
	// In a fixed order, so a seed always plays the same game.
	sort.Ints(nums)
	for seed := int64(1); seed <= 150; seed++ {
		rng := rand.New(rand.NewSource(seed))
		players := 2
		if seed%3 == 0 {
			players = 4
		}
		tiles := map[Pos]string{}
		size := 7
		for x := -3; x <= 3; x++ {
			for y := -3; y <= 3; y++ {
				tiles[Pos{x, y}] = AllTerrains[rng.Intn(len(AllTerrains))]
			}
		}
		var seats []SeatSetup
		for i := 0; i < players; i++ {
			deck := make([]int, 40)
			for j := range deck {
				deck[j] = nums[rng.Intn(len(nums))]
			}
			seats = append(seats, SeatSetup{Team: i % 2, Deck: deck})
		}
		g := New(DefaultConfig(size), cat, tiles, seats, seed)

		for step := 0; g.Phase == PhasePlaying; step++ {
			if step > 20000 {
				t.Fatalf("seed %d: the game did not finish", seed)
			}
			actor := g.Turn
			if g.Pending != nil {
				actor = g.Pending.Seat
			}
			legal := g.LegalActions(actor)
			if len(legal) == 0 {
				t.Fatalf("seed %d step %d: seat %d has nothing it can do", seed, step, actor)
			}
			// Lean towards doing things, so games see real action.
			a := legal[rng.Intn(len(legal))]
			if a.Type == ActEndTurn && len(legal) > 1 && rng.Intn(4) != 0 {
				a = legal[rng.Intn(len(legal)-1)]
			}
			if err := g.Apply(actor, a); err != nil {
				t.Fatalf("seed %d step %d: legal action %+v rejected: %v", seed, step, a, err)
			}
			checkInvariants(t, g, seed)
		}
	}
}

func checkInvariants(t *testing.T, g *Game, seed int64) {
	t.Helper()
	leaders := map[Pos]bool{}
	for _, s := range g.Seats {
		if !s.Alive {
			continue
		}
		if s.LP <= 0 && g.Phase == PhasePlaying {
			t.Fatalf("seed %d: seat %d is alive with %d LP", seed, s.Index, s.LP)
		}
		if s.Stars < 0 || s.Stars > g.Cfg.MaxStars {
			t.Fatalf("seed %d: seat %d has %d stars", seed, s.Index, s.Stars)
		}
		if leaders[s.Leader] || g.Board[s.Leader] != nil || !g.InBounds(s.Leader) {
			t.Fatalf("seed %d: leader %d shares or leaves its square %v", seed, s.Index, s.Leader)
		}
		leaders[s.Leader] = true
		// The monster limit is per team: 5 for each duelist on it.
		team, duelists := 0, 0
		for _, o := range g.Seats {
			if o.Team == s.Team {
				duelists++
				team += g.countOnBoard(o.Index, true)
			}
		}
		if team > g.Cfg.MaxMonsters*duelists {
			t.Fatalf("seed %d: seat %d's team has %d monsters", seed, s.Index, team)
		}
	}
	for p, c := range g.Board {
		if c.Pos != p || !c.OnBoard || g.Cards[c.ID] != c || !g.InBounds(p) {
			t.Fatalf("seed %d: board and card disagree at %v", seed, p)
		}
		if g.Phase == PhasePlaying && !g.Seats[c.Owner].Alive {
			t.Fatalf("seed %d: card %d belongs to an eliminated seat", seed, c.ID)
		}
	}
	if g.Phase == PhasePlaying && !g.Seats[g.Turn].Alive {
		t.Fatalf("seed %d: the turn is on an eliminated seat", seed)
	}
}

func TestFieldSpellCoversADiamond(t *testing.T) {
	g := duel(t)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 28, 0, 0, 0, true).ID})
	want := map[Pos]bool{}
	for _, p := range []Pos{
		{0, 2},
		{-1, 1}, {0, 1}, {1, 1},
		{-2, 0}, {-1, 0}, {0, 0}, {1, 0}, {2, 0},
		{-1, -1}, {0, -1}, {1, -1},
		{0, -2},
	} {
		want[p] = true
	}
	for p, terrain := range g.Tiles {
		if (terrain == TerrainMountain) != want[p] {
			t.Fatalf("square %v is %s", p, terrain)
		}
	}
}

func TestTypesAreStrongAndWeakByTerrain(t *testing.T) {
	cases := []struct {
		terrain, kind string
		want          int
	}{
		{TerrainForest, "beast", 500}, {TerrainSogen, "beast", 0}, {TerrainUmi, "thunder", 500},
		{TerrainWasteland, "reptile", 0}, {TerrainToon, "reptile", -500},
		{TerrainWasteland, "aqua", -500}, {TerrainWasteland, "sea-serpent", -500}, {TerrainWasteland, "fish", -500},
		{TerrainSogen, "spellcaster", -500}, {TerrainMountain, "zombie", -500}, {TerrainUmi, "machine", -500},
		{TerrainToon, "dragon", -500}, {TerrainToon, "toon", 500}, {TerrainCrush, "immortal", 500},
		{TerrainForest, "fiend", 0}, {TerrainNormal, "dragon", 0}, {TerrainLabyrinth, "warrior", 0},
	}
	for _, c := range cases {
		if got := TerrainBonus(c.terrain, c.kind); got != c.want {
			t.Errorf("%s on %s: %d, want %d", c.kind, c.terrain, got, c.want)
		}
	}
	// Both attack and defense move, and never below zero.
	g := duel(t)
	g.Tiles[Pos{0, 0}] = TerrainSogen
	grunt := put(g, 1, 0, 0, 0, false) // warrior 1200/1000
	if grunt.AtkOn(TerrainSogen) != 1700 || grunt.DefOn(TerrainSogen) != 1500 || grunt.AtkOn(TerrainToon) != 700 {
		t.Fatalf("warrior: %d/%d on sogen, %d ATK on toon", grunt.AtkOn(TerrainSogen), grunt.DefOn(TerrainSogen), grunt.AtkOn(TerrainToon))
	}
}

func TestLegalFlipMovesReachAsFaceUp(t *testing.T) {
	// Face down, a favoured monster reaches one square; flipped up as part of
	// the move it reaches two, and the view says so before the move is sent.
	tiles := map[Pos]string{{0, 0}: TerrainMountain}
	g := New(DefaultConfig(7), cat, tiles, []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}, 1)
	drake := put(g, 2, 0, 0, 0, true)
	legal := g.ViewFor(0).Legal
	has := func(ps []Pos, p Pos) bool {
		for _, q := range ps {
			if q == p {
				return true
			}
		}
		return false
	}
	if has(legal.Moves[drake.ID], Pos{1, 1}) {
		t.Fatal("face down, the monster gets no terrain reach")
	}
	if !has(legal.FlipMoves[drake.ID], Pos{1, 1}) {
		t.Fatal("flipping on the way gives it its terrain reach")
	}
	if !drake.FaceDown {
		t.Fatal("working out the flipped moves must not turn the card up")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: drake.ID, X: 1, Y: 1, Flip: true})
}

func TestFissureOnlyHitsFaceUpMonsters(t *testing.T) {
	g := duel(t)
	hidden := put(g, 4, 1, 0, 2, true) // Wall, 300 ATK, face down
	shown := put(g, 1, 1, 1, 2, false) // Grunt, 1200 ATK, face up
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 29, 0, 0, 0, true).ID})
	if !hidden.OnBoard {
		t.Fatal("a face-down monster is never Fissure's target, however weak")
	}
	if shown.OnBoard {
		t.Fatal("the weakest face-up monster is destroyed")
	}

	// Nothing face up: nothing is destroyed.
	g = duel(t)
	hidden = put(g, 4, 1, 0, 2, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 29, 0, 0, 0, true).ID})
	if !hidden.OnBoard {
		t.Fatal("with only face-down monsters Fissure does nothing")
	}
}

func TestSpellFlippedOnTheMoveIsCastWhereItLands(t *testing.T) {
	g := duel(t)
	foe := put(g, 1, 1, 1, 1, false)   // Grunt: in line with (0,1), where the spell lands, not with (0,0)
	spell := put(g, 24, 0, 0, 0, true) // Lightning: destroys monsters in its row and column
	must(t, g, 0, Action{Type: ActMove, CardID: spell.ID, X: 0, Y: 1, Flip: true})
	if foe.OnBoard {
		t.Fatal("the spell is cast on landing, from its new square")
	}
	if spell.Pos != (Pos{0, 1}) && spell.OnBoard {
		t.Fatal("the spell moved before it was cast")
	}

	// Without Flip it just moves, face down.
	g = duel(t)
	spell = put(g, 24, 0, 0, 0, true)
	must(t, g, 0, Action{Type: ActMove, CardID: spell.ID, X: 0, Y: 1})
	if !spell.FaceDown || spell.Pos != (Pos{0, 1}) {
		t.Fatal("a plain move leaves the spell face down")
	}

	// A spell that cannot be cast refuses the whole order and stays put.
	g = duel(t)
	reborn := put(g, 23, 0, 0, 0, true) // nothing in any graveyard
	refuse(t, g, 0, Action{Type: ActMove, CardID: reborn.ID, X: 0, Y: 1, Flip: true})
	if reborn.Pos != (Pos{0, 0}) || !reborn.FaceDown {
		t.Fatal("a spell that cannot be cast does not move either")
	}
}

// exodiaDuel: seat 0 leads with Exodia, seat 1 with an ordinary monster.
func exodiaDuel(t *testing.T) *Game {
	t.Helper()
	return New(DefaultConfig(7), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2), Leader: 58}, {Team: 1, Deck: deckOf(1), Leader: 1}}, 1)
}

// playLimbs puts the four limbs on seat 0's side, as if played one by one.
func playLimbs(g *Game, faceDown bool) []*Card {
	var limbs []*Card
	for i, num := range []int{54, 55, 56, 57} {
		limbs = append(limbs, put(g, num, 0, i-2, -2, faceDown))
	}
	return limbs
}

func TestExodiaWinsWhenATurnBeginsWithAllFourLimbs(t *testing.T) {
	g := exodiaDuel(t)
	playLimbs(g, false)
	must(t, g, 0, Action{Type: ActEndTurn})
	if g.Phase != PhasePlaying {
		t.Fatal("the win comes at the start of Exodia's own turn, not at the end of it")
	}
	must(t, g, 1, Action{Type: ActEndTurn})
	if g.Phase != PhaseFinished || g.WinnerTeam != 0 {
		t.Fatalf("all four limbs at the start of the turn win: phase %s winner %d", g.Phase, g.WinnerTeam)
	}
}

func TestExodiaNeedsEveryLimbFaceUpAndFree(t *testing.T) {
	cases := map[string]func(limbs []*Card, g *Game){
		"one destroyed":  func(l []*Card, g *Game) { g.bury(l[0], "test", 1) },
		"one spellbound": func(l []*Card, _ *Game) { l[1].Spellbound = 2 },
		"one face down":  func(l []*Card, _ *Game) { l[2].FaceDown = true },
		"one taken":      func(l []*Card, _ *Game) { l[3].Owner = 1 },
	}
	for name, spoil := range cases {
		g := exodiaDuel(t)
		spoil(playLimbs(g, false), g)
		must(t, g, 0, Action{Type: ActEndTurn})
		must(t, g, 1, Action{Type: ActEndTurn})
		if g.Phase != PhasePlaying {
			t.Fatalf("%s: no victory", name)
		}
	}
}

func TestOnlyExodiaWinsByLimbs(t *testing.T) {
	// The same four limbs under another leader are just monsters.
	g := New(DefaultConfig(7), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1), Leader: 1}, {Team: 1, Deck: deckOf(1), Leader: 1}}, 1)
	playLimbs(g, false)
	must(t, g, 0, Action{Type: ActEndTurn})
	must(t, g, 1, Action{Type: ActEndTurn})
	if g.Phase != PhasePlaying {
		t.Fatal("the limbs win only for an Exodia-led deck")
	}

	g = exodiaDuel(t)
	if g.ViewFor(1).Seats[1].LeaderNum != 1 || g.ViewFor(1).Seats[0].LeaderNum != 58 {
		t.Fatal("everyone sees every seat's deck leader")
	}
	g = duel(t)
	if g.ViewFor(0).Seats[0].LeaderNum != -1 {
		t.Fatal("a deck without a leader card shows none")
	}
}

// Cards played together report each merge, in order, for the client to animate.
func TestFusionChainEvent(t *testing.T) {
	g := duel(t, 1, 2, 4)
	s := g.Seats[0]
	pick := func(num int) int {
		c := g.newCard(num, 0)
		s.Hand = append(s.Hand, c)
		return c.ID
	}
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{pick(1), pick(2), pick(4)}, X: 0, Y: -2})
	var chain *Event
	for _, e := range g.TakeEvents() {
		if e.Type == "fusionChain" {
			e := e
			chain = &e
		}
	}
	if chain == nil {
		t.Fatal("no fusionChain event")
	}
	want := []ChainStep{{Base: 1, Add: 2, Result: 9, Kind: "fuse"}, {Base: 9, Add: 4, Result: 4, Kind: "bonk"}}
	if len(chain.Steps) != len(want) {
		t.Fatalf("steps %+v", chain.Steps)
	}
	for i, st := range want {
		if chain.Steps[i] != st {
			t.Fatalf("step %d: got %+v, want %+v", i, chain.Steps[i], st)
		}
	}
	for _, st := range HideChain(chain.Steps) {
		if st.Base != HiddenNum || st.Add != HiddenNum || st.Result != HiddenNum {
			t.Fatal("hidden chain still shows a card")
		}
	}
}

func TestTendernessHalvesDamageInFaceUpDefense(t *testing.T) {
	g := duel(t)
	tender := put(g, 5, 1, 3, 3, false)
	lp := func() int { return g.Seats[1].LP }
	hit := func(amount int) int { before := lp(); g.damage(1, amount, "test", 0); return before - lp() }

	if got := hit(1000); got != 1000 {
		t.Fatalf("in attack position it does nothing: took %d, want 1000", got)
	}
	tender.Defense = true
	if got := hit(1000); got != 500 {
		t.Fatalf("face-up defense halves damage: took %d, want 500", got)
	}
	put(g, 5, 1, 4, 3, false).Defense = true
	if got := hit(1000); got != 500 {
		t.Fatalf("two of them still only halve once: took %d, want 500", got)
	}
	before := g.Seats[0].LP
	g.damage(0, 1000, "test", 1)
	if before-g.Seats[0].LP != 1000 {
		t.Fatal("it only protects its own side")
	}

	g2 := duel(t)
	put(g2, 5, 1, 3, 3, true).Defense = true
	g2.damage(1, 1000, "test", 0)
	if g2.Seats[1].LP != 3000 {
		t.Fatalf("face down it does nothing: LP %d, want 3000", g2.Seats[1].LP)
	}

	// Battle damage is halved too: a 1600 attacker beats a 1200 monster by 400.
	g3 := duel(t)
	put(g3, 5, 1, 3, 3, false).Defense = true
	att := put(g3, 2, 0, 0, 0, false)
	put(g3, 1, 1, 0, 1, false)
	must(t, g3, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if g3.Seats[1].LP != 3800 {
		t.Fatalf("battle damage halved: LP %d, want 3800", g3.Seats[1].LP)
	}
}

func TestLeaderEatsItsOwnCards(t *testing.T) {
	g := duel(t)
	me := g.Seats[0]
	at := me.Leader
	mine := put(g, 1, 0, at.X+1, at.Y, true)
	theirs := put(g, 2, 1, at.X, at.Y+1, false)
	targets := map[Pos]bool{}
	for _, p := range g.LeaderTargets(me) {
		targets[p] = true
	}
	if !targets[mine.Pos] {
		t.Fatal("the leader can step onto its own card")
	}
	if targets[theirs.Pos] {
		t.Fatal("the leader cannot step onto an enemy card")
	}
	must(t, g, 0, Action{Type: ActLeader, X: at.X + 1, Y: at.Y})
	if mine.OnBoard || me.Leader != (Pos{at.X + 1, at.Y}) || len(me.Graveyard) != 1 {
		t.Fatal("the eaten card goes to the graveyard and the leader takes its square")
	}

	// A card borrowed from the enemy is not ours to eat.
	g2 := duel(t)
	l := g2.Seats[0].Leader
	stolen := put(g2, 1, 1, l.X+1, l.Y, false)
	g2.borrow(stolen, 0)
	for _, p := range g2.LeaderTargets(g2.Seats[0]) {
		if p == stolen.Pos {
			t.Fatal("the leader cannot eat a borrowed card")
		}
	}
}

// Kinetic Soldier: +2000 ATK and DEF only in battles against warriors.
func TestBattleBonusAgainstType(t *testing.T) {
	kinetic := &CardDef{Num: 62, Name: "Kinetic", Kind: KindMonster, Type: "machine", Level: 3, Atk: 1000, Def: 800,
		Effect: &Effect{Op: "battleBonus", Amount: 2000, Types: []string{"warrior"}}}
	cat[62] = kinetic
	defer delete(cat, 62)

	// Attacking a warrior (Grunt, 1200 ATK): 3000 beats it.
	g := duel(t)
	k := put(g, 62, 0, 0, 0, false)
	grunt := put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: k.ID, X: 0, Y: 1})
	if grunt.OnBoard || !k.OnBoard || g.Seats[1].LP != 4000-1800 {
		t.Fatalf("vs warrior: grunt on board %v, kinetic on board %v, LP %d", grunt.OnBoard, k.OnBoard, g.Seats[1].LP)
	}

	// Defending against a warrior: 800+2000 DEF holds off Grunt.
	g = duel(t)
	k = put(g, 62, 1, 0, 1, false)
	k.Defense = true
	grunt = put(g, 1, 0, 0, 0, false)
	must(t, g, 0, Action{Type: ActMove, CardID: grunt.ID, X: 0, Y: 1})
	if !k.OnBoard || g.Seats[0].LP != 4000-1600 {
		t.Fatalf("defending vs warrior: kinetic on board %v, LP %d", k.OnBoard, g.Seats[0].LP)
	}

	// Against anything else it is a plain 1000 ATK monster: Drake (1600) wins.
	g = duel(t)
	k = put(g, 62, 0, 0, 0, false)
	drake := put(g, 2, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: k.ID, X: 0, Y: 1})
	if k.OnBoard || !drake.OnBoard {
		t.Fatal("no bonus against a non-warrior")
	}
}

func TestTeammateIsUntouchedWhenAnAllyFalls(t *testing.T) {
	seats := []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}, {Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}
	g := New(DefaultConfig(9), cat, nil, seats, 1)
	victim, mate := g.Seats[1], g.Seats[3]
	victim.LP = 300
	victim.Graveyard = []int{4}
	lead := victim.Leader

	// One of the victim's cards somewhere, and an attacker next to its leader.
	var spot, near Pos
	for _, d := range orthogonal {
		if p := lead.Add(d.X, d.Y); g.InBounds(p) && g.Board[p] == nil && g.leaderAt(p) == nil {
			if near == (Pos{}) {
				near = p
			} else {
				spot = p
				break
			}
		}
	}
	theirs := put(g, 1, 1, spot.X, spot.Y, true)
	att := put(g, 2, 0, near.X, near.Y, false) // 1600 ATK, far more than 300 LP
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: lead.X, Y: lead.Y})

	if victim.Alive || victim.LP != 0 {
		t.Fatal("the attacked duelist is out")
	}
	if mate.LP != g.Cfg.StartLP {
		t.Fatalf("the leftover damage must vanish: teammate LP %d, want %d", mate.LP, g.Cfg.StartLP)
	}
	if theirs.OnBoard || g.Board[spot] != nil {
		t.Fatal("a fallen duelist's cards leave the field")
	}
	if len(victim.Graveyard) != 1 {
		t.Fatalf("the graveyard stays as it was: %v", victim.Graveyard)
	}
	if g.leaderAt(lead) != nil {
		t.Fatal("a fallen duelist's leader leaves the board")
	}
	if g.Phase != PhasePlaying {
		t.Fatal("the teammate is still playing")
	}
	refuse(t, g, 1, Action{Type: ActEndTurn})
}

func hasAction(g *Game, seat int, typ string, cardID int) bool {
	for _, a := range g.LegalActions(seat) {
		if a.Type == typ && a.CardID == cardID {
			return true
		}
	}
	return false
}

// Revealing a spell or trap (Dark-Piercing Light) does not set it off. A
// revealed spell is cast by moving it; a revealed trap is disarmed and stays
// put; a monster can trample either.
func TestRevealedSpellsAndTraps(t *testing.T) {
	g := duel(t)
	fire := put(g, 21, 1, 2, 2, true)   // their burn spell
	pit := put(g, 30, 1, -2, 2, true)   // their trap: destroys a monster that comes next to it
	jammer := put(g, 33, 1, 3, 3, true) // their trap: cancels our spells
	g.resolve(put(g, 34, 0, 0, -2, false))
	if fire.FaceDown || pit.FaceDown || jammer.FaceDown || !fire.OnBoard || !pit.OnBoard || !jammer.OnBoard {
		t.Fatal("Piercing Light turns their cards face up and leaves them on the field")
	}
	if g.Seats[0].LP != 4000 {
		t.Fatal("revealing their burn spell cast it")
	}

	// A revealed trap is disarmed: our spell goes through the Jammer.
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 21, 0, 1, -3, true).ID})
	if g.Seats[1].LP != 3000 || !jammer.OnBoard {
		t.Fatalf("a revealed Jammer still cancelled a spell (their LP %d)", g.Seats[1].LP)
	}
	// Coming next to a revealed trap is safe.
	walker := put(g, 1, 0, -1, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: walker.ID, X: -2, Y: 1})
	if !walker.OnBoard || !pit.OnBoard {
		t.Fatal("a revealed trap still went off")
	}
	must(t, g, 0, Action{Type: ActEndTurn})

	// Their turn: the revealed spell cannot be flipped, only moved, and moving casts it.
	refuse(t, g, 1, Action{Type: ActFlip, CardID: fire.ID})
	if hasAction(g, 1, ActFlip, fire.ID) || !hasAction(g, 1, ActMove, fire.ID) {
		t.Fatal("a revealed spell is offered as a move, not a flip")
	}
	// A face-up trap does not move.
	if hasAction(g, 1, ActMove, pit.ID) {
		t.Fatal("a face-up trap is offered a move")
	}
	refuse(t, g, 1, Action{Type: ActMove, CardID: pit.ID, X: -3, Y: 2})
	must(t, g, 1, Action{Type: ActMove, CardID: fire.ID, X: 2, Y: 1})
	if g.Seats[0].LP != 3000 || fire.OnBoard {
		t.Fatalf("moving a revealed spell casts it and uses it up (our LP %d)", g.Seats[0].LP)
	}
	// A face-down spell still just moves.
	quiet := put(g, 21, 1, -3, -1, true)
	must(t, g, 1, Action{Type: ActMove, CardID: quiet.ID, X: -3, Y: 0})
	if !quiet.OnBoard || !quiet.FaceDown || g.Seats[0].LP != 3000 {
		t.Fatal("moving a face-down spell cast it")
	}
	must(t, g, 1, Action{Type: ActEndTurn})

	// A monster tramples a revealed trap.
	must(t, g, 0, Action{Type: ActMove, CardID: walker.ID, X: -2, Y: 2})
	if pit.OnBoard || !walker.OnBoard || walker.Pos != (Pos{-2, 2}) {
		t.Fatal("a monster moving onto a revealed trap destroys it and takes the square")
	}

	// A revealed spell that could not be cast does not move at all.
	g = duel(t)
	reborn := put(g, 23, 0, 1, -2, false) // nothing in the graveyards to revive
	if hasAction(g, 0, ActMove, reborn.ID) {
		t.Fatal("a face-up spell that cannot be cast is offered a move")
	}
	refuse(t, g, 0, Action{Type: ActMove, CardID: reborn.ID, X: 1, Y: -1})
}

// A round is everyone still in the duel having one turn.
func TestRoundsCountEveryoneTakingATurn(t *testing.T) {
	g := New(DefaultConfig(7), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	want := []int{1, 1, 2, 2, 3}
	for i, round := range want {
		if g.Round != round || g.TurnCount != i+1 {
			t.Fatalf("turn %d: round %d, want %d", g.TurnCount, g.Round, round)
		}
		must(t, g, g.Turn, Action{Type: ActEndTurn})
	}

	// 2v2 with one duelist knocked out: a round is the three left.
	g = New(DefaultConfig(9), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}, {Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	out := (g.Turn + 2) % 4
	g.Seats[out].Alive = false
	rounds := map[int]int{}
	for range 9 {
		rounds[g.Round]++
		must(t, g, g.Turn, Action{Type: ActEndTurn})
	}
	if rounds[1] != 3 || rounds[2] != 3 || rounds[3] != 3 {
		t.Fatalf("turns per round with a seat out: %v", rounds)
	}
}

// What an opponent may see of a chain played onto a card on the board: a
// power-up into a face-up monster is public; a face-up base is shown but what
// came from the hand, and what it became, are not; a face-down base hides all.
func TestHideChainShowsWhatIsPublic(t *testing.T) {
	chainOf := func(faceDown bool, play int) []ChainStep {
		t.Helper()
		g := duel(t)
		s := g.Seats[0]
		put(g, 1, 0, 0, -2, faceDown)
		c := g.newCard(play, 0)
		s.Hand = append(s.Hand, c)
		g.TakeEvents()
		must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{c.ID}, X: 0, Y: -2})
		for _, e := range g.TakeEvents() {
			if e.Type == "fusionChain" {
				return HideChain(e.Steps)
			}
		}
		t.Fatal("no fusionChain event")
		return nil
	}

	if st := chainOf(false, 22)[0]; st.Base != 1 || st.Add != 22 || st.Result != 1 {
		t.Fatalf("power-up into a face-up monster: %+v", st)
	}
	if st := chainOf(false, 2)[0]; st.Base != 1 || st.Add != HiddenNum || st.Result != HiddenNum {
		t.Fatalf("fusion onto a face-up monster: %+v", st)
	}
	if st := chainOf(true, 22)[0]; st.Base != HiddenNum || st.Add != HiddenNum || st.Result != HiddenNum {
		t.Fatalf("power-up into a face-down monster: %+v", st)
	}
}
