package game

import (
	"path/filepath"
	"testing"
	"time"

	"duelistRoses/auth"
	"duelistRoses/content"
	"duelistRoses/db"
)

func TestArenaPlaysBotGames(t *testing.T) {
	database := db.OpenTemp(t)
	dir := t.TempDir()
	accounts, err := auth.New(dir, database, "http://localhost", nil)
	if err != nil {
		t.Fatal(err)
	}
	library, err := content.New(dir, database, filepath.Join(dir, "assets"), accounts)
	if err != nil {
		t.Fatal(err)
	}
	arena := NewArena(library, false)

	if _, err := arena.Start(ArenaSpec{A: "llm:claude-haiku-5-5", B: "bot", Games: 2}, "test"); err == nil {
		t.Error("an LLM job started without credentials")
	}
	job, err := arena.Start(ArenaSpec{A: "aggressive", B: "bot", Games: 6, Parallel: 3}, "test")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Minute)
	for {
		jobs := arena.Jobs()
		if jobs[0].Status != "running" {
			j := jobs[0]
			if j.Status != "done" || j.Done != 6 {
				t.Fatalf("job ended %s with %d of 6 games done: %+v", j.Status, j.Done, j.Games)
			}
			if j.Sides[0].Wins+j.Sides[1].Wins+j.Draws != 6 {
				t.Errorf("wins %d + %d and %d draws do not add up to 6", j.Sides[0].Wins, j.Sides[1].Wins, j.Draws)
			}
			for _, g := range j.Games {
				if g.Winner == "" || g.Turns == 0 {
					t.Errorf("game %d: %+v", g.N, g)
				}
			}
			// Games come in pairs: same seed, sides swapped.
			if j.Games[0].Seed != j.Games[1].Seed || j.Games[0].AFirst == j.Games[1].AFirst {
				t.Error("games 1 and 2 are not a mirrored pair")
			}
			t.Logf("aggressive %d - %d balanced, %d draws", j.Sides[0].Wins, j.Sides[1].Wins, j.Draws)
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job %s still running", job.ID)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !arena.Stop(job.ID, "test") || len(arena.Jobs()) != 0 {
		t.Error("a finished job was not forgotten")
	}
}
