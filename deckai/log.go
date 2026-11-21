package deckai

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"time"

	"duelistRoses/bot"
	"duelistRoses/db"
)

// Entry is one message to the assistant, as logged.
type Entry struct {
	ID         int64      `json:"id"`
	At         time.Time  `json:"at"`
	UserID     string     `json:"userId"`
	UserName   string     `json:"userName"`
	Session    string     `json:"session"`
	Model      string     `json:"model"`
	Message    string     `json:"message"`
	Reply      string     `json:"reply"`
	Steps      []string   `json:"steps"`
	Proposals  []Proposal `json:"proposals"`
	Refusals   int        `json:"refusals"`
	Usage      bot.Usage  `json:"usage"`
	CostUSD    float64    `json:"costUsd"`
	DurationMS int64      `json:"durationMs"`
	Error      string     `json:"error,omitempty"`
}

// ModelStats sums up how one model has done.
type ModelStats struct {
	Model   string `json:"model"`
	Queries int    `json:"queries"`
	Failed  int    `json:"failed"`
	// WithDeck is answers that proposed at least one deck.
	WithDeck     int     `json:"withDeck"`
	Decks        int     `json:"decks"`
	Refusals     int     `json:"refusals"`
	TotalCost    float64 `json:"totalCostUsd"`
	AvgCost      float64 `json:"avgCostUsd"`
	AvgCostDeck  float64 `json:"avgCostPerDeckUsd"`
	AvgSeconds   float64 `json:"avgSeconds"`
	AvgCalls     float64 `json:"avgCalls"`
	AvgOutput    float64 `json:"avgOutputTokens"`
	AvgFusions   float64 `json:"avgFusionsPerDeck"`
	CacheHitRate float64 `json:"cacheHitRate"`
}

func (a *Assistant) record(e Entry) {
	if a.db == nil {
		return
	}
	steps, _ := json.Marshal(nonNil(e.Steps))
	proposals, _ := json.Marshal(e.Proposals)
	if e.Proposals == nil {
		proposals = []byte("[]")
	}
	u := e.Usage
	if _, err := a.db.Exec(`INSERT INTO deck_assist_log
		(created_at, user_id, user_name, session, model, message, reply, steps, proposals, refusals, calls, input, output, cache_read, cache_write, cost_usd, duration_ms, error)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		db.Time(e.At), e.UserID, e.UserName, e.Session, e.Model, e.Message, e.Reply, string(steps), string(proposals), e.Refusals,
		u.Calls, u.Input, u.Output, u.CacheRead, u.CacheWrite, e.CostUSD, e.DurationMS, e.Error); err != nil {
		log.Printf("deck assistant: logging: %v", err)
	}
	log.Printf("deck assistant: %s, %s, $%.4f, %.1fs", e.UserName, e.Model, e.CostUSD, float64(e.DurationMS)/1000)
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// Log is the newest entries since a time, newest first, at most limit.
func (a *Assistant) Log(since time.Time, limit int) ([]Entry, error) {
	if a.db == nil {
		return []Entry{}, nil
	}
	rows, err := a.db.Query(`SELECT id, created_at, user_id, user_name, session, model, message, reply, steps, proposals, refusals,
		calls, input, output, cache_read, cache_write, cost_usd, duration_ms, error
		FROM deck_assist_log WHERE created_at >= ? ORDER BY id DESC LIMIT ?`, db.Time(since), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var at, steps, proposals string
		u := &e.Usage
		if err := rows.Scan(&e.ID, &at, &e.UserID, &e.UserName, &e.Session, &e.Model, &e.Message, &e.Reply, &steps, &proposals, &e.Refusals,
			&u.Calls, &u.Input, &u.Output, &u.CacheRead, &u.CacheWrite, &e.CostUSD, &e.DurationMS, &e.Error); err != nil {
			return nil, err
		}
		e.At = db.ParseTime(at)
		json.Unmarshal([]byte(steps), &e.Steps)
		json.Unmarshal([]byte(proposals), &e.Proposals)
		e.Steps = nonNil(e.Steps)
		if e.Proposals == nil {
			e.Proposals = []Proposal{}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Stats sums up every model's entries since a time, busiest first.
func (a *Assistant) Stats(since time.Time) ([]ModelStats, error) {
	if a.db == nil {
		return []ModelStats{}, nil
	}
	rows, err := a.db.Query(`SELECT model, proposals, refusals, calls, input, output, cache_read, cache_write, cost_usd, duration_ms, error
		FROM deck_assist_log WHERE created_at >= ?`, db.Time(since))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type sums struct {
		ModelStats
		calls, output, fusions, input, cacheRead, ms float64
	}
	by := map[string]*sums{}
	var order []string
	for rows.Next() {
		var model, proposals, failure string
		var refusals, calls, input, output, cacheRead, cacheWrite, ms int64
		var cost float64
		if err := rows.Scan(&model, &proposals, &refusals, &calls, &input, &output, &cacheRead, &cacheWrite, &cost, &ms, &failure); err != nil {
			return nil, err
		}
		s := by[model]
		if s == nil {
			s = &sums{ModelStats: ModelStats{Model: model}}
			by[model] = s
			order = append(order, model)
		}
		var decks []Proposal
		json.Unmarshal([]byte(proposals), &decks)
		s.Queries++
		if failure != "" {
			s.Failed++
		}
		if len(decks) > 0 {
			s.WithDeck++
		}
		s.Decks += len(decks)
		for _, d := range decks {
			s.fusions += float64(d.Fusions)
		}
		s.Refusals += int(refusals)
		s.TotalCost += cost
		s.ms += float64(ms)
		s.calls += float64(calls)
		s.output += float64(output)
		s.input += float64(input + cacheRead + cacheWrite)
		s.cacheRead += float64(cacheRead)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ModelStats, 0, len(order))
	for _, m := range order {
		s := by[m]
		n := float64(s.Queries)
		s.AvgCost = s.TotalCost / n
		s.AvgSeconds = s.ms / n / 1000
		s.AvgCalls = s.calls / n
		s.AvgOutput = s.output / n
		if s.Decks > 0 {
			s.AvgCostDeck = s.TotalCost / float64(s.Decks)
			s.AvgFusions = s.fusions / float64(s.Decks)
		}
		if s.input > 0 {
			s.CacheHitRate = s.cacheRead / s.input
		}
		out = append(out, s.ModelStats)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Queries > out[j].Queries })
	return out, nil
}

// PlayerModel is the model players' conversations use.
func (a *Assistant) PlayerModel() string {
	if a.db != nil {
		var m string
		if err := a.db.QueryRow(`SELECT player_model FROM deck_assist_settings WHERE id = 1`).Scan(&m); err == nil {
			if _, ok := bot.FindModel(m); ok {
				return m
			}
		}
	}
	return a.DefaultModel
}

// SetPlayerModel picks the model players' new conversations use.
func (a *Assistant) SetPlayerModel(model string) error {
	if _, ok := bot.FindModel(model); !ok {
		return fmt.Errorf("unknown model %q", model)
	}
	if a.db == nil {
		return errors.New("no database")
	}
	_, err := a.db.Exec(`INSERT INTO deck_assist_settings (id, player_model) VALUES (1, ?)
		ON CONFLICT (id) DO UPDATE SET player_model = excluded.player_model`, model)
	return err
}
