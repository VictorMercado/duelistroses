package content

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// Every card shipped in cards.json is valid as the card editor sees it, so
// any of them can be opened and saved back unchanged.
func TestSeedCardsPassCheckCard(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	for num := range catalog.cards {
		if problems, _ := engine.CheckCard(catalog.Card(num)); len(problems) > 0 {
			t.Errorf("card %d %q: %v", num, catalog.Card(num).Name, problems)
		}
	}
}

func TestEditCardsLiveWithHistory(t *testing.T) {
	dir := t.TempDir()
	database := db.OpenTemp(t)
	accounts, err := auth.New(dir, database, "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(dir, database, dir, accounts)
	if err != nil {
		t.Fatal(err)
	}
	before := s.Catalog()
	if before.Size() < 800 {
		t.Fatalf("seeded only %d cards", before.Size())
	}

	// Edit Blue-Eyes, sending it back with the fields the catalog adds.
	edited := `{"num":0,"name":"Blue-Eyes White Dragon","kind":"monster","type":"dragon","attribute":"light","level":8,"atk":3500,"def":2500,"deckCost":55,"frame":"normal","image":"cards/000.png"}`
	result, err := s.SaveCard(0, []byte(edited), "root", "buff")
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	json.Unmarshal(result.Card, &saved)
	if _, has := saved["frame"]; has {
		t.Error("a computed field was stored")
	}
	if s.Catalog().Card(0).Atk != 3500 || s.Catalog().Version == before.Version {
		t.Error("the edit did not reach the live catalog")
	}
	if before.Card(0).Atk != 3000 {
		t.Error("an older snapshot changed: a duel in progress would see the edit")
	}

	// A brand new card with an op the engine does not have yet: saved, with a warning.
	result, err = s.SaveCard(9001, []byte(`{"name":"Rose Storm","kind":"spell","deckCost":10,"effect":{"op":"bloom","amount":2}}`), "agent", "new card")
	if err != nil || len(result.Warnings) == 0 {
		t.Fatalf("new card: %v %v", err, result.Warnings)
	}
	if s.Catalog().Card(9001) == nil {
		t.Error("new card missing")
	}

	// Broken cards are refused and change nothing.
	version := s.Catalog().Version
	var problem *CardProblem
	for _, bad := range []string{
		`{"name":"","kind":"monster"}`,
		`{"name":"x","kind":"trap","effect":{"op":"heal","trigger":"move"}}`,
		`{"name":"x","kind":"monster","level":"high"}`,
	} {
		if _, err := s.SaveCard(9002, []byte(bad), "agent", ""); !errors.As(err, &problem) {
			t.Errorf("%s accepted: %v", bad, err)
		}
	}
	// A starter deck's leader may not stop being a monster.
	leader := s.StarterDecks()[0].LeaderNum
	if _, err := s.SaveCard(leader, []byte(`{"name":"Oops","kind":"spell","effect":{"op":"heal","amount":1}}`), "agent", ""); !errors.As(err, &problem) {
		t.Errorf("breaking a starter deck was accepted: %v", err)
	}
	if s.Catalog().Version != version {
		t.Error("a refused edit changed the catalog")
	}

	// History keeps the original, and a restart reads the edits back.
	revs, err := s.revisions(0)
	if err != nil || len(revs) != 2 || revs[1].Note != "original" || revs[0].ChangedBy != "root" {
		t.Fatalf("revisions: %v %+v", err, revs)
	}
	again, err := New(dir, database, dir, accounts)
	if err != nil {
		t.Fatal(err)
	}
	if again.Catalog().Card(0).Atk != 3500 || again.Catalog().Version != s.Catalog().Version {
		t.Error("edits were lost on restart")
	}
}

// PATCH changes only what it names, keeping the art and the rest.
func TestPatchCardKeepsOtherFields(t *testing.T) {
	dir := t.TempDir()
	database := db.OpenTemp(t)
	accounts, _ := auth.New(dir, database, "http://test", nil)
	s, err := New(dir, database, dir, accounts)
	if err != nil {
		t.Fatal(err)
	}
	accounts.EnsureAdmin("root", "rootpass")
	mux := http.NewServeMux()
	accounts.Register(mux)
	s.Register(mux)
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	var login struct{ Token string }
	json.Unmarshal(call("POST", "/api/auth/login", "", `{"name":"root","password":"rootpass"}`).Body.Bytes(), &login)

	w := call("PATCH", "/api/admin/cards/0?note=buff", login.Token, `{"atk":3300,"implemented":null}`)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var result struct{ Card map[string]any }
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Card["atk"] != 3300.0 || result.Card["image"] != "cards/000.png" || result.Card["implemented"] != nil {
		t.Errorf("patched card: %v", result.Card)
	}
	if w := call("PATCH", "/api/admin/cards/123456", login.Token, `{"atk":1}`); w.Code != http.StatusNotFound {
		t.Errorf("patching a missing card: %d", w.Code)
	}
}

// The fusion frame is for fusion monsters only, not for whatever a fusion
// recipe happens to produce.
func TestFusionFrame(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	for num, want := range map[int]string{
		35:  "effect", // Mystical Elf: a recipe result, but an ordinary monster
		294: "normal", // Summoned Skull: likewise
		24:  "fusion", // Thousand Dragon: a recipe result and a fusion monster
		2:   "fusion", // Blue-Eyes Ultimate Dragon: a fusion monster no recipe makes
	} {
		if got := catalog.Frame(catalog.Card(num)); got != want {
			t.Errorf("%s: frame %q, want %q", catalog.Card(num).Name, got, want)
		}
	}
}
