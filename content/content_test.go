package content

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"duelistRoses/db"
)

func TestEmbeddedCatalog(t *testing.T) {
	catalog, starters, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Size() == 0 || catalog.Version == "" || len(catalog.payload) == 0 {
		t.Fatal("empty catalog")
	}
	if len(starters) == 0 {
		t.Fatal("no starter decks")
	}
	for _, d := range starters {
		if !d.Starter || d.DeckCost == 0 {
			t.Errorf("starter %s: starter=%v cost=%d", d.ID, d.Starter, d.DeckCost)
		}
	}
}

func TestRules(t *testing.T) {
	catalog, starters, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	good := starters[0]
	if p := CheckDeck(catalog, good.Name, good.LeaderNum, good.Cards); p != "" {
		t.Fatalf("starter rejected: %s", p)
	}
	if CheckDeck(catalog, "", good.LeaderNum, good.Cards) == "" {
		t.Error("nameless deck accepted")
	}
	if CheckDeck(catalog, "x", good.LeaderNum, good.Cards[:39]) == "" {
		t.Error("39 card deck accepted")
	}
	four := slices.Clone(good.Cards)
	for i := range 4 {
		four[i] = good.LeaderNum
	}
	if CheckDeck(catalog, "x", good.LeaderNum, four) == "" {
		t.Error("four copies accepted")
	}
	// The Egyptian Gods are in the catalog, each on a template of its own, but locked.
	for num, frame := range map[int]string{902: "godObelisk", 903: "godSlifer", 904: "godRa"} {
		god := catalog.Card(num)
		if god == nil || !god.Locked || !god.IsGod() {
			t.Fatalf("card %d is not a locked God: %+v", num, god)
		}
		if got := catalog.Frame(god); got != frame {
			t.Errorf("%s: frame %q, want %q", god.Name, got, frame)
		}
		if got := AttributeIcon(god); got != "attributes/divine_attribute.png" {
			t.Errorf("%s: attribute icon %q", god.Name, got)
		}
		withGod := slices.Clone(good.Cards)
		withGod[0] = num
		if p := CheckDeck(catalog, "x", good.LeaderNum, withGod); p != god.Name+" is locked." {
			t.Errorf("deck with %s: %q", god.Name, p)
		}
		if CheckDeck(catalog, "x", num, good.Cards) == "" {
			t.Errorf("%s accepted as leader", god.Name)
		}
	}

	tiles := make([]string, 25)
	for i := range tiles {
		tiles[i] = "forest"
	}
	if p := CheckMap("m", 5, tiles); p != "" {
		t.Errorf("good map rejected: %s", p)
	}
	if CheckMap("m", 6, tiles) == "" || CheckMap("m", 7, tiles) == "" {
		t.Error("bad size accepted")
	}
	tiles[3] = "lava"
	if CheckMap("m", 5, tiles) == "" {
		t.Error("unknown terrain accepted")
	}
}

func TestStoreOwnershipAndPersistence(t *testing.T) {
	database := db.OpenTemp(t)
	s, err := openStore(database, "")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.putDeck(Deck{Name: "mine", OwnerID: "alice", Cards: []int{1}}, 2)
	if err != nil || d.ID == "" {
		t.Fatalf("put: %v", err)
	}
	if _, err := s.putDeck(Deck{ID: d.ID, Name: "stolen", OwnerID: "bob"}, 2); !errors.Is(err, ErrNotFound) {
		t.Errorf("another player overwrote a deck: %v", err)
	}
	if err := s.deleteDeck(d.ID, "bob"); !errors.Is(err, ErrNotFound) {
		t.Errorf("another player deleted a deck: %v", err)
	}
	s.putDeck(Deck{Name: "second", OwnerID: "alice"}, 2)
	if _, err := s.putDeck(Deck{Name: "third", OwnerID: "alice"}, 2); !errors.Is(err, ErrLimit) {
		t.Errorf("limit not enforced: %v", err)
	}
	if _, err := s.putMap(Map{Name: "secret", OwnerID: "alice"}, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := s.putMap(Map{Name: "shared", OwnerID: "alice", IsPublic: true}, 5); err != nil {
		t.Fatal(err)
	}

	reopened, err := openStore(database, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := len(reopened.decksOf("alice")); got != 2 {
		t.Errorf("alice has %d decks after reopening, want 2", got)
	}
	if got := len(reopened.visibleMaps("bob")); got != 1 {
		t.Errorf("bob sees %d maps, want only the public one", got)
	}
	if got := len(reopened.visibleMaps("alice")); got != 2 {
		t.Errorf("alice sees %d maps, want 2", got)
	}
}

func TestFrames(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Cards []struct {
			Num           int    `json:"num"`
			Name          string `json:"name"`
			Frame         string `json:"frame"`
			Template      string `json:"template"`
			AttributeIcon string `json:"attributeIcon"`
		} `json:"cards"`
	}
	if err := json.Unmarshal(catalog.payload, &payload); err != nil {
		t.Fatal(err)
	}
	byName := map[string]string{}
	counts := map[string]int{}
	for _, c := range payload.Cards {
		if c.Frame == "" || c.Template != "textures/"+c.Frame+"Template.png" || c.AttributeIcon == "" {
			t.Fatalf("card %d %s: frame %q template %q icon %q", c.Num, c.Name, c.Frame, c.Template, c.AttributeIcon)
		}
		byName[c.Name] = c.Frame
		counts[c.Frame]++
	}
	for name, want := range map[string]string{
		"Blue-Eyes White Dragon": "normal",
		"Seiyaryu":               "effect",
		"B. Skull Dragon":        "fusion",
		"Black Luster Soldier":   "ritual",
		"Black Luster Ritual":    "spell",
	} {
		if got := byName[name]; got != want {
			t.Errorf("%s: frame %q, want %q", name, got, want)
		}
	}
	t.Logf("frames: %v", counts)
}

func TestMusic(t *testing.T) {
	dir := t.TempDir()
	audio := filepath.Join(dir, "audio")
	os.MkdirAll(audio, 0o755)
	for _, name := range []string{"VS_Yorkists_Starter.mp3", "VS_Yorkists_Loop.mp3", "Vs_Yugi.mp3", "VS_Lonely_Starter.mp3", "blip.wav", "vs_notes.txt"} {
		os.WriteFile(filepath.Join(audio, name), nil, 0o644)
	}
	got := (&Service{assetDir: dir}).Music()
	want := []Track{
		{Name: "VS_Yorkists", Intro: "audio/VS_Yorkists_Starter.mp3", Loop: "audio/VS_Yorkists_Loop.mp3"},
		{Name: "Vs_Yugi", Loop: "audio/Vs_Yugi.mp3"},
		{Name: "VS_Lonely", Loop: "audio/VS_Lonely_Starter.mp3"},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// The fusion table is the game's own (see scripts/content/fetch_fusions.py).
func TestFusionTable(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	fuse := func(a, b int) int {
		if r := catalog.Fuse(catalog.Card(a), catalog.Card(b)); r != nil {
			return r.Num
		}
		return -1
	}
	cases := []struct{ a, b, want int }{
		{21, 35, 4},    // Baby Dragon + Mystical Elf: Dragon + Spellcaster = Blackland Fire Dragon
		{35, 21, 4},    // either order
		{7, 294, 9},    // Red-Eyes B. Dragon + Summoned Skull = B. Skull Dragon
		{535, 7, 538},  // Thunder Dragon + a 2000+ ATK Dragon = Twin-Headed Thunder Dragon
		{535, 535, -1}, // two Thunder Dragons is the card game's recipe, not this game's
		{799, 7, 501},  // Metalmorph + Red-Eyes B. Dragon = Red-Eyes Black Metal Dragon (a spell as material)
		{0, 0, -1},     // Blue-Eyes has nothing stronger to become
	}
	for _, c := range cases {
		if got := fuse(c.a, c.b); got != c.want {
			t.Errorf("%s + %s = %d, want %d", catalog.Card(c.a).Name, catalog.Card(c.b).Name, got, c.want)
		}
	}
}
