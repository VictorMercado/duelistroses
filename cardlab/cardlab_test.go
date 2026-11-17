package cardlab

import (
	"path/filepath"
	"strings"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/content"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

func newLab(t *testing.T) *Lab {
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
	return New(library, false, "claude-opus-5-5")
}

func TestReferenceCoversEveryOp(t *testing.T) {
	lab := newLab(t)
	ref := lab.reference(lab.Content.Catalog())
	for op := range engine.EffectOps {
		if !strings.Contains(ref, "- "+op+" (") {
			t.Errorf("effect op %s is missing", op)
		}
	}
	for op := range engine.AbilityOps {
		if !strings.Contains(ref, "- "+op+" (") {
			t.Errorf("ability op %s is missing", op)
		}
	}
	t.Logf("reference: %d characters (about %d tokens)", len(ref), len(ref)/4)
	if lab.reference(lab.Content.Catalog()) != ref {
		t.Error("the reference changed without the catalog changing: it would not cache")
	}
}

func TestTools(t *testing.T) {
	lab := newLab(t)
	cat := lab.Content.Catalog()

	out, isErr, _, _ := lab.runTool(cat, "search_cards", []byte(`{"query":"dragon","kind":"monster"}`))
	if isErr || !strings.Contains(strings.ToLower(out), "dragon") {
		t.Errorf("search: %v %s", isErr, out)
	}
	out, isErr, _, _ = lab.runTool(cat, "get_card", []byte(`{"num":5}`))
	if isErr || !strings.Contains(out, "Koumori") {
		t.Errorf("get_card 5: %v %s", isErr, out)
	}

	bad := `{"card":{"name":"Broken","kind":"monster","level":20}}`
	if _, isErr, _, p := lab.runTool(cat, "propose_card", []byte(bad)); !isErr || p != nil {
		t.Error("a card with problems was proposed")
	}
	good := `{"card":{"name":"Test Wyrm","kind":"monster","type":"dragon","attribute":"wind","level":4,"atk":1400,"def":1000,"deckCost":20,"text":"A test."},"summary":"A plain dragon."}`
	out, isErr, _, p := lab.runTool(cat, "propose_card", []byte(good))
	if isErr || p == nil || p.Replaces != "" {
		t.Fatalf("a good new card was refused: %s", out)
	}
	if !strings.Contains(string(p.Card), `"num":`) {
		t.Errorf("the proposal has no number: %s", p.Card)
	}
	newOp := `{"card":{"name":"Odd Spell","kind":"spell","text":"?","effect":{"op":"timeWarp"}},"summary":"x","new_behaviour":"rewinds"}`
	if _, isErr, _, p := lab.runTool(cat, "propose_card", []byte(newOp)); isErr || p == nil || len(p.Warnings) == 0 || p.NewBehaviour == "" {
		t.Errorf("a card with a new op should be proposed with a warning: %+v", p)
	}
	edit := `{"card":{"num":5,"name":"Koumori Dragon","kind":"monster","type":"dragon","attribute":"dark","level":4,"atk":1600,"def":1200},"summary":"buff"}`
	if _, _, _, p := lab.runTool(cat, "propose_card", []byte(edit)); p == nil || p.Replaces != "Koumori Dragon" {
		t.Errorf("an edit does not say what it replaces: %+v", p)
	}
	// Nothing was saved.
	if c, _ := lab.Content.StoredCard(5); strings.Contains(string(c), "1600") {
		t.Error("proposing saved the card")
	}
}
