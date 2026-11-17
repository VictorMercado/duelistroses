package engine

import "testing"

// teams is a 2v2 game: seats 0 and 2 against seats 1 and 3. Seat 0's leader
// stands at (0,-4).
func teams(t *testing.T) *Game {
	t.Helper()
	seats := []SeatSetup{{Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}, {Team: 0, Deck: deckOf(1)}, {Team: 1, Deck: deckOf(1)}}
	return New(DefaultConfig(9), cat, nil, seats, 1)
}

func TestHealAnAlly(t *testing.T) {
	g := teams(t)
	g.Seats[2].LP = 1000
	medicine := put(g, 20, 0, 0, -3, true)
	must(t, g, 0, Action{Type: ActFlip, CardID: medicine.ID})
	p := g.Pending
	if p == nil || p.Kind != "heal" || len(p.Options) != 2 || *p.Options[0].Seat != 0 || *p.Options[1].Seat != 2 {
		t.Fatalf("a heal with a living ally asks whose LP to restore: %+v", p)
	}
	must(t, g, 0, Action{Type: ActChoose, Choice: 1})
	if g.Seats[2].LP != 1500 || g.Seats[0].LP != 4000 || medicine.OnBoard {
		t.Fatalf("the ally is healed: ally %d, caster %d", g.Seats[2].LP, g.Seats[0].LP)
	}

	// With the ally out, the caster is healed at once.
	g = teams(t)
	g.Seats[0].LP = 1000
	must(t, g, 2, Action{Type: ActConcede})
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 20, 0, 0, -3, true).ID})
	if g.Pending != nil || g.Seats[0].LP != 1500 {
		t.Fatal("no choice without a living ally")
	}

	// 1v1 is unchanged.
	g = duel(t)
	g.Seats[0].LP = 1000
	must(t, g, 0, Action{Type: ActFlip, CardID: put(g, 20, 0, 0, 0, true).ID})
	if g.Pending != nil || g.Seats[0].LP != 1500 {
		t.Fatal("a duel heals the caster without asking")
	}
}

func TestPowerUpAnAllysMonster(t *testing.T) {
	g := teams(t)
	ally := put(g, 1, 2, 0, -2, false)
	sword := put(g, 22, 0, 0, -3, true)
	must(t, g, 0, Action{Type: ActMove, CardID: sword.ID, X: 0, Y: -2})
	if g.here(ally) != 1700 || ally.Owner != 2 || sword.OnBoard || g.Board[Pos{0, -2}] != ally {
		t.Fatalf("an equip moved onto an ally's monster powers it up: ATK %d", g.here(ally))
	}
	if g.Seats[0].Stats.Equips != 1 {
		t.Fatal("the power-up counts for whoever gave it")
	}

	// Two monsters with no recipe: an ally's is never knocked out.
	g = teams(t)
	put(g, 1, 2, 0, -2, false)
	wall := put(g, 4, 0, 0, -3, false)
	refuse(t, g, 0, Action{Type: ActMove, CardID: wall.ID, X: 0, Y: -2})

	// From the hand, onto an ally's monster next to the leader.
	g = teams(t)
	ally = put(g, 1, 2, 1, -3, false)
	s := g.Seats[0]
	hand := g.newCard(22, 0)
	s.Hand = append(s.Hand, hand)
	wallCard := g.newCard(4, 0)
	s.Hand = append(s.Hand, wallCard)
	refuse(t, g, 0, Action{Type: ActSummon, CardID: wallCard.ID, X: 1, Y: -3})
	must(t, g, 0, Action{Type: ActSummon, CardID: hand.ID, X: 1, Y: -3})
	if g.here(ally) != 1700 || ally.Owner != 2 || g.Board[Pos{1, -3}] != ally {
		t.Fatalf("an equip played onto an ally's monster: ATK %d", g.here(ally))
	}

}

func TestFuseWithAnAllyMakesASharedMonster(t *testing.T) {
	g := teams(t)
	put(g, 1, 2, 0, -2, false)
	drake := put(g, 2, 0, 0, -3, false)
	must(t, g, 0, Action{Type: ActMove, CardID: drake.ID, X: 0, Y: -2})
	fused := g.Board[Pos{0, -2}]
	if fused == nil || fused.Def.Num != 9 || !fused.Shared || fused.Owner != 0 {
		t.Fatalf("an ally's monster and ours fuse into a shared monster: %+v", fused)
	}
	if !g.ViewFor(2).Cards[0].Shared {
		t.Fatal("the view marks it shared")
	}

	// On the ally's turn it is theirs to move, then ours again.
	must(t, g, 0, Action{Type: ActEndTurn})
	must(t, g, 1, Action{Type: ActEndTurn})
	if fused.Owner != 2 || fused.Acted {
		t.Fatalf("the shared monster passes to the teammate taking its turn: owner %d", fused.Owner)
	}
	must(t, g, 2, Action{Type: ActMove, CardID: fused.ID, X: 0, Y: -1})
	must(t, g, 2, Action{Type: ActEndTurn})
	must(t, g, 3, Action{Type: ActEndTurn})
	if fused.Owner != 0 || fused.Acted {
		t.Fatal("and comes back on our turn")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: fused.ID, X: 0, Y: 0})

	// A teammate going out leaves it with the one still playing.
	must(t, g, 0, Action{Type: ActConcede})
	if !fused.OnBoard || fused.Owner != 2 || fused.Home != 2 {
		t.Fatal("the shared monster stays with the surviving teammate")
	}
}

func TestFuseFromHandOntoAnAlly(t *testing.T) {
	g := teams(t)
	put(g, 1, 2, 1, -3, false)
	s := g.Seats[0]
	drake := g.newCard(2, 0)
	s.Hand = append(s.Hand, drake)
	must(t, g, 0, Action{Type: ActSummon, CardID: drake.ID, X: 1, Y: -3})
	fused := g.Board[Pos{1, -3}]
	if fused == nil || fused.Def.Num != 9 || !fused.Shared || fused.Owner != 0 {
		t.Fatalf("a monster played from the hand fuses with the ally's: %+v", fused)
	}
}

// In a 2v2 the monster limit is the team's: 10, however its two duelists
// split them, so one may hold more than 5 while the other holds fewer.
func TestTeamMonsterLimit(t *testing.T) {
	g := New(DefaultConfig(7), cat, nil, []SeatSetup{{Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}, {Team: 0, Deck: deckOf(1, 2)}, {Team: 1, Deck: deckOf(1, 2)}}, 1)
	ally := put(g, 1, 2, 0, 0, false) // Grunt + Morph fuse
	morph := put(g, 60, 0, 0, -1, true) // face down: moved, not cast
	for i := 0; i < 5; i++ {
		put(g, 4, 0, i-2, -2, false)
	}
	if g.monstersFull(0) {
		t.Fatal("a team with 6 monsters has room for 10")
	}
	if _, ok := g.MoveTargets(morph)[ally.Pos]; !ok {
		t.Fatal("a spell fuses into a teammate's monster even when we hold 5")
	}
	must(t, g, 0, Action{Type: ActMove, CardID: morph.ID, X: 0, Y: 0})
	if n := g.countOnBoard(0, true); n != 6 {
		t.Fatalf("seat 0 should now hold 6 monsters, has %d", n)
	}
	for i := 0; i < 4; i++ {
		put(g, 4, 2, i-2, 1, false)
	}
	if !g.monstersFull(0) || !g.monstersFull(2) {
		t.Fatal("a team with 10 monsters is full")
	}
	if g.monstersFull(1) {
		t.Fatal("the other team's room is its own")
	}
}
