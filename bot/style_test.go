package bot

import (
	"context"
	"testing"

	"duelistRoses/game/engine"
)

// opening is a quiet 7x7 board: our leader at (0,-3) with a monster in hand,
// the enemy leader at (0,3), nothing on the field. The leader may step
// forward or sideways, and the card may be summoned in front of it.
func opening() Observation {
	cards := map[int]*engine.CardDef{
		10: {Num: 10, Kind: engine.KindMonster, Atk: 1500, Def: 1200, Level: 4},
	}
	tiles := make([]string, 49)
	for i := range tiles {
		tiles[i] = engine.TerrainNormal
	}
	return Observation{
		Seat: 0,
		View: engine.View{
			Size:  7,
			Tiles: tiles,
			Seats: []engine.SeatView{
				{Index: 0, Team: 0, Alive: true, LP: 4000, LeaderX: 0, LeaderY: -3, PlaysLeft: 1, Stars: 4},
				{Index: 1, Team: 1, Alive: true, LP: 4000, LeaderX: 0, LeaderY: 3},
			},
			Hand: []engine.HandCardView{{ID: 5, Num: 10}},
		},
		Legal: []engine.Action{
			{Type: engine.ActSummon, CardIDs: []int{5}, X: 0, Y: -2},
			{Type: engine.ActLeader, X: 0, Y: -2},
			{Type: engine.ActLeader, X: 1, Y: -3},
			{Type: engine.ActEndTurn},
		},
		Card: func(n int) *engine.CardDef { return cards[n] },
	}
}

func TestAggressiveLeaderAdvancesBeforeSummoning(t *testing.T) {
	o := opening()
	got := o.Legal[Heuristic{Style: Aggressive}.Choose(context.Background(), o).Index]
	if got.Type != engine.ActLeader || got.Y != -2 {
		t.Fatalf("aggressive bot should march its leader forward first, chose %+v", got)
	}
	for _, s := range []Style{Builder, Defensive} {
		got := o.Legal[Heuristic{Style: s}.Choose(context.Background(), o).Index]
		if got.Type == engine.ActLeader {
			t.Errorf("%s bot should not walk its leader out on an empty board, chose %+v", s, got)
		}
	}
}

func TestDefensiveBracesEvenWithAWayOut(t *testing.T) {
	// The 800/2000 monster could step out of reach, but it can also hold:
	// the defensive bot holds the line.
	o := cornered(engine.Pos{X: -1, Y: 0})
	got := o.Legal[Heuristic{Style: Defensive}.Choose(context.Background(), o).Index]
	if got.Type != engine.ActPosition || !got.Defense {
		t.Fatalf("defensive bot should brace, chose %+v", got)
	}
}

func TestBuilderHoldsUntilItHasAField(t *testing.T) {
	// One lone monster in the middle of the board, the enemy far away: the
	// builder keeps it home, the aggressive bot sends it.
	o := opening()
	o.View.Hand = nil
	o.View.Cards = []engine.CardView{{ID: 1, Num: 10, Owner: 0, X: 0, Y: -2, Atk: 1500, Def: 1200}}
	o.Legal = []engine.Action{
		{Type: engine.ActMove, CardID: 1, X: 0, Y: -1},
		{Type: engine.ActEndTurn},
	}
	if got := o.Legal[Heuristic{Style: Builder}.Choose(context.Background(), o).Index]; got.Type != engine.ActEndTurn {
		t.Errorf("builder should wait for more monsters, chose %+v", got)
	}
	if got := o.Legal[Heuristic{Style: Aggressive}.Choose(context.Background(), o).Index]; got.Type != engine.ActMove {
		t.Errorf("aggressive bot should advance, chose %+v", got)
	}
}

func TestLethalBlowComesFirst(t *testing.T) {
	o := cornered()
	o.View.Seats[1].LP = 700
	o.View.Seats[1].LeaderX, o.View.Seats[1].LeaderY = -1, 0
	o.Legal = append([]engine.Action{{Type: engine.ActMove, CardID: 1, X: -1, Y: 0}}, o.Legal...)
	for _, s := range append([]Style{Balanced}, Styles...) {
		if got := o.Legal[Heuristic{Style: s}.Choose(context.Background(), o).Index]; got.Type != engine.ActMove || got.X != -1 {
			t.Errorf("%s bot missed the winning attack, chose %+v", s, got)
		}
	}
}

func TestParseStyle(t *testing.T) {
	for _, s := range Styles {
		if ParseStyle(string(s)) != s {
			t.Errorf("%q does not round-trip", s)
		}
	}
	if ParseStyle("llm") != Balanced || ParseStyle("") != Balanced {
		t.Error("unknown kinds should get the balanced bot")
	}
}

func TestOnlyAdminsPickPersonalities(t *testing.T) {
	first := func(int) int { return 0 }
	random := string(Styles[0])
	for _, asked := range []string{"defensive", "builder", "balanced", "", "random", "nonsense"} {
		if got := StyleKind(asked, false, first); got != random {
			t.Errorf("a player asking for %q got %q, want the random pick %q", asked, got, random)
		}
	}
	for asked, want := range map[string]string{"defensive": "defensive", "builder": "builder", "balanced": "balanced", "": random, "random": random} {
		if got := StyleKind(asked, true, first); got != want {
			t.Errorf("an admin asking for %q got %q, want %q", asked, got, want)
		}
	}
	seen := map[string]bool{}
	for i := range Styles {
		seen[StyleKind("", false, func(int) int { return i })] = true
	}
	if len(seen) != len(Styles) {
		t.Errorf("random picks cover %d of %d personalities", len(seen), len(Styles))
	}
}
