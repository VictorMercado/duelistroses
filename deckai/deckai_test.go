package deckai

import (
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
)

func newAssistant(t *testing.T) *Assistant {
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
	return New(library, database, false, "claude-opus-5-5")
}

func TestProposeChecksTheDeck(t *testing.T) {
	a := newAssistant(t)
	catalog := a.Content.Catalog()
	starter := a.Content.StarterDecks()[0]

	good, _ := json.Marshal(map[string]any{"name": "Test", "leader_num": starter.LeaderNum, "cards": starter.Cards, "summary": "s"})
	out, isErr, _, p := runTool(catalog, "propose_deck", good)
	if isErr || p == nil || len(p.Cards) != content.DeckSize {
		t.Fatalf("a legal deck was refused: %s", out)
	}
	if !strings.Contains(out, "Deck cost") {
		t.Errorf("no deck cost in %q", out)
	}

	bad, _ := json.Marshal(map[string]any{"name": "Short", "leader_num": starter.LeaderNum, "cards": starter.Cards[:30], "summary": "s"})
	if _, isErr, _, p := runTool(catalog, "propose_deck", bad); !isErr || p != nil {
		t.Fatal("a 30-card deck was accepted")
	}
}

func TestToolsAnswer(t *testing.T) {
	a := newAssistant(t)
	catalog := a.Content.Catalog()
	if out, isErr, _, _ := runTool(catalog, "search_cards", []byte(`{"type":"dragon","limit":5}`)); isErr || strings.Count(out, "\n") != 4 {
		t.Errorf("search: %q", out)
	}
	starter := a.Content.StarterDecks()[0]
	in, _ := json.Marshal(map[string]any{"cards": starter.Cards[:3]})
	if out, isErr, _, _ := runTool(catalog, "find_fusions", in); isErr || !strings.Contains(out, "fuses:") {
		t.Errorf("fusions: %q", out)
	}
	if ref := a.reference(catalog); !strings.Contains(ref, "dragon: mountain") {
		t.Error("the reference has no terrain table")
	}
}

func TestHourlyLimit(t *testing.T) {
	a := newAssistant(t)
	for i := 0; i < hourlyLimit; i++ {
		if !a.allow("u") {
			t.Fatalf("message %d refused", i)
		}
	}
	if a.allow("u") {
		t.Fatal("the limit let one more through")
	}
}

func TestLogAndStats(t *testing.T) {
	a := newAssistant(t)
	now := time.Now()
	deck := []Proposal{{Name: "D", Cards: []int{1}, Fusions: 6}}
	a.record(Entry{At: now, UserID: "u", Model: "claude-haiku-5-5", Message: "m", Proposals: deck, CostUSD: 0.02, DurationMS: 4000, Usage: bot.Usage{Calls: 3}})
	a.record(Entry{At: now, UserID: "u", Model: "claude-haiku-5-5", Message: "m", Refusals: 2, CostUSD: 0.04, DurationMS: 2000, Error: "boom"})
	a.record(Entry{At: now, UserID: "u", Model: "claude-opus-5-5", Message: "m", Proposals: deck, CostUSD: 0.3})

	stats, err := a.Stats(now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(stats) != 2 || stats[0].Model != "claude-haiku-5-5" {
		t.Fatalf("stats: %+v", stats)
	}
	h := stats[0]
	if h.Queries != 2 || h.Failed != 1 || h.WithDeck != 1 || h.Refusals != 2 || h.AvgSeconds != 3 || h.AvgFusions != 6 || math.Abs(h.AvgCostDeck-0.06) > 1e-9 {
		t.Errorf("haiku: %+v", h)
	}
	entries, err := a.Log(now.Add(-time.Hour), 10)
	if err != nil || len(entries) != 3 || entries[2].Proposals[0].Fusions != 6 {
		t.Fatalf("log: %v %+v", err, entries)
	}
}

func TestPlayerModel(t *testing.T) {
	a := newAssistant(t)
	if a.PlayerModel() != "claude-opus-5-5" {
		t.Fatal(a.PlayerModel())
	}
	if err := a.SetPlayerModel("claude-sonnet-5-5"); err != nil || a.PlayerModel() != "claude-sonnet-5-5" {
		t.Fatal(err, a.PlayerModel())
	}
	if a.SetPlayerModel("gpt") == nil {
		t.Fatal("an unknown model was accepted")
	}
}
