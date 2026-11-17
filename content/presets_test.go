package content

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestParsePresets(t *testing.T) {
	data := []byte(`{"maps": [
		{"name": "Letters", "rows": ["M N N N N", "N N N N N", "N N N N N", "N N N N N", "U N N N L"]},
		{"id": "Run", "name": "Run Together", "rows": ["MNNNN", "NNNNN", "NNNNN", "NNNNN", "NNNNY"]},
		{"id": "names", "name": "Names", "rows": ["toon normal normal normal normal", "n n n n n", "n n n n n", "n n n n n", "n n n n crush"]},
		{"id": "short", "name": "Short Row", "rows": ["N N N N N", "N N N N", "N N N N N", "N N N N N", "N N N N N"]},
		{"id": "bad", "name": "Bad Letter", "rows": ["N N N N N", "N N Q N N", "N N N N N", "N N N N N", "N N N N N"]},
		{"id": "even", "name": "Even", "rows": ["NNNNNN", "NNNNNN", "NNNNNN", "NNNNNN", "NNNNNN", "NNNNNN"]},
		{"id": "run", "name": "Duplicate", "rows": ["NNNNN", "NNNNN", "NNNNN", "NNNNN", "NNNNN"]}
	]}`)
	maps, problems := parsePresets(data)
	if len(maps) != 3 || len(problems) != 4 {
		t.Fatalf("got %d maps and problems %q; want 3 maps and 4 problems", len(maps), problems)
	}
	letters := maps[0]
	if letters.ID != "default-letters" || !letters.Preset || !letters.IsPublic || letters.Size != 5 {
		t.Fatalf("unexpected map %+v", letters)
	}
	// Tiles run from the south-west corner: the file's last row comes first.
	if letters.Tiles[0] != "umi" || letters.Tiles[4] != "labyrinth" || letters.Tiles[20] != "mountain" {
		t.Fatalf("rows not flipped: %v", letters.Tiles)
	}
	if maps[1].ID != "default-run" || maps[1].Tiles[4] != "yami" {
		t.Fatalf("letters run together: %+v", maps[1])
	}
	if maps[2].Tiles[20] != "toon" || maps[2].Tiles[4] != "crush" {
		t.Fatalf("full names: %v", maps[2].Tiles)
	}
	for _, want := range []string{"row 2 has 4", `"q" is not a terrain`, "5, 7, 9", "unique id"} {
		if !slices.ContainsFunc(problems, func(p string) bool { return strings.Contains(p, want) }) {
			t.Errorf("no problem mentioning %q in %q", want, problems)
		}
	}
}

func TestPresetsReloadWhenTheFileChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "maps.json")
	write := func(name string, at time.Time) {
		body := `{"maps": [{"name": "` + name + `", "rows": ["NNNNN", "NNNNN", "NNNNN", "NNNNN", "NNNNN"]}]}`
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(path, at, at)
	}
	p := &presets{path: path}
	write("First", time.Now().Add(-time.Minute))
	if got := p.list(); len(got) != 1 || got[0].Name != "First" {
		t.Fatalf("got %+v", got)
	}
	write("Second", time.Now())
	if _, ok := p.find("default-second"); !ok {
		t.Fatalf("edit not picked up: %+v", p.list())
	}
	// A broken file keeps the last good maps.
	os.WriteFile(path, []byte("{"), 0o644)
	os.Chtimes(path, time.Now().Add(time.Minute), time.Now().Add(time.Minute))
	if got := p.list(); len(got) != 1 || got[0].Name != "Second" {
		t.Fatalf("broken file dropped the maps: %+v", got)
	}
}
