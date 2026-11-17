package content

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// Default maps: boards everyone gets, written by hand in data/maps.json.
//
// The file is read from disk (content/data/maps.json, next to the asset
// folder) whenever it changes, so an edit shows up without a restart. When
// there is no file on disk (the Docker image only has the binary), the copy
// embedded at build time is used.
//
// Each map is laid out as rows of terrain, the top row being the far
// (north) edge of the board as it is drawn in the file:
//
//	{
//	  "maps": [
//	    {
//	      "id": "crossroads",
//	      "name": "Crossroads",
//	      "rows": [
//	        "N N F F F N N",
//	        "..."
//	      ]
//	    }
//	  ]
//	}
//
// A row is either letters separated by spaces ("N M M F"), letters run
// together ("NMMF"), or full terrain names ("normal mountain mountain forest").
// The letters are listed in terrainLetters. A map may give "tiles" instead of
// "rows": the flat list the API uses, row by row from the south-west corner.

// presetPrefix marks a default map's id, so it can never collide with a stored map.
const presetPrefix = "default-"

// presetOwner is shown as the author of every default map.
const presetOwner = "Duelist City"

var terrainLetters = map[string]string{
	"n": "normal", "s": "sogen", "f": "forest", "w": "wasteland", "m": "mountain",
	"u": "umi", "y": "yami", "t": "toon", "c": "crush", "l": "labyrinth",
}

type presetFile struct {
	Maps []presetInput `json:"maps"`
}

type presetInput struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Rows  []string `json:"rows"`
	Tiles []string `json:"tiles"`
}

// presets keeps the default maps, re-reading the file when it changes.
type presets struct {
	path string // on disk; "" to use only the embedded copy

	mu       sync.Mutex
	modified time.Time
	loaded   bool
	maps     []Map
}

// list returns the default maps, reloading them first if the file changed.
func (p *presets) list() []Map {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.refresh()
	return p.maps
}

func (p *presets) find(id string) (Map, bool) {
	if !strings.HasPrefix(id, presetPrefix) {
		return Map{}, false
	}
	for _, m := range p.list() {
		if m.ID == id {
			return m, true
		}
	}
	return Map{}, false
}

func (p *presets) refresh() {
	var data []byte
	var modified time.Time
	info, err := os.Stat(p.path)
	switch {
	case p.path != "" && err == nil:
		if p.loaded && info.ModTime().Equal(p.modified) {
			return
		}
		modified = info.ModTime()
		if data, err = os.ReadFile(p.path); err != nil {
			log.Printf("default maps: %v", err)
			return
		}
	case p.loaded:
		return // nothing on disk: the embedded copy was already read
	default:
		data, err = dataFS.ReadFile("data/maps.json")
		if errors.Is(err, fs.ErrNotExist) {
			p.loaded = true
			return
		}
		if err != nil {
			log.Printf("default maps: %v", err)
			return
		}
	}

	maps, problems := parsePresets(data)
	for _, problem := range problems {
		log.Printf("default maps: %s", problem)
	}
	// A file that does not parse at all keeps the maps from the last good one.
	if maps == nil && len(problems) > 0 && p.loaded {
		p.modified = modified
		return
	}
	p.maps, p.modified, p.loaded = maps, modified, true
	log.Printf("default maps: %d loaded", len(maps))
}

// parsePresets reads a maps.json file. A map with a problem is skipped and
// reported; the rest still load.
func parsePresets(data []byte) ([]Map, []string) {
	var file presetFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, []string{fmt.Sprintf("maps.json is not valid JSON: %v", err)}
	}
	maps := []Map{}
	var problems []string
	seen := map[string]bool{}
	for i, in := range file.Maps {
		label := fmt.Sprintf("map %d (%q)", i+1, in.Name)
		id := strings.ToLower(strings.TrimSpace(in.ID))
		if id == "" {
			id = slug(in.Name)
		}
		if id == "" || seen[id] {
			problems = append(problems, label+": needs a unique id")
			continue
		}
		tiles, size, problem := presetTiles(in)
		if problem == "" {
			problem = CheckMap(in.Name, size, tiles)
		}
		if problem != "" {
			problems = append(problems, label+": "+problem)
			continue
		}
		seen[id] = true
		maps = append(maps, Map{
			ID: presetPrefix + id, Name: strings.TrimSpace(in.Name), Size: size, Tiles: tiles,
			IsPublic: true, OwnerName: presetOwner, Preset: true,
		})
	}
	return maps, problems
}

// presetTiles turns a map's rows (or flat tiles) into the stored tile order:
// row by row from the south-west corner.
func presetTiles(in presetInput) ([]string, int, string) {
	if len(in.Rows) == 0 {
		size := 0
		for size*size < len(in.Tiles) {
			size++
		}
		tiles := make([]string, len(in.Tiles))
		for i, t := range in.Tiles {
			tiles[i] = strings.ToLower(strings.TrimSpace(t))
		}
		return tiles, size, ""
	}
	size := len(in.Rows)
	tiles := make([]string, 0, size*size)
	// The file lists the north edge first; tiles start from the south.
	for r := size - 1; r >= 0; r-- {
		row := strings.TrimSpace(in.Rows[r])
		cells := strings.Fields(row)
		if len(cells) == 1 && len(row) > 1 {
			cells = strings.Split(row, "") // letters run together
		}
		if len(cells) != size {
			return nil, 0, fmt.Sprintf("row %d has %d squares; a map with %d rows needs %d in each", r+1, len(cells), size, size)
		}
		for _, cell := range cells {
			cell = strings.ToLower(cell)
			if name, ok := terrainLetters[cell]; ok {
				cell = name
			}
			if !slices.Contains(Terrains, cell) {
				return nil, 0, fmt.Sprintf("row %d: %q is not a terrain (letters: N S F W M U Y T C L)", r+1, cell)
			}
			tiles = append(tiles, cell)
		}
	}
	return tiles, size, ""
}

func slug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case b.Len() > 0 && !dash:
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}
