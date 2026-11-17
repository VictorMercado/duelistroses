package engine

import "testing"

func TestStatsCreditWhoeverCausedIt(t *testing.T) {
	// An attacker that wins: damage and a kill for the attacker.
	g := duel(t)
	att := put(g, 2, 0, 0, 0, false) // 1600
	put(g, 1, 1, 0, 1, false)        // 1200
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	a, d := g.Seats[0].Stats, g.Seats[1].Stats
	if a.DamageDealt != 400 || a.CardsDestroyed != 1 || a.MonstersDestroyed != 1 || a.BattlesWon != 1 || a.Attacks != 1 {
		t.Fatalf("attacker %+v", a)
	}
	if d.DamageTaken != 400 || d.CardsLost != 1 || d.DamageDealt != 0 {
		t.Fatalf("defender %+v", d)
	}

	// An attacker that loses: the defender gets the damage and the kill.
	g = duel(t)
	weak := put(g, 1, 0, 0, 0, false)
	put(g, 2, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: weak.ID, X: 0, Y: 1})
	a, d = g.Seats[0].Stats, g.Seats[1].Stats
	if d.DamageDealt != 400 || d.CardsDestroyed != 1 || d.BattlesWon != 1 || a.CardsLost != 1 || a.DamageTaken != 400 || a.BattlesWon != 0 {
		t.Fatalf("attacker %+v defender %+v", a, d)
	}

	// A trap's kill belongs to the trap's owner, though it springs on the mover's turn.
	g = duel(t)
	put(g, 30, 1, 1, 1, true)
	walker := put(g, 1, 0, 0, -1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: walker.ID, X: 0, Y: 0})
	if s := g.Seats[1].Stats; s.CardsDestroyed != 1 || s.TrapsSprung != 1 {
		t.Fatalf("trap owner %+v", s)
	}
	if s := g.Seats[0].Stats; s.CardsLost != 1 || s.CardsDestroyed != 0 {
		t.Fatalf("mover %+v", s)
	}
}

func TestStatsCountOnlyLifeActuallyLost(t *testing.T) {
	g := duel(t)
	att := put(g, 3, 0, 0, 2, false) // 3000 ATK
	g.Seats[1].LP = 1000
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	s := g.Seats[0].Stats
	if s.DamageDealt != 1000 || s.BiggestHit != 1000 || s.DirectAttacks != 1 {
		t.Fatalf("overkill counts the LP that was left: %+v", s)
	}
}

func TestStatsFusionsSummonsAndSpells(t *testing.T) {
	g := duel(t)
	put(g, 1, 0, 0, 0, false)
	drake := put(g, 2, 0, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: drake.ID, X: 0, Y: 0})
	if s := g.Seats[0].Stats; s.Fusions != 1 || s.CardsLost != 0 {
		t.Fatalf("a fusion is not a loss: %+v", s)
	}

	g = duel(t, 21)
	card := g.Seats[0].Hand[0]
	must(t, g, 0, Action{Type: ActSummon, CardID: card.ID, X: 0, Y: -2})
	if s := g.Seats[0].Stats; s.Summons != 1 || s.CardsDrawn != 5 {
		t.Fatalf("summon %+v", s)
	}
	must(t, g, 0, Action{Type: ActFlip, CardID: card.ID})
	if s := g.Seats[0].Stats; s.SpellsCast != 1 || s.DamageDealt != 1000 {
		t.Fatalf("burn %+v", s)
	}
	if s := g.Seats[1].Stats; s.DamageTaken != 1000 {
		t.Fatalf("burned %+v", s)
	}
}

func TestStatsAdd(t *testing.T) {
	total := Stats{DamageDealt: 100, BiggestHit: 900}
	total.Add(Stats{DamageDealt: 50, BiggestHit: 300, Fusions: 2})
	if total.DamageDealt != 150 || total.BiggestHit != 900 || total.Fusions != 2 {
		t.Fatalf("%+v", total)
	}
}
