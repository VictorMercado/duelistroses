package engine

import (
	"math/rand"
	"testing"
)

// Destiny cards for the tests, numbered well clear of the shared catalog.
const (
	dCure    = 9001 // Dian Keto: LP back to 4000
	dRaigeki = 9002 // destroys monsters in a cross
	dBug     = 9003 // Arsenal Bug: strong under an Insect leader
	dSprite  = 9004 // Woodland Sprite: strong against Fiends
	dInsect  = 9005 // an Insect to lead with
	dFiend   = 9006
)

var destinyCat = func() testCatalog {
	c := testCatalog{}
	for k, v := range cat {
		c[k] = v
	}
	c[dCure] = &CardDef{Num: dCure, Name: "Cure", Kind: KindSpell, Effect: &Effect{Op: "healTo", Amount: 4000}}
	c[dRaigeki] = &CardDef{Num: dRaigeki, Name: "Bolt", Kind: KindSpell, Effect: &Effect{Op: "destroyCross"}}
	c[dBug] = &CardDef{Num: dBug, Name: "Bug", Kind: KindMonster, Type: "insect", Atk: 2000, Def: 2000,
		Abilities: []*Effect{{Op: "boostIfLeader", On: "flip", Types: []string{"insect"}, Amount: 1500}}}
	c[dSprite] = &CardDef{Num: dSprite, Name: "Sprite", Kind: KindMonster, Type: "plant", Atk: 2100, Def: 2100,
		Abilities: []*Effect{{Op: "battleBonus", Types: []string{"fiend"}, Amount: 2500}}}
	c[dInsect] = &CardDef{Num: dInsect, Name: "Beetle", Kind: KindMonster, Type: "insect", Atk: 1000, Def: 1000}
	c[dFiend] = &CardDef{Num: dFiend, Name: "Imp", Kind: KindMonster, Type: "fiend", Atk: 1000, Def: 1000}
	return c
}()

var destinyPool = []int{dCure, dRaigeki, dBug, dSprite}

func destinyDuel(t *testing.T, leader int) *Game {
	t.Helper()
	cfg := DefaultConfig(7)
	cfg.DestinyPool = destinyPool
	return New(cfg, destinyCat, nil, []SeatSetup{
		{Team: 0, Deck: deckOf(1, 2), Leader: leader},
		{Team: 1, Deck: deckOf(1, 2)},
	}, 1)
}

// pickMost runs pickDestiny many times and returns the card it gave most.
func pickMost(g *Game, s *Seat) int {
	rng := rand.New(rand.NewSource(7))
	counts := map[int]int{}
	for i := 0; i < 400; i++ {
		counts[g.pickDestiny(s, rng)]++
	}
	best, most := 0, -1
	for num, n := range counts {
		if n > most {
			best, most = num, n
		}
	}
	return best
}

func TestDestinyPicksWhatHelpsMost(t *testing.T) {
	// Critically low LP: the cure.
	g := destinyDuel(t, 0)
	g.Seats[0].LP = 600
	if got := pickMost(g, g.Seats[0]); got != dCure {
		t.Fatalf("on 600 LP got %d, want the cure", got)
	}

	// An Insect leader: Arsenal Bug.
	g = destinyDuel(t, dInsect)
	if got := pickMost(g, g.Seats[0]); got != dBug {
		t.Fatalf("under an insect leader got %d, want the bug", got)
	}

	// A row of enemy monsters: Raigeki.
	g = destinyDuel(t, 0)
	for x := -2; x <= 2; x++ {
		put(g, 1, 1, x, 1, false)
	}
	if got := pickMost(g, g.Seats[0]); got != dRaigeki {
		t.Fatalf("against five in a row got %d, want the bolt", got)
	}

	// Enemy fiends: Woodland Sprite.
	g = destinyDuel(t, 0)
	put(g, dFiend, 1, -2, 1, false)
	put(g, dFiend, 1, 0, 2, false)
	if got := pickMost(g, g.Seats[0]); got != dSprite {
		t.Fatalf("against fiends got %d, want the sprite", got)
	}

	// Full LP: the cure does nothing, so it is never given.
	g = destinyDuel(t, 0)
	rng := rand.New(rand.NewSource(3))
	for i := 0; i < 200; i++ {
		if g.pickDestiny(g.Seats[0], rng) == dCure {
			t.Fatal("the cure was given on full LP")
		}
	}
}

func TestDestinyOddsFollowTroubleAndRank(t *testing.T) {
	g := destinyDuel(t, 0)
	s := g.Seats[0]
	if odds := g.destinyOdds(s); odds != 0 {
		t.Fatalf("a rank 1 duelist doing fine has odds %v, want 0", odds)
	}
	s.Rank = MaxRank
	if odds := g.destinyOdds(s); odds != 0 {
		t.Fatalf("a duelist above half their LP has odds %v, want 0, whatever their rank", odds)
	}
	s.Rank = 1
	s.LP = g.Cfg.StartLP / 2
	half := g.destinyOdds(s)
	if half <= 0 {
		t.Fatal("at half LP there should be some chance")
	}
	s.LP = 500
	low := g.destinyOdds(s)
	if low <= half {
		t.Fatalf("low LP odds %v should beat half LP %v", low, half)
	}
	s.LP = g.Cfg.StartLP / 2
	s.Rank = 5
	if g.destinyOdds(s) <= half {
		t.Fatal("rank should raise the odds in trouble")
	}
	s.LP, s.Rank = 100, MaxRank
	if g.destinyOdds(s) > destinyMaxOdds {
		t.Fatal("odds are capped")
	}
}

func TestDestinyDrawReplacesADrawAndCoolsDown(t *testing.T) {
	g := destinyDuel(t, 0)
	s := g.Seats[0]
	s.LP = 300
	s.Rank = MaxRank
	got, drawn, before := 0, 0, s.Stats.CardsDrawn
	// Play many of seat 0's turns; seat 1 just ends its turns.
	for turn := 0; turn < 30; turn++ {
		s.Hand = s.Hand[:0] // empty hand: five cards to draw each turn
		s.Deck = deckOf(1, 2)
		g.Seats[1].Deck = deckOf(1, 2)
		s.LP = 300
		must(t, g, 0, Action{Type: ActEndTurn})
		must(t, g, 1, Action{Type: ActEndTurn})
		drawn += 40 - len(s.Deck)
		for _, e := range g.TakeEvents() {
			if e.Type == "destinyDraw" && e.Seat == 0 {
				got++
				if e.Num != nil {
					t.Fatal("the event must not tell the table which card it is")
				}
				c := s.handCard(e.CardID)
				if c == nil || !containsNum(destinyPool, c.Def.Num) {
					t.Fatalf("destiny card %d is not a pool card in hand", e.CardID)
				}
			}
		}
		if len(s.Hand) != g.Cfg.HandSize {
			t.Fatalf("hand has %d cards", len(s.Hand))
		}
	}
	if got == 0 {
		t.Fatal("no Destiny Draw in 30 desperate turns")
	}
	if got > destinyMaxPerDuel {
		t.Fatalf("%d destiny draws in one duel, at most %d allowed", got, destinyMaxPerDuel)
	}
	// At most one every destinyCooldown turns, starting from the second turn.
	if max := (s.TurnsTaken-1)/destinyCooldown + 1; got > max {
		t.Fatalf("%d destiny draws in %d turns, cooldown allows %d", got, s.TurnsTaken, max)
	}
	// Each destiny card stood in for a deck card.
	if drawn+got != s.Stats.CardsDrawn-before {
		t.Fatalf("drew %d from the deck and %d by destiny, stats say %d", drawn, got, s.Stats.CardsDrawn)
	}
}

func TestNoDestinyWithoutAPool(t *testing.T) {
	g := duel(t)
	g.Seats[0].LP = 100
	g.Seats[0].TurnsTaken = 5
	g.destinyRng = rand.New(rand.NewSource(1))
	for i := 0; i < 50; i++ {
		if g.destinyDraw(g.Seats[0]) != nil {
			t.Fatal("destiny draw with an empty pool")
		}
	}
}

func TestRankRisesWithKills(t *testing.T) {
	g := destinyDuel(t, 0)
	s := g.Seats[0]
	if s.Rank != 1 {
		t.Fatalf("starts at rank %d", s.Rank)
	}
	for i := 0; i < RankEvery*3; i++ {
		g.bury(put(g, 1, 1, i%3-1, 2, false), "battle", 0)
	}
	if s.Rank != 4 {
		t.Fatalf("rank %d after %d kills, want 4", s.Rank, RankEvery*3)
	}
	// Losing your own monsters, or an ally destroying them, earns nothing.
	g.bury(put(g, 1, 0, 0, 0, false), "battle", 0)
	if s.Rank != 4 {
		t.Fatal("destroying your own monster ranked up")
	}
	for i := 0; i < RankEvery*20; i++ {
		g.bury(put(g, 1, 1, 0, 2, false), "battle", 0)
	}
	if s.Rank != MaxRank {
		t.Fatalf("rank %d, want the cap %d", s.Rank, MaxRank)
	}
	if v := g.ViewFor(0); v.Seats[0].Rank != MaxRank {
		t.Fatal("the view does not show the rank")
	}
}

func containsNum(list []int, n int) bool {
	for _, v := range list {
		if v == n {
			return true
		}
	}
	return false
}
