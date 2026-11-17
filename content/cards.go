package content

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"duelistRoses/auth"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// The catalog lives in the database: one row per card, fusion recipe and
// starter deck. The JSON files embedded from data/ only seed an empty
// database. From then on cards are edited through the admin API below, by a
// person or an agent, and every saved version is kept in card_revisions.

// seedCatalog fills empty catalog tables from the embedded files.
func seedCatalog(database *sql.DB) error {
	empty, err := db.Empty(database, "cards")
	if err != nil || !empty {
		return err
	}
	read := func(name string) ([]json.RawMessage, error) {
		data, err := dataFS.ReadFile("data/" + name)
		if err != nil {
			return nil, err
		}
		var items []json.RawMessage
		if err := json.Unmarshal(data, &items); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return items, nil
	}
	cards, err := read("cards.json")
	if err != nil {
		return err
	}
	fusions, err := read("fusions.json")
	if err != nil {
		return err
	}
	starters, err := read("starter-decks.json")
	if err != nil {
		return err
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := db.Time(time.Now())
	for _, raw := range cards {
		var card struct{ Num int }
		if err := json.Unmarshal(raw, &card); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO cards (num, data, updated_at, updated_by) VALUES (?, ?, ?, 'seed')`, card.Num, compact(raw), now); err != nil {
			return fmt.Errorf("card %d: %w", card.Num, err)
		}
	}
	for i, raw := range fusions {
		if _, err := tx.Exec(`INSERT INTO fusions (position, data) VALUES (?, ?)`, i, compact(raw)); err != nil {
			return err
		}
	}
	for i, raw := range starters {
		var deck struct{ ID string }
		if err := json.Unmarshal(raw, &deck); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO starter_decks (id, position, data) VALUES (?, ?, ?)`, deck.ID, i, compact(raw)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func compact(raw []byte) string {
	var b bytes.Buffer
	if json.Compact(&b, raw) != nil {
		return string(raw)
	}
	return b.String()
}

// catalogRows is the catalog as stored: each card's JSON by number, and the
// fusions and starter decks in order.
type catalogRows struct {
	cards    map[int]string
	fusions  []string
	starters []string
}

func readCatalog(q interface {
	Query(string, ...any) (*sql.Rows, error)
}) (*catalogRows, error) {
	out := &catalogRows{cards: map[int]string{}}
	list := func(query string, each func(*sql.Rows) error) error {
		rows, err := q.Query(query)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := each(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	err := list(`SELECT num, data FROM cards`, func(r *sql.Rows) error {
		var num int
		var data string
		err := r.Scan(&num, &data)
		out.cards[num] = data
		return err
	})
	if err == nil {
		err = list(`SELECT data FROM fusions ORDER BY position`, func(r *sql.Rows) error {
			var data string
			err := r.Scan(&data)
			out.fusions = append(out.fusions, data)
			return err
		})
	}
	if err == nil {
		err = list(`SELECT data FROM starter_decks ORDER BY position`, func(r *sql.Rows) error {
			var data string
			err := r.Scan(&data)
			out.starters = append(out.starters, data)
			return err
		})
	}
	return out, err
}

func jsonArray(items []string) []byte {
	return []byte("[" + strings.Join(items, ",") + "]")
}

// build makes a snapshot from the rows, cards in number order.
func (c *catalogRows) build() (*snapshot, error) {
	nums := make([]int, 0, len(c.cards))
	for num := range c.cards {
		nums = append(nums, num)
	}
	sort.Ints(nums)
	cards := make([]string, len(nums))
	for i, num := range nums {
		cards[i] = c.cards[num]
	}
	catalog, starters, err := buildCatalog(jsonArray(cards), jsonArray(c.fusions), jsonArray(c.starters))
	if err != nil {
		return nil, err
	}
	return &snapshot{catalog: catalog, starters: starters}, nil
}

// reload rebuilds the catalog from the database.
func (s *Service) reload() error {
	rows, err := readCatalog(s.db)
	if err != nil {
		return err
	}
	snap, err := rows.build()
	if err != nil {
		return err
	}
	s.current.Store(snap)
	return nil
}

// --- editing cards -----------------------------------------------------------

// computedFields are added to each card when the catalog is served (see
// withFaces), so a card copied from GET /api/cards can be saved back as is.
var computedFields = []string{"frame", "template", "attributeIcon", "art", "artSmall"}

// EditResult is what saving a card answers.
type EditResult struct {
	Card     json.RawMessage `json:"card"`
	Version  string          `json:"version"`
	Warnings []string        `json:"warnings"`
}

// CardProblem is a card that cannot be saved, with the reasons.
type CardProblem struct {
	Problems []string
	Warnings []string
}

func (p *CardProblem) Error() string { return strings.Join(p.Problems, "; ") }

// SaveCard creates or replaces card num with raw (the card's JSON), as by.
// The card is checked on its own (engine.CheckCard) and then with the whole
// catalog (fusions and starter decks must still make sense); only then is it
// written, with a revision, and swapped in for new duels.
func (s *Service) SaveCard(num int, raw []byte, by, note string) (EditResult, error) {
	clean, warnings, err := prepareCard(num, raw)
	if err != nil {
		return EditResult{}, err
	}

	s.editMu.Lock()
	defer s.editMu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return EditResult{}, err
	}
	defer tx.Rollback()
	rows, err := readCatalog(tx)
	if err != nil {
		return EditResult{}, err
	}
	previous, existed := rows.cards[num]
	rows.cards[num] = string(clean)
	snap, err := rows.build()
	if err != nil {
		return EditResult{}, &CardProblem{Problems: []string{"the catalog would break: " + err.Error()}, Warnings: warnings}
	}

	now := db.Time(time.Now())
	if existed {
		// The first edit of a seeded card keeps the original, so it can be restored.
		if n, err := count(tx, `SELECT COUNT(*) FROM card_revisions WHERE num = ?`, num); err != nil {
			return EditResult{}, err
		} else if n == 0 {
			if _, err := tx.Exec(`INSERT INTO card_revisions (num, data, changed_at, changed_by, note) VALUES (?, ?, '', 'seed', 'original')`, num, previous); err != nil {
				return EditResult{}, err
			}
		}
	}
	if _, err := tx.Exec(`INSERT INTO cards (num, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
		ON CONFLICT (num) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		num, string(clean), now, by); err != nil {
		return EditResult{}, err
	}
	if _, err := tx.Exec(`INSERT INTO card_revisions (num, data, changed_at, changed_by, note) VALUES (?, ?, ?, ?, ?)`, num, string(clean), now, by, note); err != nil {
		return EditResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return EditResult{}, err
	}
	s.current.Store(snap)
	return EditResult{Card: clean, Version: snap.catalog.Version, Warnings: warnings}, nil
}

// prepareCard normalises a card's JSON and checks it on its own.
func prepareCard(num int, raw []byte) (clean []byte, warnings []string, err error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, nil, &CardProblem{Problems: []string{"the card must be a JSON object"}}
	}
	for _, f := range computedFields {
		delete(fields, f)
	}
	fields["num"], _ = json.Marshal(num)
	clean, err = json.Marshal(fields) // keys sorted, so revisions diff cleanly
	if err != nil {
		return nil, nil, err
	}
	var def engine.CardDef
	if err := json.Unmarshal(clean, &def); err != nil {
		return nil, nil, &CardProblem{Problems: []string{"a field has the wrong type: " + err.Error()}}
	}
	problems, warnings := engine.CheckCard(&def)
	if warnings == nil {
		warnings = []string{}
	}
	if len(problems) > 0 {
		return nil, nil, &CardProblem{Problems: problems, Warnings: warnings}
	}
	return clean, warnings, nil
}

// CheckCard runs every check SaveCard does, without saving: the card on its
// own, then the whole catalog with it in place. A *CardProblem says why it
// would be refused.
func (s *Service) CheckCard(num int, raw []byte) (clean json.RawMessage, warnings []string, err error) {
	clean, warnings, err = prepareCard(num, raw)
	if err != nil {
		return nil, nil, err
	}
	rows, err := readCatalog(s.db)
	if err != nil {
		return nil, nil, err
	}
	rows.cards[num] = string(clean)
	if _, err := rows.build(); err != nil {
		return nil, nil, &CardProblem{Problems: []string{"the catalog would break: " + err.Error()}, Warnings: warnings}
	}
	return clean, warnings, nil
}

// StoredCard is a card's JSON as saved, without the fields added when the
// catalog is served.
func (s *Service) StoredCard(num int) (json.RawMessage, error) {
	var data string
	if err := s.db.QueryRow(`SELECT data FROM cards WHERE num = ?`, num).Scan(&data); err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}

// Revision is one saved version of a card.
type Revision struct {
	ID        int64           `json:"id"`
	ChangedAt string          `json:"changedAt"`
	ChangedBy string          `json:"changedBy"`
	Note      string          `json:"note"`
	Card      json.RawMessage `json:"card"`
}

func (s *Service) revisions(num int) ([]Revision, error) {
	rows, err := s.db.Query(`SELECT id, changed_at, changed_by, note, data FROM card_revisions WHERE num = ? ORDER BY id DESC`, num)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Revision{}
	for rows.Next() {
		var r Revision
		var data string
		if err := rows.Scan(&r.ID, &r.ChangedAt, &r.ChangedBy, &r.Note, &data); err != nil {
			return nil, err
		}
		r.Card = json.RawMessage(data)
		out = append(out, r)
	}
	return out, rows.Err()
}

// registerCardAdmin wires the card editor's endpoints, all for administrators.
func (s *Service) registerCardAdmin(mux *http.ServeMux) {
	admin := func(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, user auth.User) {
			if !user.Admin {
				fail(w, http.StatusForbidden, "that is for administrators")
				return
			}
			next(w, r, user)
		})
	}
	cardNum := func(w http.ResponseWriter, r *http.Request) (int, bool) {
		num, err := strconv.Atoi(r.PathValue("num"))
		if err != nil || num < 0 {
			fail(w, http.StatusBadRequest, "a card number is 0 or more")
			return 0, false
		}
		return num, true
	}
	respond := func(w http.ResponseWriter, result EditResult, err error) {
		var problem *CardProblem
		switch {
		case errors.As(err, &problem):
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": problem.Error(), "problems": problem.Problems, "warnings": problem.Warnings})
		case err != nil:
			fail(w, http.StatusInternalServerError, "could not save the card")
		default:
			writeJSON(w, http.StatusOK, result)
		}
	}

	// What effects and leader abilities the engine carries out, for whoever
	// (or whatever) is designing a card.
	mux.HandleFunc("GET /api/admin/effects", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		writeJSON(w, http.StatusOK, map[string]any{"effects": engine.EffectOps, "abilities": engine.AbilityOps, "leaders": engine.LeaderOps})
	}))

	mux.HandleFunc("GET /api/admin/cards/{num}", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		num, ok := cardNum(w, r)
		if !ok {
			return
		}
		var data, updatedAt, updatedBy string
		err := s.db.QueryRow(`SELECT data, updated_at, updated_by FROM cards WHERE num = ?`, num).Scan(&data, &updatedAt, &updatedBy)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, http.StatusNotFound, "no such card")
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not read the card")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"card": json.RawMessage(data), "updatedAt": updatedAt, "updatedBy": updatedBy})
	}))

	// PUT creates or replaces a card. ?note= says why, for the history.
	mux.HandleFunc("PUT /api/admin/cards/{num}", admin(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		num, ok := cardNum(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		result, err := s.SaveCard(num, raw, user.Name, r.URL.Query().Get("note"))
		respond(w, result, err)
	}))

	// PATCH changes only the fields sent (null removes one), so an edit to a
	// stat or an effect never drops the art or anything else left out.
	mux.HandleFunc("PATCH /api/admin/cards/{num}", admin(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		num, ok := cardNum(w, r)
		if !ok {
			return
		}
		var patch map[string]json.RawMessage
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&patch); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		var data string
		if err := s.db.QueryRow(`SELECT data FROM cards WHERE num = ?`, num).Scan(&data); err != nil {
			fail(w, http.StatusNotFound, "no such card: PUT the whole card to create it")
			return
		}
		var card map[string]json.RawMessage
		if err := json.Unmarshal([]byte(data), &card); err != nil {
			fail(w, http.StatusInternalServerError, "the stored card is unreadable")
			return
		}
		for field, value := range patch {
			if string(value) == "null" {
				delete(card, field)
			} else {
				card[field] = value
			}
		}
		merged, _ := json.Marshal(card)
		result, err := s.SaveCard(num, merged, user.Name, r.URL.Query().Get("note"))
		respond(w, result, err)
	}))

	mux.HandleFunc("GET /api/admin/cards/{num}/revisions", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		num, ok := cardNum(w, r)
		if !ok {
			return
		}
		list, err := s.revisions(num)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not read the history")
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))

	// Reverting saves an old version again, as a new revision.
	mux.HandleFunc("POST /api/admin/cards/{num}/revert/{revision}", admin(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		num, ok := cardNum(w, r)
		if !ok {
			return
		}
		var data string
		err := s.db.QueryRow(`SELECT data FROM card_revisions WHERE id = ? AND num = ?`, r.PathValue("revision"), num).Scan(&data)
		if err != nil {
			fail(w, http.StatusNotFound, "no such revision of that card")
			return
		}
		result, err := s.SaveCard(num, []byte(data), user.Name, "revert to revision "+r.PathValue("revision"))
		respond(w, result, err)
	}))

	// The whole card list as cards.json is written, to commit to git as a
	// backup or to seed another server.
	mux.HandleFunc("GET /api/admin/cards/export", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		rows, err := readCatalog(s.db)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not read the catalog")
			return
		}
		nums := make([]int, 0, len(rows.cards))
		for num := range rows.cards {
			nums = append(nums, num)
		}
		sort.Ints(nums)
		cards := make([]json.RawMessage, len(nums))
		for i, num := range nums {
			cards[i] = json.RawMessage(rows.cards[num])
		}
		out, err := json.MarshalIndent(cards, "", " ")
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not write the catalog")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="cards.json"`)
		w.Write(append(out, '\n'))
	}))
}

// embeddedCatalog builds the catalog straight from the embedded seed files,
// as a fresh database would hold it (tests).
func embeddedCatalog() (*Catalog, []Deck, error) {
	read := func(name string) []byte {
		data, _ := dataFS.ReadFile("data/" + name)
		return data
	}
	return buildCatalog(read("cards.json"), read("fusions.json"), read("starter-decks.json"))
}
