package profile

import (
	"testing"
	"time"

	"duelistRoses/db"
	"duelistRoses/game/engine"
)

func match(winner int, aliceStats engine.Stats) Match {
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	return Match{
		Room: "r1", Mode: "1v1", Map: "Random", Turns: 12, Started: start, Ended: start.Add(5 * time.Minute),
		WinnerTeam: winner, StartLP: 4000,
		Seats: []Seat{
			{UserID: "alice", Name: "Alice", Team: 0, Deck: "Dragons", LP: 3000, Stats: aliceStats},
			{Name: "Bot", Bot: true, Team: 1, LP: 0},
			{UserID: "guest-1", Name: "Visitor", Guest: true, Team: 1},
		},
	}
}

func TestRecordTotalsStreaksAndPersistence(t *testing.T) {
	database := db.OpenTemp(t)
	s, err := Open(database, "")
	if err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Record(match(0, engine.Stats{DamageDealt: 4000, Fusions: 2, BiggestHit: 2500})))
	must(s.Record(match(0, engine.Stats{DamageDealt: 1000, DamageTaken: 300, Fusions: 1, BiggestHit: 900})))
	must(s.Record(match(1, engine.Stats{})))

	// Read it back from the database, as a restarted server would.
	s, err = Open(database, "")
	must(err)
	r := s.Get("alice")
	if r.Games != 3 || r.Wins != 2 || r.Losses != 1 || r.Streak != -1 || r.BestStreak != 2 {
		t.Fatalf("games %d wins %d losses %d streak %d best %d", r.Games, r.Wins, r.Losses, r.Streak, r.BestStreak)
	}
	if r.Totals.DamageDealt != 5000 || r.Totals.Fusions != 3 || r.Totals.BiggestHit != 2500 || r.Best.Fusions != 2 {
		t.Fatalf("totals %+v best %+v", r.Totals, r.Best)
	}
	if r.Flawless != 1 || r.VsHumans.Games != 3 || r.VsBots.Games != 0 || r.Seconds != 900 || r.FastestWin != 12 {
		t.Fatalf("flawless %d vs humans %+v seconds %d fastest %d", r.Flawless, r.VsHumans, r.Seconds, r.FastestWin)
	}
	if len(r.Recent) != 3 || r.Recent[0].Result != Loss || len(r.Recent[0].Opponents) != 2 {
		t.Fatalf("recent %+v", r.Recent)
	}
	decks, rivals, _ := s.Top("alice", 5)
	if len(decks) != 1 || decks[0].Name != "Dragons" || decks[0].Wins != 2 || len(rivals) != 2 {
		t.Fatalf("decks %+v rivals %+v", decks, rivals)
	}
	if g := s.Get("guest-1"); g.Games != 0 {
		t.Fatal("guests get no record")
	}
	if g := s.Get(""); g.Games != 0 {
		t.Fatal("bots get no record")
	}
}
