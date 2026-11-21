// Package cardscout is the card scout: a background worker that goes through
// the outside card database (Synchro monsters for now, oldest first), asks
// Claude for up to two ways each card could work in this game, and keeps them
// for an administrator to review in the admin portal. Accepting one saves the
// card to the catalog and makes its art, WebP copies and holo mask (see
// accept.go). Nothing reaches the catalog without an administrator's accept.
package cardscout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"duelistRoses/bot"
	"duelistRoses/cardlab"
	"duelistRoses/content"
	"duelistRoses/db"
)

const (
	// Tool rounds one card may take before Claude must suggest its options.
	maxRounds = 10
	// Each option's card is checked as this number; the real one is given on accept.
	maxOptions = 2
)

// Statuses of a suggestion.
const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusRejected = "rejected"
	StatusFailed   = "failed"
	// StatusWorking is an uploaded card Claude is still reading.
	StatusWorking = "working"
)

// Option is one way a card could work in this game, checked against the
// engine when Claude suggested it.
type Option struct {
	Title        string          `json:"title"`
	Card         json.RawMessage `json:"card"`
	Summary      string          `json:"summary"`
	NewBehaviour string          `json:"newBehaviour,omitempty"`
	Warnings     []string        `json:"warnings"`
	// CheckedNum is the number the card was checked as. A card that names
	// itself (abilities with "nums": [CheckedNum]) is renumbered on accept.
	CheckedNum int `json:"checkedNum,omitempty"`
}

// Suggestion is one scouted card and its options.
type Suggestion struct {
	ID        int64      `json:"id"`
	SourceID  int        `json:"sourceId"`
	Name      string     `json:"name"`
	Summon    string     `json:"summon"`
	Released  string     `json:"released"`
	Source    SourceCard `json:"source"`
	Status    string     `json:"status"`
	Options   []Option   `json:"options"`
	Note      string     `json:"note"`
	Model     string     `json:"model"`
	CostUSD   float64    `json:"costUsd"`
	CreatedAt string     `json:"createdAt"`
	DecidedAt string     `json:"decidedAt"`
	DecidedBy string     `json:"decidedBy"`
	Chosen    *int       `json:"chosen"`
	CardNum   *int       `json:"cardNum"`
	Assets    string     `json:"assets"`
	AssetsLog string     `json:"assetsLog"`
}

// Config is how a scout runs.
type Config struct {
	// Model is the Claude model that adapts the cards.
	Model string
	// Interval is the wait between two cards while running.
	Interval time.Duration
	// DailyLimit caps the cards scouted per day (UTC), to bound the cost.
	DailyLimit int
	// AssetDir is the asset folder (ASSET_DIR): art goes to its cards/.
	AssetDir string
	// Scripts is the folder holding build_webp.sh and build_masks.py.
	Scripts string
	// MaskModel is the rembg model build_masks.py uses ("" for its default).
	MaskModel string
	// SourceURL is the card database's API (SourceAPI when empty).
	SourceURL string
	// UploadDir keeps the card images administrators upload.
	UploadDir string
}

// Scout is the worker and its store.
type Scout struct {
	Content   *content.Service
	Lab       *cardlab.Lab
	DB        *sql.DB
	Available bool
	Config    Config

	model  bot.Model
	client anthropic.Client
	src    *source
	wake   chan scanRequest

	mu        sync.Mutex
	running   bool
	busy      string // the card being scouted, "" when idle
	lastScan  time.Time
	lastError string

	acceptMu sync.Mutex
	assetsMu sync.Mutex
}

// New makes a scout; Run starts it. available is whether Anthropic
// credentials were found.
func New(c *content.Service, lab *cardlab.Lab, database *sql.DB, available bool, cfg Config) *Scout {
	m, ok := bot.FindModel(cfg.Model)
	if !ok {
		m = bot.Model{ID: cfg.Model, Label: cfg.Model}
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 5 * time.Minute
	}
	if cfg.DailyLimit <= 0 {
		cfg.DailyLimit = 60
	}
	if cfg.SourceURL == "" {
		cfg.SourceURL = SourceAPI
	}
	return &Scout{
		Content: c, Lab: lab, DB: database, Available: available, Config: cfg,
		model: m, client: anthropic.NewClient(), src: newSource(cfg.SourceURL), wake: make(chan scanRequest, 1),
	}
}

// Run scouts one card every Interval while the scout is switched on, until
// ctx ends. Whether it is on survives restarts.
func (s *Scout) Run(ctx context.Context) {
	var running int
	_ = s.DB.QueryRow(`SELECT running FROM card_scout_state WHERE id = 1`).Scan(&running)
	s.mu.Lock()
	s.running = running == 1 && s.Available
	s.mu.Unlock()
	if s.running {
		log.Printf("card scout: running, one card every %s", s.Config.Interval)
	}

	timer := time.NewTimer(30 * time.Second) // let the server settle first
	defer timer.Stop()
	for {
		var asked scanRequest
		select {
		case <-ctx.Done():
			return
		case asked = <-s.wake:
		case <-timer.C:
		}
		s.mu.Lock()
		on := s.running
		s.mu.Unlock()
		if on || asked.manual {
			if err := s.scanNext(ctx, asked.sourceID, asked.manual); err != nil {
				log.Printf("card scout: %v", err)
			}
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(s.Config.Interval)
	}
}

// SetRunning switches the background scouting on or off.
func (s *Scout) SetRunning(on bool) error {
	if on && !s.Available {
		return errors.New("no Anthropic credentials on the server")
	}
	v := 0
	if on {
		v = 1
	}
	if _, err := s.DB.Exec(`INSERT INTO card_scout_state (id, running) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET running = excluded.running`, v); err != nil {
		return err
	}
	s.mu.Lock()
	s.running = on
	s.mu.Unlock()
	if on {
		// Start now rather than after a whole interval (within the daily limit).
		select {
		case s.wake <- scanRequest{}:
		default:
		}
	}
	return nil
}

// scanRequest asks the worker for a scan now: manual ones run even while the
// scout is paused and ignore the daily limit.
type scanRequest struct {
	sourceID int
	manual   bool
}

// ScanSoon scouts a card now, whether or not the scout is running: the
// card database's card sourceID, or the next one when 0.
func (s *Scout) ScanSoon(sourceID int) {
	select {
	case s.wake <- scanRequest{sourceID: sourceID, manual: true}:
	default:
	}
}

// Status is what the admin portal shows about the worker.
type Status struct {
	Available  bool           `json:"available"`
	Running    bool           `json:"running"`
	Busy       string         `json:"busy"`
	LastScan   string         `json:"lastScan"`
	LastError  string         `json:"lastError"`
	Model      string         `json:"model"`
	IntervalS  int            `json:"intervalSeconds"`
	DailyLimit int            `json:"dailyLimit"`
	Today      int            `json:"today"`
	Counts     map[string]int `json:"counts"`
	// Left is how many cards of the source list are not scouted yet (-1: the
	// list was not read yet).
	Left     int      `json:"left"`
	SpentUSD float64  `json:"spentUsd"`
	Summons  []string `json:"summons"`
}

func (s *Scout) Status() Status {
	s.mu.Lock()
	st := Status{
		Available: s.Available, Running: s.running, Busy: s.busy, LastScan: db.Time(s.lastScan), LastError: s.lastError,
		Model: s.model.ID, IntervalS: int(s.Config.Interval / time.Second), DailyLimit: s.Config.DailyLimit,
		Counts: map[string]int{}, Left: -1, Summons: []string{"synchro"},
	}
	s.mu.Unlock()
	st.Today = s.today()
	rows, err := s.DB.Query(`SELECT status, COUNT(*), COALESCE(SUM(cost_usd), 0) FROM card_suggestions GROUP BY status`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var status string
			var n int
			var cost float64
			if rows.Scan(&status, &n, &cost) == nil {
				st.Counts[status] = n
				st.SpentUSD += cost
			}
		}
	}
	s.src.mu.Lock()
	list, ok := s.src.lists["synchro"]
	s.src.mu.Unlock()
	if ok {
		seen := s.seen()
		names := s.catalogNames()
		st.Left = 0
		for _, c := range list {
			if !seen[c.ID] && !names[strings.ToLower(c.Name)] {
				st.Left++
			}
		}
	}
	return st
}

// today counts the cards scouted since midnight UTC.
func (s *Scout) today() int {
	var n int
	midnight := time.Now().UTC().Truncate(24 * time.Hour)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM card_suggestions WHERE created_at >= ?`, db.Time(midnight)).Scan(&n)
	return n
}

func (s *Scout) seen() map[int]bool {
	out := map[int]bool{}
	rows, err := s.DB.Query(`SELECT source_id FROM card_suggestions`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			out[id] = true
		}
	}
	return out
}

func (s *Scout) catalogNames() map[string]bool {
	out := map[string]bool{}
	for _, d := range s.Content.Catalog().Defs() {
		out[strings.ToLower(d.Name)] = true
	}
	return out
}

// scanNext scouts one card: sourceID, or else the oldest not scouted yet and
// not already in the catalog. manual scans ignore the daily limit.
func (s *Scout) scanNext(ctx context.Context, sourceID int, manual bool) error {
	if !s.Available {
		return errors.New("no Anthropic credentials on the server")
	}
	if !manual && s.today() >= s.Config.DailyLimit {
		return nil
	}
	fail := func(err error) error {
		s.mu.Lock()
		s.lastError = err.Error()
		s.mu.Unlock()
		return err
	}
	list, err := s.src.cards(ctx, "synchro")
	if err != nil {
		return fail(err)
	}
	seen, names := s.seen(), s.catalogNames()
	var card *SourceCard
	for i := range list {
		c := &list[i]
		if sourceID != 0 {
			if c.ID == sourceID {
				card = c
				break
			}
			continue
		}
		if !seen[c.ID] && !names[strings.ToLower(c.Name)] {
			card = c
			break
		}
	}
	if card == nil {
		if sourceID != 0 {
			return fail(fmt.Errorf("card %d is not in the card database's list", sourceID))
		}
		return nil // every card is scouted
	}

	s.mu.Lock()
	if s.busy != "" {
		s.mu.Unlock()
		return nil
	}
	s.busy = card.Name
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.busy, s.lastScan = "", time.Now()
		s.mu.Unlock()
	}()

	feedback := s.takeFeedback(card.ID)
	res, err := s.adapt(ctx, []anthropic.ContentBlockParamUnion{anthropic.NewTextBlock(describeSource(card, feedback))}, false)
	options, note, cost := res.Options, res.Note, res.Cost
	status := StatusPending
	if err != nil {
		status, note = StatusFailed, err.Error()
		log.Printf("card scout: %s: %v", card.Name, err)
	} else {
		log.Printf("card scout: suggested %d option(s) for %s ($%.4f)", len(options), card.Name, cost)
		s.mu.Lock()
		s.lastError = ""
		s.mu.Unlock()
	}
	if options == nil {
		options = []Option{}
	}
	src, _ := json.Marshal(card)
	opts, _ := json.Marshal(options)
	_, err = s.DB.Exec(`INSERT INTO card_suggestions (source_id, name, summon, released, source, status, options, note, model, cost_usd, created_at)
		VALUES (?, ?, 'synchro', ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (source_id) DO UPDATE SET status = excluded.status, options = excluded.options, note = excluded.note,
			model = excluded.model, cost_usd = card_suggestions.cost_usd + excluded.cost_usd, created_at = excluded.created_at,
			source = excluded.source, decided_at = '', decided_by = ''`,
		card.ID, card.Name, card.Released, string(src), status, string(opts), note, s.model.ID, cost, db.Time(time.Now()))
	if err != nil {
		return fail(fmt.Errorf("saving the suggestion for %s: %w", card.Name, err))
	}
	return nil
}

// --- feedback for a rescan ---------------------------------------------------

var (
	feedbackMu sync.Mutex
	feedbacks  = map[int]string{}
)

func (s *Scout) takeFeedback(id int) string {
	feedbackMu.Lock()
	defer feedbackMu.Unlock()
	f := feedbacks[id]
	delete(feedbacks, id)
	return f
}

// --- reading the store ---------------------------------------------------------

const columns = `id, source_id, name, summon, released, source, status, options, note, model, cost_usd,
	created_at, decided_at, decided_by, chosen, card_num, assets, assets_log`

func scan(row interface{ Scan(...any) error }) (Suggestion, error) {
	var g Suggestion
	var src, opts string
	var chosen, num sql.NullInt64
	err := row.Scan(&g.ID, &g.SourceID, &g.Name, &g.Summon, &g.Released, &src, &g.Status, &opts, &g.Note, &g.Model, &g.CostUSD,
		&g.CreatedAt, &g.DecidedAt, &g.DecidedBy, &chosen, &num, &g.Assets, &g.AssetsLog)
	if err != nil {
		return g, err
	}
	_ = json.Unmarshal([]byte(src), &g.Source)
	_ = json.Unmarshal([]byte(opts), &g.Options)
	if g.Options == nil {
		g.Options = []Option{}
	}
	if chosen.Valid {
		v := int(chosen.Int64)
		g.Chosen = &v
	}
	if num.Valid {
		v := int(num.Int64)
		g.CardNum = &v
	}
	return g, nil
}

// List is the suggestions with this status ("" for all), pending ones first
// in the order they were found, then the rest newest first.
func (s *Scout) List(status string, limit int) ([]Suggestion, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	q := `SELECT ` + columns + ` FROM card_suggestions WHERE (? = '' OR status = ?)
		ORDER BY CASE status WHEN 'working' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
			CASE status WHEN 'pending' THEN released ELSE '' END, decided_at DESC, id DESC LIMIT ?`
	rows, err := s.DB.Query(q, status, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Suggestion{}
	for rows.Next() {
		g, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ErrNotFound is a suggestion that does not exist.
var ErrNotFound = errors.New("no such suggestion")

func (s *Scout) get(id int64) (Suggestion, error) {
	g, err := scan(s.DB.QueryRow(`SELECT `+columns+` FROM card_suggestions WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return g, ErrNotFound
	}
	return g, err
}

// Reject sets a pending or failed suggestion aside.
func (s *Scout) Reject(id int64, by string) error {
	res, err := s.DB.Exec(`UPDATE card_suggestions SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ? AND status IN ('pending', 'failed')`,
		db.Time(time.Now()), by, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("only a pending or failed suggestion can be rejected")
	}
	return nil
}

// Rescan asks Claude again for a card that was not accepted, with the
// administrator's feedback, if any.
func (s *Scout) Rescan(id int64, feedback string) error {
	g, err := s.get(id)
	if err != nil {
		return err
	}
	if g.Status == StatusAccepted {
		return errors.New("that card is already in the catalog")
	}
	if !s.Available {
		return errors.New("no Anthropic credentials on the server")
	}
	if g.Summon == SummonUpload {
		return s.rereadUpload(g, feedback)
	}
	feedbackMu.Lock()
	feedbacks[g.SourceID] = strings.TrimSpace(feedback)
	feedbackMu.Unlock()
	s.ScanSoon(g.SourceID)
	return nil
}
