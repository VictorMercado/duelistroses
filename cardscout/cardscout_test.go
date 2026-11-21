package cardscout

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"duelistRoses/auth"
	"duelistRoses/cardlab"
	"duelistRoses/content"
	"duelistRoses/db"
)

func newScout(t *testing.T) (*Scout, string) {
	database := db.OpenTemp(t)
	dir := t.TempDir()
	accounts, err := auth.New(dir, database, "http://localhost", nil)
	if err != nil {
		t.Fatal(err)
	}
	assets := filepath.Join(dir, "assets")
	library, err := content.New(dir, database, assets, accounts)
	if err != nil {
		t.Fatal(err)
	}
	lab := cardlab.New(library, false, "claude-opus-5-5")
	// No scripts: the asset step fails fast instead of running the real ones.
	s := New(library, lab, database, false, Config{Model: "claude-opus-5-5", AssetDir: assets, Scripts: filepath.Join(dir, "none")})
	return s, assets
}

func TestOldestFirst(t *testing.T) {
	cards := []apiCard{
		{ID: 3, Name: "New", Misc: []struct {
			TCG string `json:"tcg_date"`
			OCG string `json:"ocg_date"`
		}{{TCG: "2020-01-01", OCG: "2019-06-01"}}},
		{ID: 2, Name: "Undated"},
		{ID: 1, Name: "Old", Misc: []struct {
			TCG string `json:"tcg_date"`
			OCG string `json:"ocg_date"`
		}{{TCG: "2008-11-01"}}},
	}
	var list []SourceCard
	for _, c := range cards {
		list = append(list, c.toSource())
	}
	sortOldestFirst(list)
	if list[0].Name != "Old" || list[1].Name != "New" || list[2].Name != "Undated" {
		t.Fatalf("order: %s, %s, %s", list[0].Name, list[1].Name, list[2].Name)
	}
	if list[1].Released != "2019-06-01" {
		t.Errorf("released is the first release anywhere, got %s", list[1].Released)
	}
}

const goodCard = `{"name":"Test Synchro","kind":"monster","type":"dragon","attribute":"wind","level":7,"atk":2500,"def":2000,"deckCost":40,"text":"A test.","num":5,"image":"cards/x.png"}`

func TestCheckOptions(t *testing.T) {
	s, _ := newScout(t)
	opts, _, _, problem := s.checkOptions([]byte(`{"options":[{"title":"Faithful","card":`+goodCard+`,"summary":"ok"}]}`), false)
	if problem != "" {
		t.Fatalf("refused: %s", problem)
	}
	if strings.Contains(string(opts[0].Card), `"num"`) || strings.Contains(string(opts[0].Card), `"image"`) {
		t.Errorf("num and image are set on accept, not kept: %s", opts[0].Card)
	}
	_, _, _, problem = s.checkOptions([]byte(`{"options":[{"title":"Bad","card":{"name":"X","kind":"monster","level":40},"summary":"no"}]}`), false)
	if problem == "" {
		t.Error("a broken card was let through")
	}
	_, _, _, problem = s.checkOptions([]byte(`{"options":[{"title":"Spell","card":{"name":"X","kind":"spell","effect":{"op":"heal","amount":500}},"summary":"no"}]}`), false)
	if problem == "" {
		t.Error("a Synchro must stay a monster")
	}
}

func TestAccept(t *testing.T) {
	s, assets := newScout(t)
	art := image.NewRGBA(image.Rect(0, 0, 624, 600))
	for x := 0; x < 624; x++ {
		art.Set(x, 300, color.White)
	}
	var jpg bytes.Buffer
	jpeg.Encode(&jpg, art, nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(jpg.Bytes()) }))
	defer srv.Close()

	opts, _, _, problem := s.checkOptions([]byte(`{"options":[{"title":"Faithful","card":`+goodCard+`,"summary":"ok"}]}`), false)
	if problem != "" {
		t.Fatal(problem)
	}
	src, _ := json.Marshal(SourceCard{ID: 99, Name: "Test Synchro", Cropped: srv.URL + "/art.jpg"})
	optJSON, _ := json.Marshal(opts)
	res, err := s.DB.Exec(`INSERT INTO card_suggestions (source_id, name, summon, source, status, options, created_at) VALUES (99, 'Test Synchro', 'synchro', ?, 'pending', ?, ?)`,
		string(src), string(optJSON), db.Time(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()

	want := s.Content.NextFreeNum()
	num, err := s.Accept(context.Background(), id, 0, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if num != want {
		t.Errorf("card number %d, want %d", num, want)
	}
	d := s.Content.Catalog().Card(num)
	if d == nil || d.Name != "Test Synchro" {
		t.Fatalf("card %d is not in the catalog", num)
	}
	f, err := os.Open(filepath.Join(assets, "cards", fmt.Sprintf("%03d.png", num)))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil || img.Bounds().Dx() != artSize || img.Bounds().Dy() != artSize {
		t.Fatalf("art is not a %dpx PNG: %v %v", artSize, err, img.Bounds())
	}
	if _, err := s.Accept(context.Background(), id, 0, "tester"); err == nil {
		t.Error("accepted twice")
	}
	// The asset step runs in the background; wait for it to record its result.
	for i := 0; i < 100; i++ {
		g, _ := s.get(id)
		if g.Assets != "working" {
			if g.Status != StatusAccepted || g.Assets != "failed" || *g.CardNum != num {
				t.Errorf("got status %s, assets %s", g.Status, g.Assets)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Error("the asset step never finished")
}

func TestUploadOptionsKeepTheReadKind(t *testing.T) {
	s, _ := newScout(t)
	spell := `{"name":"Test Heal","kind":"spell","deckCost":10,"text":"Heals 500 LP.","effect":{"op":"heal","amount":500}}`
	_, _, read, problem := s.checkOptions([]byte(`{"card_read":{"name":"Test Heal","kind":"spell","card_type":"Normal Spell","text":"Gain 500 LP."},"options":[{"title":"Faithful","card":`+spell+`,"summary":"ok"}]}`), true)
	if problem != "" || read == nil || read.Name != "Test Heal" {
		t.Fatalf("refused: %s", problem)
	}
	_, _, _, problem = s.checkOptions([]byte(`{"options":[{"title":"Faithful","card":`+spell+`,"summary":"ok"}]}`), true)
	if problem == "" {
		t.Error("an upload must say what it read")
	}
	_, _, _, problem = s.checkOptions([]byte(`{"card_read":{"name":"Test Heal","kind":"trap","card_type":"Normal Trap","text":"x"},"options":[{"title":"Faithful","card":`+spell+`,"summary":"ok"}]}`), true)
	if problem == "" {
		t.Error("an option of another kind than the card was let through")
	}
}

func TestCardArtBox(t *testing.T) {
	// A card-shaped image: the art box is cut out.
	card := image.NewRGBA(image.Rect(0, 0, 421, 614))
	if got := cardArtBox(card).Bounds(); got.Dx() != 320 || got.Dy() != 320 {
		t.Errorf("art box %v, want 320x320", got)
	}
	// Anything else is left for the centre crop.
	square := image.NewRGBA(image.Rect(0, 0, 300, 300))
	if cardArtBox(square) != image.Image(square) {
		t.Error("a non-card image was cut")
	}
}

func TestAcceptUploadedSpell(t *testing.T) {
	s, assets := newScout(t)
	s.Config.UploadDir = t.TempDir()
	sourceID := -12345
	dir := s.uploadDir(sourceID)
	os.MkdirAll(dir, 0o755)
	writeJPEG(filepath.Join(dir, "card.jpg"), image.NewRGBA(image.Rect(0, 0, 421, 614)))

	spell := `{"name":"Test Heal","kind":"spell","deckCost":10,"text":"Heals 500 LP.","effect":{"op":"heal","amount":500}}`
	opts, _, _, problem := s.checkOptions([]byte(`{"card_read":{"name":"Test Heal","kind":"spell","card_type":"Normal Spell","text":"x"},"options":[{"title":"Faithful","card":`+spell+`,"summary":"ok"}]}`), true)
	if problem != "" {
		t.Fatal(problem)
	}
	src, _ := json.Marshal(SourceCard{ID: sourceID, Name: "Test Heal", Uploaded: true})
	optJSON, _ := json.Marshal(opts)
	res, err := s.DB.Exec(`INSERT INTO card_suggestions (source_id, name, summon, source, status, options, created_at) VALUES (?, 'Test Heal', 'upload', ?, 'pending', ?, ?)`,
		sourceID, string(src), string(optJSON), db.Time(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	num, err := s.Accept(context.Background(), id, 0, "tester")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		if g, _ := s.get(id); g.Assets != "working" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	// No cwebp script here, so the WebP step fails, but the spell's mask is
	// made without the segmentation model and saved on the card.
	if _, err := os.Stat(filepath.Join(assets, "cards", fmt.Sprintf("%03d_Mask.png", num))); err != nil {
		t.Errorf("no mask: %v", err)
	}
	stored, _ := s.Content.StoredCard(num)
	if !strings.Contains(string(stored), "_Mask.png") {
		t.Errorf("the card was not saved with its mask: %s", stored)
	}
}

func TestRenumber(t *testing.T) {
	got := string(renumber(json.RawMessage(`[{"op":"boost","nums":[908,5]},{"op":"x","nums":[7]}]`), 908, 912))
	if got != `[{"nums":[912,5],"op":"boost"},{"nums":[7],"op":"x"}]` {
		t.Errorf("got %s", got)
	}
}
