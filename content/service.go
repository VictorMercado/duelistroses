package content

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"duelistRoses/auth"
)

const (
	maxDecksPerPlayer = 100
	maxMapsPerPlayer  = 50
)

// Service owns the catalog, the stored decks and maps, and the asset files.
type Service struct {
	db *sql.DB
	// current is the catalog and starter decks new duels get. An edit swaps
	// in a whole new snapshot; duels already dealt keep the one they started
	// with.
	current  atomic.Pointer[snapshot]
	editMu   sync.Mutex // one catalog edit at a time
	store    *store
	auth     *auth.Service
	assetDir string
	presets  *presets
}

type snapshot struct {
	catalog  *Catalog
	starters []Deck
}

// New opens the catalog and the deck and map store in database, seeding the
// catalog from the embedded files on first run and importing the
// content.json the server used to keep in dataDir. assetDir is served at
// /assets.
func New(dataDir string, database *sql.DB, assetDir string, accounts *auth.Service) (*Service, error) {
	// The default maps file sits in data/, beside the asset folder (content/data/maps.json).
	s := &Service{db: database, auth: accounts, assetDir: assetDir, presets: &presets{path: filepath.Join(filepath.Dir(assetDir), "data", "maps.json")}}
	artDir = assetDir // where withFaces looks for the WebP copies of the art
	if err := seedCatalog(database); err != nil {
		return nil, fmt.Errorf("seeding the catalog: %w", err)
	}
	if err := s.reload(); err != nil {
		return nil, err
	}
	st, err := openStore(database, filepath.Join(dataDir, "content.json"))
	if err != nil {
		return nil, err
	}
	s.store = st
	return s, nil
}

func (s *Service) Catalog() *Catalog { return s.current.Load().catalog }

func (s *Service) StarterDecks() []Deck {
	decks := slices.Clone(s.current.Load().starters)
	for i := range decks {
		decks[i].Cards = slices.Clone(decks[i].Cards)
	}
	return decks
}

// Deck finds a deck the user may play: a starter, a public deck or their own.
func (s *Service) Deck(id, userID string) (*Deck, error) {
	for _, d := range s.current.Load().starters {
		if d.ID == id {
			d.Cards = slices.Clone(d.Cards)
			return &d, nil
		}
	}
	d, ok := s.store.deck(id)
	if !ok || (!d.IsPublic && d.OwnerID != userID) {
		return nil, ErrNotFound
	}
	d.Cards = slices.Clone(d.Cards)
	d.DeckCost = s.Catalog().DeckCost(d.Cards)
	return &d, nil
}

// Map finds a map the user may play on: a default map, a public one or their own.
func (s *Service) Map(id, userID string) (*Map, error) {
	if m, ok := s.presets.find(id); ok {
		m.Tiles = slices.Clone(m.Tiles)
		return &m, nil
	}
	m, ok := s.store.gameMap(id)
	if !ok || (!m.IsPublic && m.OwnerID != userID) {
		return nil, ErrNotFound
	}
	m.Tiles = slices.Clone(m.Tiles)
	return &m, nil
}

// RandomMap picks one of the maps the user may play on (the default maps,
// public maps and their own) with the given size, or nil when there is none.
func (s *Service) RandomMap(userID string, size int) *Map {
	var fits []Map
	for _, m := range append(slices.Clone(s.presets.list()), s.store.visibleMaps(userID)...) {
		if m.Size == size {
			fits = append(fits, m)
		}
	}
	if len(fits) == 0 {
		return nil
	}
	m := fits[rand.IntN(len(fits))]
	m.Tiles = slices.Clone(m.Tiles)
	return &m
}

// --- HTTP ------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// viewer is whoever the request's token names, or "" for nobody.
func (s *Service) viewer(r *http.Request) auth.User {
	user, _, err := s.auth.FromRequest(r)
	if err != nil {
		return auth.User{}
	}
	return user
}

// signedIn wraps a handler that needs a signed in player.
func (s *Service) signedIn(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _, err := s.auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		next(w, r, user)
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v); err != nil {
		fail(w, http.StatusBadRequest, "malformed request")
		return false
	}
	return true
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/cards", s.serveCatalog)
	mux.HandleFunc("GET /api/terrains", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, Terrains)
	})

	mux.HandleFunc("GET /api/decks/starter", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.StarterDecks())
	})
	// ?owner=<id> lists someone else's decks, for administrators only;
	// ?made=1 lists the decks the caller built for other people.
	mux.HandleFunc("GET /api/decks", s.signedIn(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if r.URL.Query().Get("made") != "" {
			writeJSON(w, http.StatusOK, s.withCost(s.store.decksMadeBy(user.ID)))
			return
		}
		owner := user.ID
		if other := r.URL.Query().Get("owner"); other != "" && other != user.ID {
			if !user.Admin {
				fail(w, http.StatusForbidden, "that is for administrators")
				return
			}
			owner = other
		}
		writeJSON(w, http.StatusOK, s.DecksOf(owner))
	}))
	mux.HandleFunc("GET /api/decks/{id}", func(w http.ResponseWriter, r *http.Request) {
		d, err := s.Deck(r.PathValue("id"), s.viewer(r).ID)
		if err != nil {
			fail(w, http.StatusNotFound, "no such deck")
			return
		}
		writeJSON(w, http.StatusOK, d)
	})
	mux.HandleFunc("POST /api/decks", s.signedIn(s.saveDeck))
	mux.HandleFunc("PUT /api/decks/{id}", s.signedIn(s.saveDeck))
	mux.HandleFunc("DELETE /api/decks/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		target, _ := s.deckTarget(r.PathValue("id"), "", user)
		s.respondDelete(w, s.store.deleteDeck(r.PathValue("id"), target.OwnerID))
	}))

	mux.HandleFunc("GET /api/maps", func(w http.ResponseWriter, r *http.Request) {
		// The default maps first, then public maps and the viewer's own.
		writeJSON(w, http.StatusOK, append(slices.Clone(s.presets.list()), s.store.visibleMaps(s.viewer(r).ID)...))
	})
	mux.HandleFunc("GET /api/maps/{id}", func(w http.ResponseWriter, r *http.Request) {
		m, err := s.Map(r.PathValue("id"), s.viewer(r).ID)
		if err != nil {
			fail(w, http.StatusNotFound, "no such map")
			return
		}
		writeJSON(w, http.StatusOK, m)
	})
	mux.HandleFunc("POST /api/maps", s.signedIn(s.saveMap))
	mux.HandleFunc("PUT /api/maps/{id}", s.signedIn(s.saveMap))
	mux.HandleFunc("DELETE /api/maps/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		s.respondDelete(w, s.store.deleteMap(r.PathValue("id"), user.ID))
	}))

	mux.HandleFunc("GET /api/music", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, s.Music())
	})
	mux.Handle("GET /assets/", s.assets())
	s.registerCardAdmin(mux)
}

// Track is one piece of duel music. A track with an intro plays it once, then
// repeats loop; otherwise loop repeats from the start.
type Track struct {
	Name  string `json:"name"`
	Intro string `json:"intro,omitempty"`
	Loop  string `json:"loop"`
}

// Music lists the duel music: every audio file in the asset folder whose name
// starts with "VS". A pair named X_Starter and X_Loop is one track with an
// intro. The folder is read each time, so a new file is picked up at once.
func (s *Service) Music() []Track {
	entries, err := os.ReadDir(filepath.Join(s.assetDir, "audio"))
	if err != nil {
		return []Track{}
	}
	files := map[string]bool{}
	for _, e := range entries {
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !e.IsDir() && strings.HasPrefix(strings.ToLower(name), "vs") && (ext == ".mp3" || ext == ".ogg" || ext == ".wav" || ext == ".m4a") {
			files[name] = true
		}
	}
	tracks := []Track{}
	for name := range files {
		base := strings.TrimSuffix(name, filepath.Ext(name))
		lower := strings.ToLower(base)
		switch {
		case strings.HasSuffix(lower, "_starter"):
			continue // listed with its loop
		case strings.HasSuffix(lower, "_loop"):
			stem := base[:len(base)-len("_loop")]
			t := Track{Name: stem, Loop: "audio/" + name}
			for other := range files {
				if strings.EqualFold(strings.TrimSuffix(other, filepath.Ext(other)), stem+"_starter") {
					t.Intro = "audio/" + other
				}
			}
			tracks = append(tracks, t)
		default:
			tracks = append(tracks, Track{Name: base, Loop: "audio/" + name})
		}
	}
	slices.SortFunc(tracks, func(a, b Track) int { return strings.Compare(a.Name, b.Name) })
	// A starter with no loop still plays, on its own.
	for name := range files {
		base := strings.TrimSuffix(name, filepath.Ext(name))
		if strings.HasSuffix(strings.ToLower(base), "_starter") && !slices.ContainsFunc(tracks, func(t Track) bool { return t.Intro == "audio/"+name }) {
			tracks = append(tracks, Track{Name: base[:len(base)-len("_starter")], Loop: "audio/" + name})
		}
	}
	return tracks
}

// serveCatalog sends the whole catalog in one cacheable response.
func (s *Service) serveCatalog(w http.ResponseWriter, r *http.Request) {
	catalog := s.Catalog()
	etag := `"` + catalog.Version + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=60")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(catalog.payload)
}

type deckInput struct {
	Name      string `json:"name"`
	LeaderNum int    `json:"leaderNum"`
	Cards     []int  `json:"cards"`
	IsPublic  bool   `json:"isPublic"`
	// OwnerID, on a new deck, builds it for someone else: a friend, or
	// anyone for an administrator. Empty builds it for the caller.
	OwnerID string `json:"ownerId"`
}

func (s *Service) saveDeck(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in deckInput
	if !decode(w, r, &in) {
		return
	}
	if problem := CheckDeck(s.Catalog(), in.Name, in.LeaderNum, in.Cards); problem != "" {
		fail(w, http.StatusBadRequest, problem)
		return
	}
	cards := slices.Clone(in.Cards)
	slices.Sort(cards)
	target, err := s.deckTarget(r.PathValue("id"), in.OwnerID, user)
	if err != nil {
		fail(w, http.StatusForbidden, err.Error())
		return
	}
	saved, err := s.store.putDeck(Deck{
		ID: r.PathValue("id"), Name: strings.TrimSpace(in.Name), LeaderNum: in.LeaderNum, Cards: cards,
		IsPublic: in.IsPublic, OwnerID: target.OwnerID, OwnerName: target.OwnerName,
		MadeByID: target.MadeByID, MadeByName: target.MadeByName, UpdatedAt: time.Now().UTC(),
	}, maxDecksPerPlayer)
	if !s.respondSave(w, err) {
		return
	}
	saved.DeckCost = s.Catalog().DeckCost(saved.Cards)
	writeJSON(w, createdOrOK(r), saved)
}

type mapInput struct {
	Name     string   `json:"name"`
	Size     int      `json:"size"`
	Tiles    []string `json:"tiles"`
	IsPublic bool     `json:"isPublic"`
}

func (s *Service) saveMap(w http.ResponseWriter, r *http.Request, user auth.User) {
	var in mapInput
	if !decode(w, r, &in) {
		return
	}
	if problem := CheckMap(in.Name, in.Size, in.Tiles); problem != "" {
		fail(w, http.StatusBadRequest, problem)
		return
	}
	saved, err := s.store.putMap(Map{
		ID: r.PathValue("id"), Name: strings.TrimSpace(in.Name), Size: in.Size, Tiles: in.Tiles,
		IsPublic: in.IsPublic, OwnerID: user.ID, OwnerName: user.Name, UpdatedAt: time.Now().UTC(),
	}, maxMapsPerPlayer)
	if !s.respondSave(w, err) {
		return
	}
	writeJSON(w, createdOrOK(r), saved)
}

// ErrNotYours is building a deck for someone you may not build for.
var ErrNotYours = errors.New("you can only build decks for your friends")

// mayBuildFor reports whether user may build decks for the account owner:
// themselves, a friend, or anyone for an administrator.
func (s *Service) mayBuildFor(user auth.User, owner string) bool {
	return owner == user.ID || user.Admin || (!user.Guest && s.auth.Friends.AreFriends(user.ID, owner))
}

// deckTarget works out whose deck a save or delete touches. A new deck (id
// "") belongs to requested, or to the user when that is empty; building one
// for someone else records the user as its maker. An existing deck stays
// whoever's it is: its owner may change it, so may an administrator, and so
// may the friend who built it, while they are still friends. Anyone else is
// sent to their own decks, where the id is not found.
func (s *Service) deckTarget(id, requested string, user auth.User) (Deck, error) {
	self := Deck{OwnerID: user.ID, OwnerName: user.Name}
	if id != "" {
		// Who made it is kept as it was (a save never changes it).
		d, ok := s.store.deck(id)
		if !ok {
			return self, nil
		}
		mine := d.OwnerID == user.ID
		if mine || user.Admin || (d.MadeByID == user.ID && s.mayBuildFor(user, d.OwnerID)) {
			return Deck{OwnerID: d.OwnerID, OwnerName: d.OwnerName, MadeByID: d.MadeByID, MadeByName: d.MadeByName}, nil
		}
		return self, nil
	}
	if requested == "" || requested == user.ID {
		return self, nil
	}
	if !s.mayBuildFor(user, requested) {
		return Deck{}, ErrNotYours
	}
	owner, ok := s.auth.AccountByID(requested)
	if !ok {
		return Deck{}, ErrNotYours
	}
	return Deck{OwnerID: owner.ID, OwnerName: owner.Name, MadeByID: user.ID, MadeByName: user.Name}, nil
}

// DecksOf lists the decks a user owns, newest first.
func (s *Service) DecksOf(userID string) []Deck { return s.withCost(s.store.decksOf(userID)) }

func (s *Service) withCost(decks []Deck) []Deck {
	for i := range decks {
		decks[i].DeckCost = s.Catalog().DeckCost(decks[i].Cards)
	}
	return decks
}

func createdOrOK(r *http.Request) int {
	if r.Method == http.MethodPost {
		return http.StatusCreated
	}
	return http.StatusOK
}

// respondSave answers a failed save and reports whether it succeeded.
func (s *Service) respondSave(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, ErrNotFound):
		fail(w, http.StatusNotFound, "that is not yours to change")
	case errors.Is(err, ErrLimit):
		fail(w, http.StatusBadRequest, err.Error())
	default:
		fail(w, http.StatusInternalServerError, "could not save, try again")
	}
	return false
}

func (s *Service) respondDelete(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ErrNotFound):
		fail(w, http.StatusNotFound, "that is not yours to delete")
	default:
		fail(w, http.StatusInternalServerError, "could not delete, try again")
	}
}

// assetCache is how long browsers keep an asset without asking again. Asset
// URLs carry no version, so a changed file reaches a browser only after this
// runs out; past it, the browser revalidates (Last-Modified, a cheap 304) and
// may keep showing its copy for another week while it does.
const assetCache = "public, max-age=2592000, stale-while-revalidate=604800" // 30 days, +7

// assets serves the asset folder. Textures are loaded into WebGL, which needs
// CORS when the client is served from another origin.
func (s *Service) assets() http.Handler {
	files := http.StripPrefix("/assets/", http.FileServer(noListing{http.Dir(s.assetDir)}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", assetCache)
		files.ServeHTTP(w, r)
	})
}

// noListing hides directory listings: a folder without index.html is a 404.
type noListing struct{ fs http.FileSystem }

func (n noListing) Open(name string) (http.File, error) {
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	if info, err := f.Stat(); err == nil && info.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

// Collection counts what a duelist has built: their decks, how many of those
// they made public, and their maps.
func (s *Service) Collection(userID string) (decks, publicDecks, maps int) {
	for _, d := range s.store.decksOf(userID) {
		decks++
		if d.IsPublic {
			publicDecks++
		}
	}
	return decks, publicDecks, s.store.mapsOf(userID)
}
