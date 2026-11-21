package cardscout

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// SourceAPI is the outside card database the scout reads (YGOPRODeck).
const SourceAPI = "https://db.ygoprodeck.com/api/v7/cardinfo.php"

// userAgent names the scout to the card database, without any contact details.
const userAgent = "duelistRoses-cardscout/1.0"

// Summons are the kinds of summon the scout looks through, with the card
// database's type for each. Only Synchro for now: Xyz, Pendulum and Link do
// not fit this game.
var Summons = map[string]string{
	"synchro": "Synchro Monster",
}

// SourceCard is one card as the card database describes it.
type SourceCard struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Desc      string `json:"desc"`
	Race      string `json:"race"`
	Attribute string `json:"attribute"`
	// Atk and Def are nil for "?".
	Atk      *int   `json:"atk"`
	Def      *int   `json:"def"`
	Level    int    `json:"level"`
	Released string `json:"released"`
	Image    string `json:"image"`
	Small    string `json:"imageSmall"`
	Cropped  string `json:"imageCropped"`
	URL      string `json:"url"`

	// Uploaded cards: Small is a thumbnail of the card image (a data URL),
	// ArtThumb one of the art dropped with it, Hint the uploader's notes.
	Uploaded bool   `json:"uploaded,omitempty"`
	ArtThumb string `json:"artThumb,omitempty"`
	Hint     string `json:"hint,omitempty"`
}

type apiCard struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Desc      string `json:"desc"`
	Race      string `json:"race"`
	Attribute string `json:"attribute"`
	Atk       *int   `json:"atk"`
	Def       *int   `json:"def"`
	Level     int    `json:"level"`
	URL       string `json:"ygoprodeck_url"`
	Images    []struct {
		URL     string `json:"image_url"`
		Small   string `json:"image_url_small"`
		Cropped string `json:"image_url_cropped"`
	} `json:"card_images"`
	Misc []struct {
		TCG string `json:"tcg_date"`
		OCG string `json:"ocg_date"`
	} `json:"misc_info"`
}

// source reads the card database, keeping each list for a day.
type source struct {
	base   string
	client *http.Client
	mu     sync.Mutex
	lists  map[string][]SourceCard
	loaded map[string]time.Time
}

func newSource(base string) *source {
	return &source{base: base, client: &http.Client{Timeout: 60 * time.Second}, lists: map[string][]SourceCard{}, loaded: map[string]time.Time{}}
}

// cards lists every card of a summon kind, oldest release first.
func (s *source) cards(ctx context.Context, summon string) ([]SourceCard, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if list, ok := s.lists[summon]; ok && time.Since(s.loaded[summon]) < 24*time.Hour {
		return list, nil
	}
	kind, ok := Summons[summon]
	if !ok {
		return nil, fmt.Errorf("unknown summon kind %q", summon)
	}
	q := url.Values{"type": {kind}, "misc": {"yes"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("card database: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("card database answered %s", resp.Status)
	}
	var body struct {
		Data []apiCard `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("card database: %w", err)
	}
	list := make([]SourceCard, 0, len(body.Data))
	for _, c := range body.Data {
		list = append(list, c.toSource())
	}
	sortOldestFirst(list)
	s.lists[summon], s.loaded[summon] = list, time.Now()
	return list, nil
}

func (c apiCard) toSource() SourceCard {
	out := SourceCard{
		ID: c.ID, Name: c.Name, Type: c.Type, Desc: strings.ReplaceAll(c.Desc, "\r\n", "\n"),
		Race: c.Race, Attribute: c.Attribute, Atk: c.Atk, Def: c.Def, Level: c.Level, URL: c.URL,
	}
	if len(c.Images) > 0 {
		out.Image, out.Small, out.Cropped = c.Images[0].URL, c.Images[0].Small, c.Images[0].Cropped
	}
	// The first release anywhere.
	for _, m := range c.Misc {
		for _, d := range []string{m.TCG, m.OCG} {
			if d != "" && (out.Released == "" || d < out.Released) {
				out.Released = d
			}
		}
	}
	return out
}

// sortOldestFirst puts the earliest releases first; cards with no date go last.
func sortOldestFirst(list []SourceCard) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i].Released, list[j].Released
		if (a == "") != (b == "") {
			return b == ""
		}
		if a != b {
			return a < b
		}
		return list[i].ID < list[j].ID
	})
}
