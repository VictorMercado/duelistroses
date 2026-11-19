// Package replay records duels and keeps them, to be watched again later.
//
// A replay is a recording, not a re-simulation: every step of the duel is
// kept as the board looked after it, with nothing hidden, together with the
// action that caused it. Played back it shows what happened even after the
// rules or the cards have changed since.
//
// The recording is one gzipped JSON document, written as the duel goes:
//
//	{"v":1,"room":{...},"frames":[{...},{...}],"end":{...}}
//
// Consecutive frames are nearly identical, so one gzip stream across the
// whole duel keeps it small, in memory while recording and on disk after.
//
// Anyone may watch any replay: there are no permissions yet.
package replay

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"
)

// Version is the format of the recording, for clients to check.
const Version = 1

// MaxBytes caps a recording's compressed size; past it, steps are no longer
// recorded (the duel still is, up to there). A long duel is well under it.
const MaxBytes = 32 << 20

// NewID makes a replay id.
func NewID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Recorder writes one duel's recording. It is not safe for concurrent use:
// the room that owns it calls it from its own goroutine.
type Recorder struct {
	buf    bytes.Buffer
	zw     *gzip.Writer
	steps  int
	full   bool
	closed bool
	err    error
}

// NewRecorder starts a recording; room is what the duel looked like as it
// began (who sat where), written first.
func NewRecorder(room any) *Recorder {
	r := &Recorder{}
	r.zw, _ = gzip.NewWriterLevel(&r.buf, gzip.BestCompression)
	head, err := json.Marshal(room)
	if err != nil {
		r.err = err
		return r
	}
	r.write([]byte(`{"v":1,"room":`))
	r.write(head)
	r.write([]byte(`,"frames":[`))
	return r
}

func (r *Recorder) write(b []byte) {
	if r.err == nil {
		_, r.err = r.zw.Write(b)
	}
}

// Add records one step. A step that cannot be encoded, or that would take the
// recording past MaxBytes, is dropped, as is every one after it.
func (r *Recorder) Add(frame any) {
	if r == nil || r.closed || r.full || r.err != nil {
		return
	}
	b, err := json.Marshal(frame)
	if err != nil {
		r.err = err
		return
	}
	if r.buf.Len()+len(b) > MaxBytes {
		r.full = true
		return
	}
	if r.steps > 0 {
		r.write([]byte{','})
	}
	r.write(b)
	r.steps++
}

// Steps is how many steps have been recorded.
func (r *Recorder) Steps() int {
	if r == nil {
		return 0
	}
	return r.steps
}

// Finish ends the recording with end (how the duel ended) and returns it,
// gzipped. A recorder is finished once; after that it records nothing.
func (r *Recorder) Finish(end any) ([]byte, error) {
	if r == nil {
		return nil, errors.New("nothing was recorded")
	}
	if r.closed {
		return nil, errors.New("the recording is already finished")
	}
	r.closed = true
	tail, err := json.Marshal(end)
	if err != nil {
		return nil, err
	}
	r.write([]byte(`],"end":`))
	r.write(tail)
	r.write([]byte{'}'})
	if r.err == nil {
		r.err = r.zw.Close()
	}
	if r.err != nil {
		return nil, r.err
	}
	return r.buf.Bytes(), nil
}

// Player is one seat of a recorded duel.
type Player struct {
	UserID string `json:"userId,omitempty"`
	Name   string `json:"name"`
	Team   int    `json:"team"`
	Bot    bool   `json:"bot,omitempty"`
	Deck   string `json:"deck,omitempty"`
}

// Meta is what is known about a replay without playing it.
type Meta struct {
	ID       string    `json:"id"`
	Room     string    `json:"room"`
	Mode     string    `json:"mode"`
	Map      string    `json:"map"`
	Started  time.Time `json:"started"`
	Ended    time.Time `json:"ended"`
	Finished bool      `json:"finished"`
	// WinnerTeam is -1 for a draw or a duel that never finished.
	WinnerTeam int      `json:"winnerTeam"`
	Turns      int      `json:"turns"`
	Steps      int      `json:"steps"`
	Players    []Player `json:"players"`
}

// timeFormat is fixed width, so times sort as text.
const timeFormat = "2006-01-02T15:04:05.000000000Z"

// ErrNotFound is a replay that does not exist.
var ErrNotFound = errors.New("there is no such replay")

// Store keeps replays in the replays table.
type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Save files a finished recording.
func (s *Store) Save(m Meta, frames []byte) error {
	if s == nil {
		return nil
	}
	players, err := json.Marshal(m.Players)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO replays (id, room, mode, map, started_at, ended_at, finished, winner_team, turns, steps, players, frames)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Room, m.Mode, m.Map, m.Started.UTC().Format(timeFormat), m.Ended.UTC().Format(timeFormat),
		m.Finished, m.WinnerTeam, m.Turns, m.Steps, string(players), frames); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, p := range m.Players {
		if p.UserID == "" || seen[p.UserID] {
			continue
		}
		seen[p.UserID] = true
		if _, err := tx.Exec(`INSERT INTO replay_players (replay_id, user_id) VALUES (?, ?)`, m.ID, p.UserID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

const metaColumns = `r.id, r.room, r.mode, r.map, r.started_at, r.ended_at, r.finished, r.winner_team, r.turns, r.steps, r.players`

func scanMeta(row interface{ Scan(...any) error }) (Meta, error) {
	var m Meta
	var started, ended, players string
	if err := row.Scan(&m.ID, &m.Room, &m.Mode, &m.Map, &started, &ended, &m.Finished, &m.WinnerTeam, &m.Turns, &m.Steps, &players); err != nil {
		return m, err
	}
	m.Started, _ = time.Parse(timeFormat, started)
	m.Ended, _ = time.Parse(timeFormat, ended)
	if err := json.Unmarshal([]byte(players), &m.Players); err != nil || m.Players == nil {
		m.Players = []Player{}
	}
	return m, nil
}

// Get returns a replay's description.
func (s *Store) Get(id string) (Meta, error) {
	m, err := scanMeta(s.db.QueryRow(`SELECT `+metaColumns+` FROM replays r WHERE r.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

// Frames returns a replay's recording, gzipped.
func (s *Store) Frames(id string) ([]byte, error) {
	var b []byte
	err := s.db.QueryRow(`SELECT frames FROM replays WHERE id = ?`, id).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return b, err
}

// List returns the latest replays, newest first: everyone's, or one
// account's when userID is set. before, if not zero, lists only replays that
// ended before it, for paging.
func (s *Store) List(userID string, before time.Time, limit int) ([]Meta, error) {
	q := `SELECT ` + metaColumns + ` FROM replays r`
	var args []any
	var where []string
	if userID != "" {
		q += ` JOIN replay_players p ON p.replay_id = r.id`
		where = append(where, `p.user_id = ?`)
		args = append(args, userID)
	}
	if !before.IsZero() {
		where = append(where, `r.ended_at < ?`)
		args = append(args, before.UTC().Format(timeFormat))
	}
	for i, w := range where {
		if i == 0 {
			q += ` WHERE ` + w
		} else {
			q += ` AND ` + w
		}
	}
	q += ` ORDER BY r.ended_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Meta{}
	for rows.Next() {
		m, err := scanMeta(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Gunzip unpacks a recording, for a client that does not take gzip.
func Gunzip(frames []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(frames))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(zr)
}
