package engine

import "testing"

const relinquished = 120

var absorbCat = func() testCatalog {
	c := testCatalog{}
	for num, def := range abilityCat {
		c[num] = def
	}
	c[relinquished] = &CardDef{Num: relinquished, Name: "Relinquished", Kind: KindMonster, Type: "spellcaster", Attribute: "dark",
		Level: 1, Abilities: []*Effect{{Op: "absorb"}}}
	return c
}()

func absorbDuel(t *testing.T) *Game {
	t.Helper()
	g := New(DefaultConfig(7), absorbCat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	g.TakeEvents()
	return g
}

func choose(t *testing.T, g *Game, label string) {
	t.Helper()
	p := g.Pending
	if p == nil || p.Kind != "absorb" {
		t.Fatalf("no absorb offer: %+v", p)
	}
	for i, o := range p.Options {
		if o.Label == label {
			must(t, g, p.Seat, Action{Type: ActChoose, Choice: i})
			return
		}
	}
	t.Fatalf("no option %q in %+v", label, p.Options)
}

func TestRelinquishedAbsorbsTheChosenNeighbour(t *testing.T) {
	g := absorbDuel(t)
	rel := put(g, relinquished, 0, 0, 0, false)
	zombie := put(g, 109, 1, 1, 1, false) // diagonal counts
	grunt := put(g, 101, 1, 0, -1, false)
	far := put(g, 109, 1, 0, 2, false) // two squares away: out of reach
	g.settle()

	p := g.Pending
	if p == nil || len(p.Options) != 3 || p.Options[0].Label != "Big Zombie (ATK 3000) at (1, 1)" || p.Options[2].Label != "Don't absorb" {
		t.Fatalf("offer: %+v", p)
	}
	choose(t, g, p.Options[0].Label)
	if zombie.OnBoard || rel.Absorbed != zombie || g.here(rel) != 3000 || g.def(rel, "") != 3000 {
		t.Fatalf("after absorbing: zombie on board %v, absorbed %v, atk %d", zombie.OnBoard, rel.Absorbed, g.here(rel))
	}
	if g.Pending != nil {
		t.Fatalf("offered twice in one turn: %+v", g.Pending)
	}
	if !grunt.OnBoard || !far.OnBoard {
		t.Fatal("other monsters were taken")
	}
}

func TestAbsorbedMonsterDiesInRelinquishedsPlace(t *testing.T) {
	g := absorbDuel(t)
	rel := put(g, relinquished, 0, 0, 0, false)
	grunt := put(g, 101, 1, 0, 1, false)
	g.settle()
	choose(t, g, "Light Grunt (ATK 1000) at (0, 1)")
	pass(t, g)

	zombie := put(g, 109, 1, 0, 1, false)
	must(t, g, 1, Action{Type: ActMove, CardID: zombie.ID, X: 0, Y: 0})
	if !rel.OnBoard || rel.Absorbed != nil || g.here(rel) != 0 {
		t.Fatalf("Relinquished: on board %v, absorbed %v, atk %d", rel.OnBoard, rel.Absorbed, g.here(rel))
	}
	if gy := g.Seats[1].Graveyard; len(gy) != 1 || gy[0] != grunt.Def.Num {
		t.Fatalf("seat 1 graveyard %v, want the absorbed grunt", gy)
	}
	if zombie.Pos != (Pos{0, 1}) {
		t.Fatalf("the attacker took Relinquished's square: at %v", zombie.Pos)
	}
	// Unshielded now, it falls to the next attack.
	pass(t, g)
	if g.Pending != nil {
		choose(t, g, "Don't absorb")
	}
	pass(t, g)
	must(t, g, 1, Action{Type: ActMove, CardID: zombie.ID, X: 0, Y: 0})
	if rel.OnBoard {
		t.Fatal("Relinquished survived with nothing absorbed")
	}
}

func TestDecliningWaitsForTheNextTurn(t *testing.T) {
	g := absorbDuel(t)
	rel := put(g, relinquished, 0, 0, 0, false)
	put(g, 101, 1, 0, 1, false)
	g.settle()
	choose(t, g, "Don't absorb")
	if g.Pending != nil || rel.Absorbed != nil {
		t.Fatalf("declined, yet pending %+v absorbed %v", g.Pending, rel.Absorbed)
	}
	// A new enemy in reach is a new offer.
	put(g, 109, 1, -1, -1, false)
	g.settle()
	if g.Pending == nil || len(g.Pending.Options) != 3 {
		t.Fatalf("no offer for the new neighbour: %+v", g.Pending)
	}
	choose(t, g, "Don't absorb")
	pass(t, g)
	if g.Pending != nil {
		t.Fatalf("offered on the enemy's turn: %+v", g.Pending)
	}
	pass(t, g)
	if g.Pending == nil || g.Pending.Seat != 0 {
		t.Fatalf("no offer on its next turn: %+v", g.Pending)
	}
}

func TestAbsorbedMonsterGoesToTheGraveyardWithRelinquished(t *testing.T) {
	g := absorbDuel(t)
	rel := put(g, relinquished, 0, 0, 0, false)
	put(g, 101, 1, 0, 1, false)
	g.settle()
	choose(t, g, "Light Grunt (ATK 1000) at (0, 1)")
	g.bury(rel, "spell", 1)
	if gy := g.Seats[1].Graveyard; len(gy) != 1 || gy[0] != 101 {
		t.Fatalf("seat 1 graveyard %v", gy)
	}
	if gy := g.Seats[0].Graveyard; len(gy) != 1 || gy[0] != relinquished {
		t.Fatalf("seat 0 graveyard %v", gy)
	}
}
