package engine

import "testing"

// Cards for the ability tests, numbered from 100 so they never clash with
// the shared test catalog.
var abilityCat = func() testCatalog {
	c := testCatalog{}
	for num, def := range cat {
		c[num] = def
	}
	n := func(v int) *int { return &v }
	add := func(d *CardDef) { c[d.Num] = d }
	monster := func(num int, name, typ, attr string, atk, def int, abilities ...*Effect) {
		add(&CardDef{Num: num, Name: name, Kind: KindMonster, Type: typ, Attribute: attr, Level: 4, Atk: atk, Def: def, Abilities: abilities})
	}
	monster(100, "Elf", "spellcaster", "light", 800, 2000, &Effect{Op: "boost", On: "flip", Side: "own", Attrs: []string{"light"}, Amount: 800})
	monster(101, "Light Grunt", "warrior", "light", 1000, 1000)
	monster(102, "Dryad", "spellcaster", "earth", 1200, 1400, &Effect{Op: "spellbindFoe", On: "battleFlip", Turns: 1})
	monster(103, "Fiend's Hand", "zombie", "dark", 600, 600, &Effect{Op: "destroyFoe", On: "destroyed"})
	monster(104, "Chakra", "fiend", "dark", 2450, 2000, &Effect{Op: "reviveSelf", On: "destroyed"})
	monster(105, "Castle", "fiend", "dark", 920, 1930, &Effect{Op: "auraBoost", On: "aura", Types: []string{"fiend"}, Amount: 500})
	monster(106, "Binding Chain", "fairy", "light", 1000, 1000, &Effect{Op: "auraBind", On: "aura", Types: []string{"warrior"}})
	monster(107, "Kuriboh", "fiend", "dark", 300, 200, &Effect{Op: "noBattleDamage"})
	monster(108, "Rogue Doll", "spellcaster", "light", 1600, 1000, &Effect{Op: "autoDestroy", Types: []string{"zombie"}})
	monster(109, "Big Zombie", "zombie", "dark", 3000, 3000)
	monster(110, "Hat", "spellcaster", "dark", 1000, 1000, &Effect{Op: "trapImmune"})
	monster(111, "Larva", "insect", "earth", 0, 0, &Effect{Op: "immobile"}, &Effect{Op: "evolve", On: "turn", Turns: 2, Summon: n(112)})
	monster(112, "Pupa", "insect", "earth", 0, 0)
	monster(113, "Temple", "zombie", "dark", 900, 1300, &Effect{Op: "noSpells", On: "aura"})
	monster(114, "Hourglass", "fairy", "light", 700, 600, &Effect{Op: "massRevive", On: "destroyed", MinLP: 1000, Count: 4, Cost: 1000})
	monster(115, "Egg", "warrior", "earth", 600, 900, &Effect{Op: "imitate", Types: []string{"dragon"}})
	monster(116, "Leghul", "insect", "earth", 300, 350, &Effect{Op: "teleport", On: "flip", Side: "enemy"})
	monster(117, "Dimensional Warrior", "warrior", "earth", 1200, 1000, &Effect{Op: "banish"})
	monster(118, "Moth Larva", "insect", "earth", 500, 400, &Effect{Op: "reviveSelf", On: "anyDestroy"})
	monster(119, "Sphere", "machine", "dark", 1400, 1400, &Effect{Op: "blastOnDestroy"})
	monster(120, "Beastking", "aqua", "water", 1000, 1100, &Effect{Op: "destroyFoe", On: "anyDestroy"})

	add(&CardDef{Num: 150, Name: "Raigeki", Kind: KindSpell, Effect: &Effect{Op: "destroyCross"}})
	add(&CardDef{Num: 151, Name: "Dark Hole", Kind: KindSpell, Effect: &Effect{Op: "destroyAll"}})
	add(&CardDef{Num: 152, Name: "Copycat", Kind: KindSpell, Effect: &Effect{Op: "reviveCard", Side: "enemy", Kinds: []string{"spell"}}})
	add(&CardDef{Num: 153, Name: "Insect Imitation", Kind: KindSpell, Effect: &Effect{Op: "imitation"}})
	add(&CardDef{Num: 154, Name: "Eye of Truth", Kind: KindSpell, Effect: &Effect{Op: "peekHand"}})
	add(&CardDef{Num: 155, Name: "Creature Swap", Kind: KindSpell, Effect: &Effect{Op: "creatureSwap"}})
	add(&CardDef{Num: 156, Name: "Sword of Dragon's Soul", Kind: KindSpell, Effect: &Effect{Op: "equip", Types: []string{"warrior"}, Grant: []*Effect{{Op: "autoDestroy", Types: []string{"dragon"}}}}})
	add(&CardDef{Num: 160, Name: "Anti Raigeki", Kind: KindTrap, Effect: &Effect{Op: "trapJam", Trigger: "spell", Range: "full", Nums: []int{150}, Permanent: true}})
	add(&CardDef{Num: 161, Name: "White Hole", Kind: KindTrap, Effect: &Effect{Op: "trapShield", Trigger: "spell", Range: "full", Nums: []int{151}, Permanent: true}})
	add(&CardDef{Num: 162, Name: "Simochi", Kind: KindTrap, Effect: &Effect{Op: "trapBackfire", Trigger: "heal", Range: "full", Permanent: true}})
	add(&CardDef{Num: 163, Name: "Reverse Trap", Kind: KindTrap, Effect: &Effect{Op: "trapReverse", Trigger: "powerUp", Range: "full", Permanent: true}})
	add(&CardDef{Num: 164, Name: "Gorgon's Eye", Kind: KindTrap, Effect: &Effect{Op: "trapGorgon", Trigger: "defense", Range: "limited", Permanent: true}})
	add(&CardDef{Num: 165, Name: "Royal Decree", Kind: KindTrap, Effect: &Effect{Op: "trapDecree", Trigger: "trap", Range: "full", Permanent: true}})
	return c
}()

func abilityDuel(t *testing.T) *Game {
	t.Helper()
	g := New(DefaultConfig(7), abilityCat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	g.TakeEvents()
	return g
}

func pass(t *testing.T, g *Game) {
	t.Helper()
	must(t, g, g.Turn, Action{Type: ActEndTurn})
}

func TestFlipBoostReachesOnlyItsSide(t *testing.T) {
	g := abilityDuel(t)
	elf := put(g, 100, 0, 0, 0, true)
	mine := put(g, 101, 0, 1, 0, false)
	theirs := put(g, 101, 1, 2, 2, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: elf.ID})
	if mine.AtkMod != 800 || elf.AtkMod != 800 || theirs.AtkMod != 0 {
		t.Fatalf("boosts: mine %d, elf %d, theirs %d", mine.AtkMod, elf.AtkMod, theirs.AtkMod)
	}
}

func TestBattleFlipSpellbindStopsTheAttack(t *testing.T) {
	g := abilityDuel(t)
	att := put(g, 3, 0, 0, 0, false)
	dryad := put(g, 102, 1, 0, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if !att.OnBoard || !dryad.OnBoard || att.Spellbound != 1 || att.Pos != (Pos{0, 0}) {
		t.Fatalf("attacker should be spellbound where it stood: %+v / dryad on board %v", att, dryad.OnBoard)
	}
}

func TestDestroyedAbilities(t *testing.T) {
	g := abilityDuel(t)
	att := put(g, 3, 0, 0, 0, false)
	put(g, 103, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if att.OnBoard {
		t.Fatal("Fiend's Hand takes its killer with it")
	}

	g = abilityDuel(t)
	att = put(g, 3, 0, 0, 0, false)
	chakra := put(g, 104, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	revived := 0
	for _, c := range g.Board {
		if c.Def.Num == 104 && c != chakra {
			revived++
			if c.Pos.Ring(g.Seats[1].Leader) != 1 {
				t.Fatalf("Chakra should come back next to its leader, not at %v", c.Pos)
			}
		}
	}
	if revived != 1 || len(g.Seats[1].Graveyard) != 0 {
		t.Fatalf("Chakra revived %d times, graveyard %v", revived, g.Seats[1].Graveyard)
	}
}

// "When destroyed" abilities (anyDestroy) go off whatever destroys the card;
// "destroyed in battle" ones (destroyed, blastOnDestroy) only in a battle.
func TestDestroyedBySpell(t *testing.T) {
	g := abilityDuel(t)
	larva := put(g, 118, 1, 2, 2, false)
	chakra := put(g, 104, 1, -2, 2, false)
	sphere := put(g, 119, 1, 2, -2, false)
	put(g, 120, 1, -2, -2, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 151, 0, 0, 0, true).ID})
	if larva.OnBoard || chakra.OnBoard || sphere.OnBoard {
		t.Fatal("Dark Hole destroys every monster")
	}
	revived := map[int]int{}
	for _, c := range g.Board {
		revived[c.Def.Num]++
	}
	if revived[118] != 1 {
		t.Fatalf("a When destroyed card revives after a spell too: board %v", revived)
	}
	if revived[104] != 0 {
		t.Fatalf("a destroyed in battle card does not revive after a spell: board %v", revived)
	}
	for _, e := range g.TakeEvents() {
		if e.Type == "blast" {
			t.Fatal("a sphere destroyed by a spell does not blast")
		}
	}

	// In battle the same card's ability still goes off.
	g = abilityDuel(t)
	att := put(g, 3, 0, 0, 0, false)
	put(g, 118, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	n := 0
	for _, c := range g.Board {
		if c.Def.Num == 118 {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("a When destroyed card revives after a battle: %d on the board", n)
	}
}

func TestHourglassOfLifeRevivesTheStrongest(t *testing.T) {
	g := abilityDuel(t)
	g.Seats[0].Graveyard = []int{1, 3, 4}
	g.Seats[1].Graveyard = []int{9, 2}
	att := put(g, 3, 0, 0, 0, false)
	put(g, 114, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	got := map[int]bool{}
	for _, c := range g.Board {
		if c.Owner == 1 {
			got[c.Def.Num] = true
		}
	}
	// The four strongest monsters in any graveyard: Titan (3000), Drake
	// Knight (2400), Drake (1600), Grunt (1200). Hourglass itself (700) is not.
	for _, num := range []int{3, 9, 2, 1} {
		if !got[num] {
			t.Fatalf("card %d should have been revived for seat 1: %v", num, got)
		}
	}
	if lp := g.Seats[1].LP; lp != 4000-2300-1000 {
		t.Fatalf("seat 1 has %d LP", lp)
	}
}

func TestAurasNeedFaceUpDefense(t *testing.T) {
	g := abilityDuel(t)
	castle := put(g, 105, 1, 2, 2, false)
	fiend := put(g, 104, 0, 1, 0, false)
	if g.here(fiend) != 2450 {
		t.Fatal("an aura in attack position does nothing")
	}
	castle.Defense = true
	if g.here(fiend) != 2950 {
		t.Fatalf("Castle should power up every fiend: %d", g.here(fiend))
	}

	chain := put(g, 106, 1, -2, 2, false)
	chain.Defense = true
	warrior := put(g, 101, 0, -1, 0, false)
	if err := g.Apply(0, Action{Type: ActMove, CardID: warrior.ID, X: -1, Y: 1}); err == nil {
		t.Fatal("Binding Chain holds every warrior")
	}
	if v := g.ViewFor(0); v.Cards[len(v.Cards)-1].Spellbound != -1 {
		t.Fatal("the view shows the warrior held")
	}
}

func TestTempleOfSkullsStopsSpells(t *testing.T) {
	g := abilityDuel(t)
	temple := put(g, 113, 1, 2, 2, false)
	temple.Defense = true
	refuse(t, g, 0, Action{Type: ActFlip, CardID: put(g, 21, 0, 1, -2, true).ID})
}

func TestKuribohTakesNoBattleDamage(t *testing.T) {
	g := abilityDuel(t)
	k := put(g, 107, 0, 0, 0, false)
	put(g, 3, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: k.ID, X: 0, Y: 1})
	if g.Seats[0].LP != 4000 || k.OnBoard {
		t.Fatalf("LP %d, Kuriboh still on board %v", g.Seats[0].LP, k.OnBoard)
	}
}

func TestAutoDestroyAndBanish(t *testing.T) {
	g := abilityDuel(t)
	doll := put(g, 108, 0, 0, 0, false)
	put(g, 109, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: doll.ID, X: 0, Y: 1})
	if !doll.OnBoard || doll.Pos != (Pos{0, 1}) || g.Seats[0].LP != 4000 {
		t.Fatal("Rogue Doll destroys a zombie of any strength")
	}

	g = abilityDuel(t)
	dw := put(g, 117, 0, 0, 0, false)
	put(g, 4, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: dw.ID, X: 0, Y: 1})
	if len(g.Seats[1].Graveyard) != 0 {
		t.Fatalf("a monster Dimensional Warrior beats never reaches the graveyard: %v", g.Seats[1].Graveyard)
	}
}

func TestTrapImmuneWalksPastLimitedTraps(t *testing.T) {
	g := abilityDuel(t)
	hat := put(g, 110, 0, 0, 0, false)
	trap := put(g, 31, 1, 1, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: hat.ID, X: 0, Y: 1})
	if !trap.OnBoard || hat.Spellbound != 0 {
		t.Fatal("the hat should slip past the trap")
	}
}

func TestEvolveAfterTurnsInDefense(t *testing.T) {
	g := abilityDuel(t)
	larva := put(g, 111, 0, 1, -2, true)
	if len(g.MoveTargets(larva)) != 0 {
		t.Fatal("Larva cannot move")
	}
	must(t, g, 0, Action{Type: ActPosition, CardID: larva.ID, Defense: true, Flip: true})
	pass(t, g)
	pass(t, g) // first turn face up in defense
	if larva.Def.Num != 111 {
		t.Fatal("too early")
	}
	pass(t, g)
	pass(t, g) // second
	if larva.Def.Num != 112 {
		t.Fatalf("Larva should have evolved, is %s", larva.Def.Name)
	}
}

func TestTeleportOnFlipCancelsTheBattle(t *testing.T) {
	g := abilityDuel(t)
	att := put(g, 3, 0, 0, 0, false)
	leghul := put(g, 116, 1, 0, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if !leghul.OnBoard || leghul.Pos.Ring(g.Seats[0].Leader) != 1 || att.Pos != (Pos{0, 0}) {
		t.Fatalf("Leghul should have fled to seat 0's summoning area: leghul %v, attacker %v", leghul.Pos, att.Pos)
	}
}

func TestCounterTraps(t *testing.T) {
	g := abilityDuel(t)
	anti := put(g, 160, 1, 2, 2, true)
	victim := put(g, 1, 1, 1, 0, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 150, 0, 0, 0, true).ID})
	if !victim.OnBoard || !anti.OnBoard || anti.FaceDown {
		t.Fatal("Anti Raigeki cancels Raigeki and stays on the field")
	}
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 21, 0, 1, -2, true).ID})
	if g.Seats[1].LP != 3000 {
		t.Fatal("Anti Raigeki only answers Raigeki")
	}

	g = abilityDuel(t)
	put(g, 161, 1, 2, 2, true)
	theirs := put(g, 1, 1, 1, 1, false)
	mine := put(g, 1, 0, -1, -1, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 151, 0, 0, 0, true).ID})
	if !theirs.OnBoard || mine.OnBoard {
		t.Fatal("White Hole saves only its own side from Dark Hole")
	}

	g = abilityDuel(t)
	put(g, 165, 1, 2, 2, true)
	trap := put(g, 31, 0, 1, 1, true)
	mover := put(g, 1, 1, 1, 2, false)
	g.Turn = 1
	must(t, g, 1, Action{Type: ActMove, CardID: mover.ID, X: 0, Y: 2})
	if !trap.OnBoard || mover.Spellbound != 0 {
		t.Fatal("Royal Decree stops enemy traps")
	}
}

func TestPermanentTrapsAgainstHealingAndPowerUps(t *testing.T) {
	g := abilityDuel(t)
	put(g, 162, 1, 2, 2, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 20, 0, 0, 0, true).ID})
	must(t, g, 0, Action{Type: ActEndTurn})
	if g.Seats[0].LP != 3500 {
		t.Fatalf("Simochi turns the heal into damage: %d", g.Seats[0].LP)
	}

	g = abilityDuel(t)
	put(g, 163, 1, 2, 2, true)
	grunt := put(g, 1, 0, 0, -2, false)
	sword := g.newCard(22, 0)
	g.Seats[0].Hand = append(g.Seats[0].Hand, sword)
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{sword.ID}, X: 0, Y: -2})
	if grunt.AtkMod != -500 {
		t.Fatalf("Reverse Trap turns the equip around: %d", grunt.AtkMod)
	}
}

func TestGorgonsEye(t *testing.T) {
	g := abilityDuel(t)
	put(g, 164, 1, 1, 1, true)
	m := put(g, 1, 0, 0, 0, false)
	must(t, g, 0, Action{Type: ActPosition, CardID: m.ID, Defense: true})
	if m.Spellbound != -1 {
		t.Fatal("Gorgon's Eye binds a monster that goes into defense next to it")
	}
}

func TestCopycatCastsAnEnemySpell(t *testing.T) {
	g := abilityDuel(t)
	g.Seats[1].Graveyard = []int{21}
	g.Seats[0].Graveyard = []int{20}
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 152, 0, 0, 0, true).ID})
	if g.Pending == nil || len(g.Pending.Options) != 1 {
		t.Fatalf("only the enemy's spell is on offer: %+v", g.Pending)
	}
	must(t, g, 0, Action{Type: ActChoose, Choice: 0})
	if g.Seats[1].LP != 3000 {
		t.Fatalf("the copied Fire burns the enemy: %d", g.Seats[1].LP)
	}
}

func TestInsectImitationAndGrantedPowers(t *testing.T) {
	g := abilityDuel(t)
	egg := put(g, 115, 0, 0, -2, false)
	imitation := g.newCard(153, 0)
	g.Seats[0].Hand = append(g.Seats[0].Hand, imitation)
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{imitation.ID}, X: 0, Y: -2})
	if egg.Def.Type != "dragon" {
		t.Fatalf("the egg should hatch into a dragon, is %s", egg.Def.Name)
	}

	g = abilityDuel(t)
	grunt := put(g, 1, 0, 0, -2, false)
	sword := g.newCard(156, 0)
	g.Seats[0].Hand = append(g.Seats[0].Hand, sword)
	must(t, g, 0, Action{Type: ActSummon, CardIDs: []int{sword.ID}, X: 0, Y: -2})
	put(g, 9, 1, 0, -1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: grunt.ID, X: 0, Y: -1})
	if !grunt.OnBoard || grunt.Pos != (Pos{0, -1}) {
		t.Fatal("Sword of Dragon's Soul lets a warrior destroy any dragon")
	}
}

func TestEyeOfTruthShowsHandsForTheTurn(t *testing.T) {
	g := abilityDuel(t)
	g.draw(g.Seats[1])
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 154, 0, 0, 0, true).ID})
	if v := g.ViewFor(0); len(v.Peek) != 1 || len(v.Peek[0].Cards) != 1 {
		t.Fatalf("seat 0 sees seat 1's hand: %+v", v.Peek)
	}
	if v := g.ViewFor(1); len(v.Peek) != 0 {
		t.Fatal("only the caster sees")
	}
	pass(t, g)
	if v := g.ViewFor(0); len(v.Peek) != 0 {
		t.Fatal("only for the turn")
	}
}

func TestCreatureSwapMirrorsTheField(t *testing.T) {
	g := abilityDuel(t)
	a := put(g, 1, 0, 1, -1, false)
	b := put(g, 2, 1, 2, 3, false)
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 155, 0, 0, 0, true).ID})
	if a.Pos != (Pos{-1, 1}) || b.Pos != (Pos{-2, -3}) {
		t.Fatalf("a at %v, b at %v", a.Pos, b.Pos)
	}
}
