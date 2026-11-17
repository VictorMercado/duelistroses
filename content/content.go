// Package content is everything that is content rather than gameplay: the
// card catalog, fusion recipes and starter decks (kept in the database,
// seeded on first run from the files embedded from data/), the decks and maps
// players build, and the asset files under /assets.
package content

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"duelistRoses/game/engine"
)

//go:embed data/*.json
var dataFS embed.FS

var ErrNotFound = errors.New("not found")

const (
	DeckSize  = 40
	MaxCopies = 3
)

// DestinyPool is what a Destiny Draw may hand a duelist in trouble: Raigeki,
// Mirror Force, Dian Keto the Cure Master, Woodland Sprite, Arsenal Bug, Dark
// Hole, Swords of Revealing Light and Monster Reborn. The engine picks the one
// that helps most at the time (see game/engine/destiny.go).
var DestinyPool = []int{700, 827, 707, 668, 429, 699, 715, 685}

// Terrains are the squares a map can be painted with.
var Terrains = []string{"normal", "sogen", "forest", "wasteland", "mountain", "umi", "yami", "toon", "crush", "labyrinth"}

// matcher is one side of a fusion recipe: a card, any of a list of cards (the
// game's own fusion table), or any monster of a type.
type matcher struct {
	Num  *int   `json:"num,omitempty"`
	Nums []int  `json:"nums,omitempty"`
	Type string `json:"type,omitempty"`

	set map[int]bool // Nums, built once at load; read-only after that
}

func (m *matcher) index() {
	if m.Nums != nil {
		m.set = make(map[int]bool, len(m.Nums))
		for _, n := range m.Nums {
			m.set[n] = true
		}
	}
}

func (m *matcher) accepts(def *engine.CardDef) bool {
	switch {
	case m.Num != nil:
		return def.Num == *m.Num
	case m.set != nil:
		return m.set[def.Num]
	}
	return m.Type != "" && def.Type == m.Type
}

type recipe struct {
	A      matcher `json:"a"`
	B      matcher `json:"b"`
	Result int     `json:"result"`
}

// Catalog is an immutable snapshot of the card data. It implements
// engine.Catalog.
type Catalog struct {
	Version string
	cards   map[int]*engine.CardDef
	recipes []recipe
	// Which monsters get the ritual frame. (Fusion monsters are marked on
	// the card itself; see engine.CardDef.Fusion.)
	ritualMonsters map[int]bool
	// payload is the whole catalog as served at /api/cards. Cards are passed
	// through as stored: fields only the client uses (art,
	// flags) never need a change here.
	payload []byte
}

func (c *Catalog) Card(num int) *engine.CardDef { return c.cards[num] }

func (c *Catalog) Size() int { return len(c.cards) }

// Defs is every card, by number.
func (c *Catalog) Defs() []*engine.CardDef {
	out := make([]*engine.CardDef, 0, len(c.cards))
	for _, d := range c.cards {
		out = append(out, d)
	}
	slices.SortFunc(out, func(a, b *engine.CardDef) int { return a.Num - b.Num })
	return out
}

// Fuse finds what two cards combine into, or nil. Recipes are tried in order
// and the first match wins, as in the game's own table. A type pair (only in
// hand-written recipes) applies only when the result is stronger than both.
func (c *Catalog) Fuse(a, b *engine.CardDef) *engine.CardDef {
	for i := range c.recipes {
		r := &c.recipes[i]
		if !(r.A.accepts(a) && r.B.accepts(b)) && !(r.A.accepts(b) && r.B.accepts(a)) {
			continue
		}
		result := c.cards[r.Result]
		if result == nil || result.Num == a.Num || result.Num == b.Num {
			continue
		}
		byType := r.A.Type != "" || r.B.Type != ""
		if byType && (result.Atk <= a.Atk || result.Atk <= b.Atk) {
			continue
		}
		return result
	}
	return nil
}

// DeckCost totals the deck cost of a list of cards.
func (c *Catalog) DeckCost(cards []int) int {
	total := 0
	for _, num := range cards {
		if def := c.cards[num]; def != nil {
			total += def.DeckCost
		}
	}
	return total
}

// NewCatalog builds a catalog from definitions directly (tests, tools).
func NewCatalog(cards []*engine.CardDef) *Catalog {
	c := &Catalog{cards: map[int]*engine.CardDef{}}
	for _, card := range cards {
		c.cards[card.Num] = card
	}
	return c
}

// buildCatalog makes a catalog snapshot, and the starter decks checked
// against it, from the card list, fusion recipes and starter decks as JSON
// arrays (from the database; see cards.go).
func buildCatalog(cardsRaw, fusionsRaw, startersRaw []byte) (*Catalog, []Deck, error) {
	var defs []*engine.CardDef
	if err := json.Unmarshal(cardsRaw, &defs); err != nil {
		return nil, nil, fmt.Errorf("cards: %w", err)
	}
	if len(defs) == 0 {
		return nil, nil, errors.New("the catalog has no cards")
	}
	catalog := NewCatalog(defs)
	if err := json.Unmarshal(fusionsRaw, &catalog.recipes); err != nil {
		return nil, nil, fmt.Errorf("fusions: %w", err)
	}
	for i := range catalog.recipes {
		catalog.recipes[i].A.index()
		catalog.recipes[i].B.index()
	}

	cardsJSON, err := withFaces(cardsRaw, catalog, defs)
	if err != nil {
		return nil, nil, fmt.Errorf("cards: %w", err)
	}

	// The version doubles as an ETag, so clients revalidate for free.
	var compact bytes.Buffer
	if err := json.Compact(&compact, fusionsRaw); err != nil {
		return nil, nil, err
	}
	fusionsJSON := compact.Bytes()
	sum := sha256.New()
	sum.Write(cardsJSON)
	sum.Write(fusionsJSON)
	catalog.Version = hex.EncodeToString(sum.Sum(nil))[:16]
	catalog.payload, err = json.Marshal(map[string]any{
		"version": catalog.Version,
		"cards":   json.RawMessage(cardsJSON),
		"fusions": json.RawMessage(fusionsJSON),
	})
	if err != nil {
		return nil, nil, err
	}

	var starters []Deck
	if err := json.Unmarshal(startersRaw, &starters); err != nil {
		return nil, nil, fmt.Errorf("starter decks: %w", err)
	}
	for i := range starters {
		d := &starters[i]
		d.IsPublic, d.Starter, d.OwnerName = true, true, "Duelist City"
		d.DeckCost = catalog.DeckCost(d.Cards)
		if problem := CheckDeck(catalog, d.Name, d.LeaderNum, d.Cards); problem != "" {
			return nil, nil, fmt.Errorf("starter deck %q: %s", d.ID, problem)
		}
	}
	return catalog, starters, nil
}

// --- card faces ------------------------------------------------------------

// Frame is which card template a card is drawn on: its own, if it has one,
// otherwise the one for the sort of card it is.
func (c *Catalog) Frame(def *engine.CardDef) string {
	if def.OwnFrame != "" {
		return def.OwnFrame
	}
	switch def.Kind {
	case engine.KindMonster:
	case engine.KindTrap:
		return "trap"
	default: // spells, and ritual cards, which are spells that summon a ritual monster
		return "spell"
	}
	switch {
	case def.Fusion:
		return "fusion"
	case c.ritualMonsters[def.Num]:
		return "ritual"
	case def.Text != "":
		return "effect"
	default:
		return "normal"
	}
}

// AttributeIcon is the icon in a card's attribute circle, relative to /assets.
func AttributeIcon(def *engine.CardDef) string {
	switch {
	case def.Kind == engine.KindMonster && def.Attribute == "divine":
		// Cut from the God card scans (scripts/content/build_god_cards.py), so not a drawing like the rest.
		return "attributes/divine_attribute.png"
	case def.Kind == engine.KindMonster && def.Attribute != "":
		return "attributes/" + def.Attribute + "_attribute.svg"
	case def.Kind == engine.KindTrap:
		return "attributes/trap_attribute.svg"
	case def.Kind != engine.KindMonster:
		return "attributes/spell_attribute.svg"
	}
	return ""
}

// artDir is the asset folder, where artVariants looks for the WebP copies of
// the art. Empty (tests, the embedded catalog): no copies, the PNG is used.
var artDir string

// artVariants names the WebP copies of a card's art (cards/NNN.png ->
// cards/NNN.webp at 512px and cards/sm/NNN.webp at 256px, made by
// scripts/content/build_webp.sh), each only when the file is there.
func artVariants(image string) (full, small string) {
	if artDir == "" || !strings.HasSuffix(image, ".png") {
		return "", ""
	}
	dir, file := path.Split(strings.TrimSuffix(image, ".png") + ".webp")
	exists := func(p string) bool {
		info, err := os.Stat(filepath.Join(artDir, filepath.FromSlash(p)))
		return err == nil && !info.IsDir()
	}
	if p := dir + file; exists(p) {
		full = p
	}
	if p := dir + "sm/" + file; exists(p) {
		small = p
	}
	return full, small
}

// withFaces adds what the client needs to draw each card's face to the raw
// card list: "frame", "template", "attributeIcon", and the WebP copies of the
// art ("art", "artSmall") where they exist. Everything else in a card passes
// through untouched.
func withFaces(cardsRaw []byte, c *Catalog, defs []*engine.CardDef) ([]byte, error) {
	// A ritual card's text ends "... to summon <monster>."
	var summoned []string
	for _, def := range defs {
		if def.Kind == engine.KindRitual {
			if i := strings.LastIndex(def.Text, "summon"); i >= 0 {
				summoned = append(summoned, def.Text[i:])
			}
		}
	}
	rituals := strings.Join(summoned, " ")
	c.ritualMonsters = map[int]bool{}
	for _, def := range defs {
		if def.Kind == engine.KindMonster && strings.Contains(rituals, def.Name) {
			c.ritualMonsters[def.Num] = true
		}
	}

	var cards []map[string]json.RawMessage
	if err := json.Unmarshal(cardsRaw, &cards); err != nil {
		return nil, err
	}
	for i, card := range cards {
		def := defs[i]
		frame := c.Frame(def)
		card["frame"], _ = json.Marshal(frame)
		card["template"], _ = json.Marshal("textures/" + frame + "Template.png")
		if icon := AttributeIcon(def); icon != "" {
			card["attributeIcon"], _ = json.Marshal(icon)
		}
		var image string
		_ = json.Unmarshal(card["image"], &image) // no image: no copies
		full, small := artVariants(image)
		if full != "" {
			card["art"], _ = json.Marshal(full)
		}
		if small != "" {
			card["artSmall"], _ = json.Marshal(small)
		}
	}
	return json.Marshal(cards)
}

// --- what players build ----------------------------------------------------

type Deck struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	LeaderNum int    `json:"leaderNum"`
	Cards     []int  `json:"cards"`
	IsPublic  bool   `json:"isPublic"`
	// DeckCost is worked out from the catalog whenever a deck is sent out.
	DeckCost  int    `json:"deckCost"`
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	// MadeBy is who built the deck for its owner (a friend or an
	// administrator); empty when the owner built it.
	MadeByID    string    `json:"madeById,omitempty"`
	MadeByName  string    `json:"madeByName,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Description string    `json:"description,omitempty"`
	Starter     bool      `json:"starter,omitempty"`
}

type Map struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Size      int       `json:"size"`
	Tiles     []string  `json:"tiles"` // row by row from the south-west corner
	IsPublic  bool      `json:"isPublic"`
	OwnerID   string    `json:"ownerId"`
	OwnerName string    `json:"ownerName"`
	UpdatedAt time.Time `json:"updatedAt"`
	// Preset marks a default map from data/maps.json: everyone has it, nobody can change it.
	Preset bool `json:"preset,omitempty"`
}

// TileMap converts a map's flat tile list into board squares.
func (m *Map) TileMap() map[engine.Pos]string {
	half := m.Size / 2
	tiles := make(map[engine.Pos]string, len(m.Tiles))
	for i, terrain := range m.Tiles {
		tiles[engine.Pos{X: i%m.Size - half, Y: i/m.Size - half}] = terrain
	}
	return tiles
}

// --- rules -----------------------------------------------------------------

func checkName(thing, name string) string {
	if n := utf8.RuneCountInString(strings.TrimSpace(name)); n == 0 || n > 40 {
		return fmt.Sprintf("A %s needs a name of 1 to 40 characters.", thing)
	}
	return ""
}

// CheckDeck says what is wrong with a deck, or "" when it is legal.
func CheckDeck(c *Catalog, name string, leaderNum int, cards []int) string {
	if problem := checkName("deck", name); problem != "" {
		return problem
	}
	if len(cards) != DeckSize {
		return fmt.Sprintf("A deck has exactly %d cards; this one has %d.", DeckSize, len(cards))
	}
	copies := map[int]int{}
	gods := 0
	for _, num := range cards {
		def := c.Card(num)
		if def == nil {
			return fmt.Sprintf("Card %d does not exist.", num)
		}
		if def.Locked {
			return fmt.Sprintf("%s is locked.", def.Name)
		}
		if copies[num]++; copies[num] > MaxCopies {
			return fmt.Sprintf("A deck holds at most %d copies of a card (%s).", MaxCopies, def.Name)
		}
		if def.IsGod() {
			if gods++; gods > 1 {
				return "A deck holds at most 1 God card."
			}
		}
	}
	leader := c.Card(leaderNum)
	if leader == nil || !leader.IsMonster() {
		return "The deck leader must be a monster."
	}
	if leader.Locked {
		return fmt.Sprintf("%s is locked.", leader.Name)
	}
	return ""
}

// CheckMap says what is wrong with a map, or "" when it is legal.
func CheckMap(name string, size int, tiles []string) string {
	if problem := checkName("map", name); problem != "" {
		return problem
	}
	if size < 5 || size > 13 || size%2 == 0 {
		return "A map is 5, 7, 9, 11 or 13 squares wide."
	}
	if len(tiles) != size*size {
		return fmt.Sprintf("A %dx%d map needs %d tiles.", size, size, size*size)
	}
	for _, tile := range tiles {
		if !slices.Contains(Terrains, tile) {
			return fmt.Sprintf("%q is not a terrain.", tile)
		}
	}
	return ""
}
