package engine

import "testing"

// A monster whose flip raises its own ATK fights with the raised ATK, however
// it was turned face up: flipped as part of the attack, flipped first, or
// turned face up with a position change; and when it is the face-down
// defender, revealed by the attack.
func TestFlipBoostCountsInTheBattle(t *testing.T) {
	const booster = 9101
	c := testCatalog{}
	for k, v := range cat {
		c[k] = v
	}
	c[booster] = &CardDef{Num: booster, Name: "Booster", Kind: KindMonster, Type: "warrior", Level: 3, Atk: 1000, Def: 1000,
		Abilities: []*Effect{{Op: "boost", On: "flip", Side: "own", Amount: 1000}}}
	game := func() *Game {
		return New(DefaultConfig(7), c, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	}

	for _, how := range []string{"flip with the move", "flip first", "position and flip"} {
		g := game()
		b := put(g, booster, 0, 0, 0, true)
		b.Defense = true
		drake := put(g, 2, 1, 0, 1, false) // 1600 ATK, attack position
		switch how {
		case "flip with the move":
			must(t, g, 0, Action{Type: ActMove, CardID: b.ID, X: 0, Y: 1, Flip: true})
		case "flip first":
			must(t, g, 0, Action{Type: ActFlip, CardID: b.ID})
			must(t, g, 0, Action{Type: ActMove, CardID: b.ID, X: 0, Y: 1})
		case "position and flip":
			must(t, g, 0, Action{Type: ActPosition, CardID: b.ID, Defense: false, Flip: true})
			must(t, g, 0, Action{Type: ActMove, CardID: b.ID, X: 0, Y: 1})
		}
		if drake.OnBoard || !b.OnBoard || g.Board[Pos{0, 1}] != b {
			t.Fatalf("%s: the boosted 2000 ATK Booster should beat the 1600 ATK Drake (Booster ATK %d, on board %v)", how, g.here(b), b.OnBoard)
		}
	}

	// Face down in attack position, revealed by the attack: it defends with the boost.
	g := game()
	b := put(g, booster, 1, 0, 1, true)
	drake := put(g, 2, 0, 0, 0, false)
	must(t, g, 0, Action{Type: ActMove, CardID: drake.ID, X: 0, Y: 1})
	if drake.OnBoard || !b.OnBoard {
		t.Fatalf("defender: the boosted Booster (%d ATK) should beat the attacking Drake", g.here(b))
	}
}
