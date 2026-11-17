package content

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"duelistRoses/db"
)

// store keeps the decks and maps players build in the decks and maps tables.
type store struct{ db *sql.DB }

// openStore opens the deck and map store, importing the content.json file at
// legacy (kept before the database) into empty tables.
func openStore(database *sql.DB, legacy string) (*store, error) {
	s := &store{db: database}
	decksEmpty, err := db.Empty(database, "decks")
	if err != nil {
		return nil, err
	}
	mapsEmpty, err := db.Empty(database, "maps")
	if err != nil || !decksEmpty || !mapsEmpty {
		return s, err
	}
	return s, db.ImportLegacy(legacy, func(data []byte) error {
		var file struct {
			Decks []Deck `json:"decks"`
			Maps  []Map  `json:"maps"`
		}
		if err := json.Unmarshal(data, &file); err != nil {
			return err
		}
		tx, err := database.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, d := range file.Decks {
			if err := writeDeck(tx, d, true); err != nil {
				return err
			}
		}
		for _, m := range file.Maps {
			if err := writeMap(tx, m, true); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

// ErrLimit is a player trying to keep more decks or maps than allowed.
var ErrLimit = errors.New("that is the most you can keep")

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // no randomness, no safe ids
	}
	return hex.EncodeToString(b)
}

type execer interface {
	Exec(string, ...any) (sql.Result, error)
}

type querier interface {
	QueryRow(string, ...any) *sql.Row
}

// count runs a COUNT(*) query.
func count(q querier, query string, args ...any) (int, error) {
	var n int
	err := q.QueryRow(query, args...).Scan(&n)
	return n, err
}

// --- decks -----------------------------------------------------------------

const deckColumns = `id, owner_id, owner_name, name, leader_num, cards, is_public, description, updated_at, made_by_id, made_by_name`

func scanDeck(row interface{ Scan(...any) error }) (Deck, error) {
	var d Deck
	var cards, updated string
	if err := row.Scan(&d.ID, &d.OwnerID, &d.OwnerName, &d.Name, &d.LeaderNum, &cards, &d.IsPublic, &d.Description, &updated, &d.MadeByID, &d.MadeByName); err != nil {
		return Deck{}, err
	}
	d.UpdatedAt = db.ParseTime(updated)
	return d, json.Unmarshal([]byte(cards), &d.Cards)
}

func writeDeck(x execer, d Deck, insert bool) error {
	cards, err := json.Marshal(d.Cards)
	if err != nil {
		return err
	}
	if cards == nil || string(cards) == "null" {
		cards = []byte("[]")
	}
	if insert {
		_, err = x.Exec(`INSERT INTO decks (`+deckColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.ID, d.OwnerID, d.OwnerName, d.Name, d.LeaderNum, string(cards), db.Bool(d.IsPublic), d.Description, db.Time(d.UpdatedAt), d.MadeByID, d.MadeByName)
	} else {
		_, err = x.Exec(`UPDATE decks SET owner_name = ?, name = ?, leader_num = ?, cards = ?, is_public = ?, description = ?, updated_at = ? WHERE id = ?`,
			d.OwnerName, d.Name, d.LeaderNum, string(cards), db.Bool(d.IsPublic), d.Description, db.Time(d.UpdatedAt), d.ID)
	}
	return err
}

func (s *store) decks(where string, args ...any) []Deck {
	list := []Deck{}
	rows, err := s.db.Query(`SELECT `+deckColumns+` FROM decks WHERE `+where+` ORDER BY updated_at DESC`, args...)
	if err != nil {
		return list
	}
	defer rows.Close()
	for rows.Next() {
		if d, err := scanDeck(rows); err == nil {
			list = append(list, d)
		}
	}
	return list
}

func (s *store) deck(id string) (Deck, bool) {
	d, err := scanDeck(s.db.QueryRow(`SELECT `+deckColumns+` FROM decks WHERE id = ?`, id))
	return d, err == nil
}

func (s *store) decksOf(owner string) []Deck { return s.decks(`owner_id = ?`, owner) }

// decksMadeBy lists the decks someone built for other people.
func (s *store) decksMadeBy(maker string) []Deck {
	return s.decks(`made_by_id = ? AND owner_id <> ?`, maker, maker)
}

// putDeck adds a deck (empty ID) or replaces one its owner already has.
func (s *store) putDeck(d Deck, limit int) (Deck, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Deck{}, err
	}
	defer tx.Rollback()
	insert := d.ID == ""
	if insert {
		owned, err := count(tx, `SELECT COUNT(*) FROM decks WHERE owner_id = ?`, d.OwnerID)
		if err != nil {
			return Deck{}, err
		}
		if owned >= limit {
			return Deck{}, fmt.Errorf("%w: you have %d decks, delete one first", ErrLimit, limit)
		}
		d.ID = newID()
	} else if n, err := count(tx, `SELECT COUNT(*) FROM decks WHERE id = ? AND owner_id = ?`, d.ID, d.OwnerID); err != nil {
		return Deck{}, err
	} else if n == 0 {
		return Deck{}, ErrNotFound
	}
	if err := writeDeck(tx, d, insert); err != nil {
		return Deck{}, err
	}
	return d, tx.Commit()
}

func (s *store) deleteDeck(id, owner string) error {
	return deleted(s.db.Exec(`DELETE FROM decks WHERE id = ? AND owner_id = ?`, id, owner))
}

// deleted turns a DELETE that touched nothing into ErrNotFound.
func deleted(r sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil || n == 0 {
		return ErrNotFound
	}
	return nil
}

// --- maps ------------------------------------------------------------------

const mapColumns = `id, owner_id, owner_name, name, size, tiles, is_public, updated_at`

func scanMap(row interface{ Scan(...any) error }) (Map, error) {
	var m Map
	var tiles, updated string
	if err := row.Scan(&m.ID, &m.OwnerID, &m.OwnerName, &m.Name, &m.Size, &tiles, &m.IsPublic, &updated); err != nil {
		return Map{}, err
	}
	m.UpdatedAt = db.ParseTime(updated)
	return m, json.Unmarshal([]byte(tiles), &m.Tiles)
}

func writeMap(x execer, m Map, insert bool) error {
	tiles, err := json.Marshal(m.Tiles)
	if err != nil {
		return err
	}
	if string(tiles) == "null" {
		tiles = []byte("[]")
	}
	if insert {
		_, err = x.Exec(`INSERT INTO maps (`+mapColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			m.ID, m.OwnerID, m.OwnerName, m.Name, m.Size, string(tiles), db.Bool(m.IsPublic), db.Time(m.UpdatedAt))
	} else {
		_, err = x.Exec(`UPDATE maps SET owner_name = ?, name = ?, size = ?, tiles = ?, is_public = ?, updated_at = ? WHERE id = ?`,
			m.OwnerName, m.Name, m.Size, string(tiles), db.Bool(m.IsPublic), db.Time(m.UpdatedAt), m.ID)
	}
	return err
}

func (s *store) gameMap(id string) (Map, bool) {
	m, err := scanMap(s.db.QueryRow(`SELECT `+mapColumns+` FROM maps WHERE id = ?`, id))
	return m, err == nil
}

// visibleMaps lists public maps plus the viewer's own.
func (s *store) visibleMaps(viewer string) []Map {
	list := []Map{}
	rows, err := s.db.Query(`SELECT `+mapColumns+` FROM maps WHERE is_public = 1 OR (? <> '' AND owner_id = ?) ORDER BY updated_at DESC`, viewer, viewer)
	if err != nil {
		return list
	}
	defer rows.Close()
	for rows.Next() {
		if m, err := scanMap(rows); err == nil {
			list = append(list, m)
		}
	}
	return list
}

func (s *store) putMap(m Map, limit int) (Map, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Map{}, err
	}
	defer tx.Rollback()
	insert := m.ID == ""
	if insert {
		owned, err := count(tx, `SELECT COUNT(*) FROM maps WHERE owner_id = ?`, m.OwnerID)
		if err != nil {
			return Map{}, err
		}
		if owned >= limit {
			return Map{}, fmt.Errorf("%w: you have %d maps, delete one first", ErrLimit, limit)
		}
		m.ID = newID()
	} else if n, err := count(tx, `SELECT COUNT(*) FROM maps WHERE id = ? AND owner_id = ?`, m.ID, m.OwnerID); err != nil {
		return Map{}, err
	} else if n == 0 {
		return Map{}, ErrNotFound
	}
	if err := writeMap(tx, m, insert); err != nil {
		return Map{}, err
	}
	return m, tx.Commit()
}

func (s *store) deleteMap(id, owner string) error {
	return deleted(s.db.Exec(`DELETE FROM maps WHERE id = ? AND owner_id = ?`, id, owner))
}

// mapsOf counts the maps a user owns.
func (s *store) mapsOf(owner string) int {
	n, _ := count(s.db, `SELECT COUNT(*) FROM maps WHERE owner_id = ?`, owner)
	return n
}
