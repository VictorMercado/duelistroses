package engine

import "testing"

// collecting makes both seats keep rarity points, as players with accounts do.
func collecting(g *Game) *Game {
	for _, s := range g.Seats {
		s.RarityBase = map[int]int{}
	}
	return g
}

func rarityEvents(g *Game) []Event {
	var out []Event
	for _, e := range g.TakeEvents() {
		if e.Type == "rarity" {
			out = append(out, e)
		}
	}
	return out
}

func TestRarityTiers(t *testing.T) {
	for points, want := range map[int]string{0: RarityCommon, 9: RarityCommon, 10: RarityRare, 29: RarityRare, 30: RaritySecret, 50: RarityUltra, 99: RarityUltra, 100: RarityUltimate, 500: RarityUltimate} {
		if got := RarityFor(points); got != want {
			t.Errorf("RarityFor(%d) = %s, want %s", points, got, want)
		}
	}
}

func TestBattleKillEarnsTheWinner(t *testing.T) {
	g := collecting(duel(t))
	att := put(g, 2, 0, 0, 0, false) // 1600
	def := put(g, 1, 1, 0, 1, false) // 1200
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if got := g.Seats[0].CardPoints[2]; got != MonsterKillPoints {
		t.Fatalf("the attacker earned %d, want %d", got, MonsterKillPoints)
	}
	if got := g.Seats[1].CardPoints[def.Def.Num]; got != 0 {
		t.Fatalf("the destroyed monster earned %d", got)
	}

	// A defender that wins earns too.
	g = collecting(duel(t))
	weak := put(g, 1, 0, 0, 0, false)
	put(g, 2, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: weak.ID, X: 0, Y: 1})
	if g.Seats[1].CardPoints[2] != MonsterKillPoints || g.Seats[0].CardPoints[1] != 0 {
		t.Fatalf("points %v / %v", g.Seats[0].CardPoints, g.Seats[1].CardPoints)
	}
}

func TestFinalBlowToALeader(t *testing.T) {
	g := collecting(duel(t))
	att := put(g, 3, 0, 0, 2, false)
	g.Seats[1].LP = 5000 // not the final blow
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	if g.Seats[0].CardPoints[3] != 0 {
		t.Fatal("a hit that leaves the leader standing earns nothing")
	}

	g = collecting(duel(t))
	att = put(g, 3, 0, 0, 2, false)
	g.Seats[1].LP = 2500
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	if got := g.Seats[0].CardPoints[3]; got != LeaderKillPoints {
		t.Fatalf("the final blow earned %d, want %d", got, LeaderKillPoints)
	}
	if ev := rarityEvents(g); len(ev) != 1 || ev[0].Text != RarityRare || ev[0].CardID != att.ID {
		t.Fatalf("rarity events %+v, want one making it rare", ev)
	}
}

func TestRarityShowsInViewsAndCrossesThresholds(t *testing.T) {
	g := collecting(duel(t))
	g.Seats[0].RarityBase[2] = 29
	att := put(g, 2, 0, 0, 0, false)
	if v := g.ViewFor(1); v.Cards[0].Rarity != RarityRare {
		t.Fatalf("an opponent sees rarity %q, want rare", v.Cards[0].Rarity)
	}
	put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if ev := rarityEvents(g); len(ev) != 1 || ev[0].Text != RaritySecret {
		t.Fatalf("rarity events %+v, want one making it secret", ev)
	}
	if v := g.ViewFor(0); v.Cards[0].Rarity != RaritySecret {
		t.Fatalf("view rarity %q after the kill, want secret", v.Cards[0].Rarity)
	}

	// Hidden from a viewer, a card shows no rarity: it would give it away.
	hidden := put(g, 2, 0, 2, 0, true)
	for _, cv := range g.ViewFor(1).Cards {
		if cv.ID == hidden.ID && cv.Rarity != "" {
			t.Fatalf("a hidden card shows rarity %q", cv.Rarity)
		}
	}
}

func TestSeatsWithoutAccountsEarnNothing(t *testing.T) {
	g := duel(t) // bots and guests: no RarityBase
	att := put(g, 2, 0, 0, 0, false)
	put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if len(g.Seats[0].CardPoints) != 0 || g.ViewFor(0).Cards[0].Rarity != "" {
		t.Fatal("a seat that keeps no points earns none and shows common")
	}
}

func TestBorrowedMonstersEarnNothing(t *testing.T) {
	g := collecting(duel(t))
	att := put(g, 2, 0, 0, 0, false)
	att.Home, att.Borrowed = 1, true // taken over from seat 1
	put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 1})
	if len(g.Seats[0].CardPoints) != 0 || len(g.Seats[1].CardPoints) != 0 {
		t.Fatalf("points %v / %v", g.Seats[0].CardPoints, g.Seats[1].CardPoints)
	}
}

func TestAdminSetRarity(t *testing.T) {
	g := collecting(duel(t))
	c := put(g, 2, 0, 0, 0, false)
	if err := g.AdminSetRarity(0, c.ID, RarityUltimate); err != nil {
		t.Fatal(err)
	}
	if v := g.ViewFor(0); v.Cards[0].Rarity != RarityUltimate {
		t.Fatalf("rarity %q, want ultimate", v.Cards[0].Rarity)
	}
	if err := g.AdminSetRarity(0, c.ID, RarityCosmic); err != nil {
		t.Fatal(err)
	}
	if v := g.ViewFor(0); v.Cards[0].Rarity != RarityCosmic {
		t.Fatalf("rarity %q, want cosmic", v.Cards[0].Rarity)
	}
	// Earning points leaves an unlocked rarity as it is.
	put(g, 1, 1, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: c.ID, X: 0, Y: 1})
	if ev := rarityEvents(g); len(ev) != 0 || g.ViewFor(0).Cards[0].Rarity != RarityCosmic {
		t.Fatalf("after a kill: events %+v, rarity %q", ev, g.ViewFor(0).Cards[0].Rarity)
	}
	if err := g.AdminSetRarity(0, c.ID, RarityRare); err != nil {
		t.Fatal(err)
	}
	if v := g.ViewFor(0); v.Cards[0].Rarity != RarityRare {
		t.Fatalf("rarity %q, want rare once cosmic is taken back", v.Cards[0].Rarity)
	}
	if err := g.AdminSetRarity(0, c.ID, "mythic"); err == nil {
		t.Fatal("an unknown rarity is refused")
	}
}
