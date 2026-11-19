// Package profile keeps each duelist's record: lifetime totals of what they
// did in their duels (see engine.Stats), wins and losses, the decks they won
// with, who they keep meeting, and their latest matches. Only accounts have a
// record; a guest's identity does not last long enough to be worth one.
package profile

import (
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// Seat is one player of a finished duel.
type Seat struct {
	UserID string `json:"userId,omitempty"` // empty for a computer player
	Name   string `json:"name"`
	Guest  bool   `json:"-"`
	Bot    bool   `json:"bot,omitempty"`
	Team   int    `json:"team"`
	Deck   string `json:"deck,omitempty"`
	LP     int    `json:"lp"`

	Conceded bool         `json:"conceded,omitempty"`
	Stats    engine.Stats `json:"-"`
}

// Match is a finished duel as the room reports it.
type Match struct {
	Room    string
	Mode    string
	Map     string
	Turns   int
	Started time.Time
	Ended   time.Time
	// WinnerTeam is -1 for a draw.
	WinnerTeam int
	StartLP    int
	Seats      []Seat
	// Replay is the id of the duel's recording, empty if there is none.
	Replay string
}

const (
	Win  = "win"
	Loss = "loss"
	Draw = "draw"
)

func (m Match) resultFor(team int) string {
	switch m.WinnerTeam {
	case -1:
		return Draw
	case team:
		return Win
	}
	return Loss
}

// Tally is games played and won with or against something.
type Tally struct {
	Games int `json:"games"`
	Wins  int `json:"wins"`
}

func (t *Tally) add(result string) {
	t.Games++
	if result == Win {
		t.Wins++
	}
}

// Summary is one match from a player's side, for their match history.
type Summary struct {
	At        time.Time    `json:"at"`
	Room      string       `json:"room"`
	Mode      string       `json:"mode"`
	Map       string       `json:"map"`
	Result    string       `json:"result"`
	Conceded  bool         `json:"conceded,omitempty"`
	Deck      string       `json:"deck,omitempty"`
	LP        int          `json:"lp"`
	Turns     int          `json:"turns"`
	Seconds   int          `json:"seconds"`
	Allies    []Seat       `json:"allies"`
	Opponents []Seat       `json:"opponents"`
	Stats     engine.Stats `json:"stats"`
	// Replay is the id of the duel's recording (see package replay).
	Replay string `json:"replay,omitempty"`
}

// Record is everything kept about one duelist.
type Record struct {
	Name string `json:"name"`

	Games    int `json:"games"`
	Wins     int `json:"wins"`
	Losses   int `json:"losses"`
	Draws    int `json:"draws"`
	Concedes int `json:"concedes"`
	// Flawless wins are won without losing a single life point.
	Flawless int `json:"flawless"`

	VsHumans Tally `json:"vsHumans"`
	VsBots   Tally `json:"vsBots"`
	OneVOne  Tally `json:"oneVOne"`
	TwoVTwo  Tally `json:"twoVTwo"`

	// Streak is the current run: positive for wins, negative for losses
	// (a draw ends either). BestStreak is the longest run of wins.
	Streak     int `json:"streak"`
	BestStreak int `json:"bestStreak"`

	Turns   int `json:"turns"`
	Seconds int `json:"seconds"`
	// FastestWin is the fewest turns a win took, 0 before the first win.
	FastestWin int `json:"fastestWin"`

	Totals engine.Stats `json:"totals"`
	// Best is the best single duel for each stat.
	Best engine.Stats `json:"best"`

	Decks     map[string]*Tally `json:"decks"`     // by deck name
	Opponents map[string]*Tally `json:"opponents"` // by opponent name
	Maps      map[string]*Tally `json:"maps"`      // by map name

	First  time.Time `json:"first"`
	Last   time.Time `json:"last"`
	Recent []Summary `json:"recent"` // newest first
}

const recentLimit = 25

// Store holds every duelist's record, by account id, in the profiles table.
type Store struct{ db *sql.DB }

// Open opens the record store, importing the profiles.json file at legacy
// (kept before the database) into an empty table.
func Open(database *sql.DB, legacy string) (*Store, error) {
	s := &Store{db: database}
	empty, err := db.Empty(database, "profiles")
	if err != nil || !empty {
		return s, err
	}
	return s, db.ImportLegacy(legacy, func(data []byte) error {
		var records map[string]json.RawMessage
		if err := json.Unmarshal(data, &records); err != nil {
			return err
		}
		tx, err := database.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for id, record := range records {
			if _, err := tx.Exec(`INSERT INTO profiles (user_id, record) VALUES (?, ?)`, id, string(record)); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

// load reads one record, nil when the duelist has none.
func load(q interface {
	QueryRow(string, ...any) *sql.Row
}, userID string) (*Record, error) {
	var data string
	err := q.QueryRow(`SELECT record FROM profiles WHERE user_id = ?`, userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r := &Record{}
	return r, json.Unmarshal([]byte(data), r)
}

// Record adds a finished duel to the record of every account that played it.
func (s *Store) Record(m Match) error {
	if s == nil {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, seat := range m.Seats {
		if seat.UserID == "" || seat.Guest || seat.Bot {
			continue
		}
		r, err := load(tx, seat.UserID)
		if err != nil {
			return err
		}
		if r == nil {
			r = &Record{}
		}
		r.add(m, seat)
		data, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO profiles (user_id, record) VALUES (?, ?)
			ON CONFLICT (user_id) DO UPDATE SET record = excluded.record`, seat.UserID, string(data)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Get returns a duelist's record; a duelist who never finished a duel gets an
// empty one.
func (s *Store) Get(userID string) Record {
	r, err := load(s.db, userID)
	if err != nil || r == nil {
		return Record{Recent: []Summary{}}
	}
	if r.Recent == nil {
		r.Recent = []Summary{}
	}
	r.Decks, r.Opponents, r.Maps = nil, nil, nil // see Top
	return *r
}

// Top lists a record's most played decks, opponents and maps.
func (s *Store) Top(userID string, n int) (decks, opponents, maps []Named) {
	r, err := load(s.db, userID)
	if err != nil || r == nil {
		return []Named{}, []Named{}, []Named{}
	}
	return top(r.Decks, n), top(r.Opponents, n), top(r.Maps, n)
}

// Named is a tally with what it counts.
type Named struct {
	Name string `json:"name"`
	Tally
}

func top(m map[string]*Tally, n int) []Named {
	out := make([]Named, 0, len(m))
	for name, t := range m {
		out = append(out, Named{name, *t})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Games != out[j].Games {
			return out[i].Games > out[j].Games
		}
		if out[i].Wins != out[j].Wins {
			return out[i].Wins > out[j].Wins
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func tally(m *map[string]*Tally, key, result string) {
	if key == "" {
		return
	}
	if *m == nil {
		*m = map[string]*Tally{}
	}
	t := (*m)[key]
	if t == nil {
		t = &Tally{}
		(*m)[key] = t
	}
	t.add(result)
}

func (r *Record) add(m Match, me Seat) {
	result := m.resultFor(me.Team)
	seconds := int(m.Ended.Sub(m.Started).Seconds())
	r.Name = me.Name

	r.Games++
	switch result {
	case Win:
		r.Wins++
		r.Streak = max(r.Streak, 0) + 1
		r.BestStreak = max(r.BestStreak, r.Streak)
		if me.Stats.DamageTaken == 0 {
			r.Flawless++
		}
		if r.FastestWin == 0 || m.Turns < r.FastestWin {
			r.FastestWin = m.Turns
		}
	case Loss:
		r.Losses++
		r.Streak = min(r.Streak, 0) - 1
	default:
		r.Draws++
		r.Streak = 0
	}
	if me.Conceded {
		r.Concedes++
	}
	r.Turns += m.Turns
	r.Seconds += seconds
	if r.First.IsZero() {
		r.First = m.Ended
	}
	r.Last = m.Ended

	r.Totals.Add(me.Stats)
	r.Best.Best(me.Stats)

	summary := Summary{
		At: m.Ended, Room: m.Room, Mode: m.Mode, Map: m.Map, Result: result, Conceded: me.Conceded,
		Deck: me.Deck, LP: me.LP, Turns: m.Turns, Seconds: seconds, Stats: me.Stats, Replay: m.Replay,
		Allies: []Seat{}, Opponents: []Seat{},
	}
	humans := false
	for _, other := range m.Seats {
		if other.UserID == me.UserID && !other.Bot {
			continue
		}
		if other.Team == me.Team {
			summary.Allies = append(summary.Allies, other)
			continue
		}
		summary.Opponents = append(summary.Opponents, other)
		humans = humans || !other.Bot
		tally(&r.Opponents, other.Name, result)
	}
	if humans {
		r.VsHumans.add(result)
	} else {
		r.VsBots.add(result)
	}
	if m.Mode == "2v2" {
		r.TwoVTwo.add(result)
	} else {
		r.OneVOne.add(result)
	}
	tally(&r.Decks, me.Deck, result)
	tally(&r.Maps, m.Map, result)

	r.Recent = append([]Summary{summary}, r.Recent...)
	if len(r.Recent) > recentLimit {
		r.Recent = r.Recent[:recentLimit]
	}
}
