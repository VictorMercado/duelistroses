package game

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/game/engine"
)

// The arena plays test duels between computer players for administrators:
// no room, no clients, no pacing, many at once. It answers questions like
// "does the LLM beat the rule-based bot, and what does that cost?".
//
// Games are dealt in pairs with the same seed (same decks, map and shuffles)
// and the sides swapped, so neither side is favoured by its deck or by moving
// first.

const (
	arenaMaxGames    = 200
	arenaMaxParallel = 16
	arenaKeepJobs    = 20
	// A game that runs this many actions without finishing is abandoned.
	arenaMaxSteps = 20000
	// LLM comments kept per game, to show how it talks and plays.
	arenaKeepComments = 40
)

// ArenaSpec is what an administrator asks for.
type ArenaSpec struct {
	// A and B are bot kinds: "bot" (balanced), a personality ("aggressive",
	// "builder", "defensive") or "llm:<model id>".
	A        string `json:"a"`
	B        string `json:"b"`
	Games    int    `json:"games"`
	Parallel int    `json:"parallel"`
	Mode     string `json:"mode"` // "1v1" or "2v2"
	// BudgetUSD stops the job once its LLM calls have cost this much.
	BudgetUSD float64 `json:"budgetUsd"`
}

// ArenaKind is a player the arena can field.
type ArenaKind struct {
	ID    string     `json:"id"`
	Label string     `json:"label"`
	Note  string     `json:"note,omitempty"`
	Model *bot.Model `json:"model,omitempty"`
}

// ArenaSide is one of the two players of a job, and how it is doing.
type ArenaSide struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Wins  int    `json:"wins"`
	// LLM players only.
	Usage     *bot.Usage `json:"usage,omitempty"`
	CostUSD   float64    `json:"costUsd"`
	Priced    bool       `json:"priced"`
	llm       *bot.LLM
	model     bot.Model
	heuristic bot.Heuristic
}

func (s *ArenaSide) player() bot.Bot {
	if s.llm != nil {
		return s.llm
	}
	return s.heuristic
}

// ArenaGame is one duel of a job.
type ArenaGame struct {
	N      int    `json:"n"`
	Seed   int64  `json:"seed"`
	Status string `json:"status"` // queued, playing, done, cancelled, error
	// AFirst: side A sat in seat 0 (team 0) and moved first.
	AFirst  bool     `json:"aFirst"`
	Winner  string   `json:"winner,omitempty"` // "A", "B" or "draw"
	Reason  string   `json:"reason,omitempty"`
	Turns   int      `json:"turns"`
	Actions int      `json:"actions"`
	LPA     int      `json:"lpA"` // life left, summed over the side's seats
	LPB     int      `json:"lpB"`
	DeckA   string   `json:"deckA,omitempty"`
	DeckB   string   `json:"deckB,omitempty"`
	Seconds float64  `json:"seconds"`
	Error   string   `json:"error,omitempty"`
	Said    []string `json:"said,omitempty"`
}

// ArenaJob is a batch of games between two players.
type ArenaJob struct {
	ID       string       `json:"id"`
	Spec     ArenaSpec    `json:"spec"`
	By       string       `json:"by"`
	Status   string       `json:"status"` // running, done, stopped
	Stopped  string       `json:"stopped,omitempty"`
	Created  time.Time    `json:"created"`
	Finished *time.Time   `json:"finished,omitempty"`
	Sides    [2]ArenaSide `json:"sides"`
	Draws    int          `json:"draws"`
	Done     int          `json:"done"`
	CostUSD  float64      `json:"costUsd"`
	Games    []ArenaGame  `json:"games"`

	cancel context.CancelFunc
}

// Arena runs and remembers test jobs.
type Arena struct {
	mu   sync.Mutex
	jobs []*ArenaJob
	next int

	Content *content.Service
	// LLMAvailable is whether Anthropic credentials were found.
	LLMAvailable bool
}

func NewArena(c *content.Service, llm bool) *Arena { return &Arena{Content: c, LLMAvailable: llm} }

// Kinds lists the players that can be fielded.
func (a *Arena) Kinds() []ArenaKind {
	kinds := []ArenaKind{{ID: "bot", Label: "Rose Bot (balanced)", Note: "rule-based, free"}}
	for _, s := range bot.Styles {
		kinds = append(kinds, ArenaKind{ID: string(s), Label: "Rose Bot (" + string(s) + ")", Note: "rule-based, free"})
	}
	if a.LLMAvailable {
		for _, m := range bot.Models {
			m := m
			kinds = append(kinds, ArenaKind{ID: "llm:" + m.ID, Label: "Claude " + m.Label, Note: m.Note, Model: &m})
		}
	}
	return kinds
}

func (a *Arena) side(kind string) (ArenaSide, error) {
	for _, k := range a.Kinds() {
		if k.ID != kind {
			continue
		}
		s := ArenaSide{Kind: k.ID, Label: k.Label, Priced: true}
		if k.Model != nil {
			// Its own client, so this job's spend is counted apart from
			// live games and other jobs.
			s.llm, s.model = bot.NewLLM(k.Model.ID), *k.Model
			s.Usage = &bot.Usage{}
			_, s.Priced = bot.Usage{}.Cost(s.model)
		} else {
			s.heuristic = bot.Heuristic{Style: bot.ParseStyle(kind)}
		}
		return s, nil
	}
	if strings.HasPrefix(kind, "llm") && !a.LLMAvailable {
		return ArenaSide{}, errors.New("no Anthropic credentials on the server: LLM players are off")
	}
	return ArenaSide{}, fmt.Errorf("unknown player %q", kind)
}

// Start checks the spec and runs the job in the background.
func (a *Arena) Start(spec ArenaSpec, by string) (*ArenaJob, error) {
	if spec.Games < 1 || spec.Games > arenaMaxGames {
		return nil, fmt.Errorf("games must be 1 to %d", arenaMaxGames)
	}
	if spec.Parallel < 1 {
		spec.Parallel = 1
	}
	spec.Parallel = min(spec.Parallel, arenaMaxParallel, spec.Games)
	if spec.Mode != "2v2" {
		spec.Mode = "1v1"
	}
	sa, err := a.side(spec.A)
	if err != nil {
		return nil, err
	}
	sb, err := a.side(spec.B)
	if err != nil {
		return nil, err
	}
	if (sa.llm != nil || sb.llm != nil) && spec.BudgetUSD <= 0 {
		return nil, errors.New("a job with an LLM player needs a budget")
	}
	if (sa.llm != nil && !sa.Priced) || (sb.llm != nil && !sb.Priced) {
		return nil, errors.New("that model's price is not known, so its budget cannot be enforced")
	}
	decks := a.Content.StarterDecks()
	if len(decks) == 0 {
		return nil, errors.New("there are no starter decks to deal")
	}
	catalog := a.Content.Catalog()
	if catalog == nil {
		return nil, ErrNoCatalog
	}

	ctx, cancel := context.WithCancel(context.Background())
	base := time.Now().UnixNano()
	job := &ArenaJob{Spec: spec, By: by, Status: "running", Created: time.Now().UTC(), Sides: [2]ArenaSide{sa, sb}, cancel: cancel}
	for i := range spec.Games {
		job.Games = append(job.Games, ArenaGame{N: i + 1, Seed: base + int64(i/2), AFirst: i%2 == 0, Status: "queued"})
	}

	a.mu.Lock()
	a.next++
	job.ID = fmt.Sprintf("job-%d", a.next)
	a.jobs = append(a.jobs, job)
	// Forget the oldest finished jobs.
	for len(a.jobs) > arenaKeepJobs {
		i := 0
		for i < len(a.jobs) && a.jobs[i].Status == "running" {
			i++
		}
		if i == len(a.jobs) {
			break
		}
		a.jobs = append(a.jobs[:i], a.jobs[i+1:]...)
	}
	a.mu.Unlock()

	log.Printf("arena %s: %s started %d %s games, %s vs %s, %d at a time", job.ID, by, spec.Games, spec.Mode, spec.A, spec.B, spec.Parallel)
	go a.run(ctx, job, catalog, decks)
	return job, nil
}

func (a *Arena) run(ctx context.Context, job *ArenaJob, catalog *content.Catalog, decks []content.Deck) {
	work := make(chan int)
	var wg sync.WaitGroup
	for range job.Spec.Parallel {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range work {
				a.play(ctx, job, i, catalog, decks)
			}
		}()
	}
	for i := range job.Games {
		if ctx.Err() != nil {
			break
		}
		select {
		case work <- i:
		case <-ctx.Done():
		}
	}
	close(work)
	wg.Wait()

	a.mu.Lock()
	defer a.mu.Unlock()
	for i := range job.Games {
		if job.Games[i].Status == "queued" {
			job.Games[i].Status = "cancelled"
		}
	}
	if job.Status == "running" {
		job.Status = "done"
	}
	now := time.Now().UTC()
	job.Finished = &now
	a.tally(job)
	job.cancel()
	log.Printf("arena %s: %s, %s %d - %d %s, %d draws, $%.4f", job.ID, job.Status, job.Spec.A, job.Sides[0].Wins, job.Sides[1].Wins, job.Spec.B, job.Draws, job.CostUSD)
}

// tally refreshes the job's totals. a.mu must be held.
func (a *Arena) tally(job *ArenaJob) {
	job.CostUSD = 0
	for i := range job.Sides {
		s := &job.Sides[i]
		if s.llm == nil {
			continue
		}
		u := s.llm.Usage()
		s.Usage = &u
		s.CostUSD, _ = u.Cost(s.model)
		job.CostUSD += s.CostUSD
	}
	if job.Status == "running" && job.Spec.BudgetUSD > 0 && job.CostUSD >= job.Spec.BudgetUSD {
		job.Status, job.Stopped = "stopped", fmt.Sprintf("the $%.2f budget was spent", job.Spec.BudgetUSD)
		job.cancel()
	}
}

// update changes a game's record under the lock and refreshes the totals.
func (a *Arena) update(job *ArenaJob, i int, f func(g *ArenaGame)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	f(&job.Games[i])
	a.tally(job)
}

// play deals and plays one game of a job.
func (a *Arena) play(ctx context.Context, job *ArenaJob, i int, catalog *content.Catalog, decks []content.Deck) {
	a.mu.Lock()
	rec := job.Games[i] // its N, Seed and AFirst never change
	a.mu.Unlock()
	if ctx.Err() != nil {
		return
	}
	seats := 2
	size := 7
	if job.Spec.Mode == "2v2" {
		seats, size = 4, 9
	}
	// Team 0 is side A when A moves first. sideOf maps a team to 0 (A) or 1 (B).
	sideOf := func(team int) int {
		if rec.AFirst {
			return team
		}
		return 1 - team
	}

	rng := rand.New(rand.NewSource(rec.Seed))
	setups := make([]engine.SeatSetup, seats)
	var deckNames [2][]string
	players := make([]bot.Bot, seats)
	for s := range seats {
		d := decks[rng.Intn(len(decks))]
		team := s % 2
		setups[s] = engine.SeatSetup{Team: team, Deck: d.Cards, Leader: d.LeaderNum}
		side := sideOf(team)
		deckNames[side] = append(deckNames[side], d.Name)
		players[s] = job.Sides[side].player()
	}
	cfg := engine.DefaultConfig(size)
	cfg.DestinyPool = content.DestinyPool
	g := engine.New(cfg, catalog, GenerateTiles(size, seats, rec.Seed), setups, rec.Seed)

	started := time.Now()
	a.update(job, i, func(r *ArenaGame) {
		r.Status = "playing"
		r.DeckA, r.DeckB = strings.Join(deckNames[0], " + "), strings.Join(deckNames[1], " + ")
	})

	var said []string
	reason, failure := "", ""
	turn, turnActions := -1, 0
	for step := 0; g.Phase == engine.PhasePlaying; step++ {
		if ctx.Err() != nil {
			break
		}
		if step >= arenaMaxSteps {
			failure = fmt.Sprintf("did not finish in %d actions", arenaMaxSteps)
			break
		}
		actor := g.Turn
		if g.Pending != nil {
			actor = g.Pending.Seat
		}
		if g.TurnCount != turn {
			turn, turnActions = g.TurnCount, 0
		}
		turnActions++
		legal := g.LegalActions(actor)
		if len(legal) == 0 {
			failure = fmt.Sprintf("seat %d had nothing it could do", actor)
			break
		}

		action := engine.Action{Type: engine.ActEndTurn}
		if turnActions <= maxBotActionsPerTurn || g.Pending != nil {
			obs := bot.Observation{Seat: actor, View: g.ViewFor(actor), Legal: legal, Card: catalog.Card}
			d := players[actor].Choose(ctx, obs)
			if ctx.Err() != nil {
				break
			}
			if d.Index < 0 || d.Index >= len(legal) {
				d.Index = len(legal) - 1
			}
			action = legal[d.Index]
			if d.Comment != "" && len(said) < arenaKeepComments {
				side := "A"
				if sideOf(g.Seats[actor].Team) == 1 {
					side = "B"
				}
				said = append(said, fmt.Sprintf("T%d %s: %s", g.TurnCount, side, d.Comment))
			}
		}
		if err := g.Apply(actor, action); err != nil {
			// A legal action was refused: end the turn rather than loop on it.
			if g.Pending != nil || g.Apply(actor, engine.Action{Type: engine.ActEndTurn}) != nil {
				failure = fmt.Sprintf("the engine refused %s: %v", action.Type, err)
				break
			}
		}
		for _, e := range g.TakeEvents() {
			if e.Type == "gameOver" {
				reason = e.Text
			}
		}

		// Progress every few actions, so the dashboard moves; after every
		// model call, so the budget is checked as it is spent.
		if _, llm := players[actor].(*bot.LLM); llm || step%10 == 0 {
			turns, actions := g.TurnCount, step+1
			a.update(job, i, func(r *ArenaGame) { r.Turns, r.Actions = turns, actions })
		}
	}

	a.update(job, i, func(r *ArenaGame) {
		r.Turns, r.Seconds, r.Said, r.Reason = g.TurnCount, time.Since(started).Seconds(), said, reason
		r.LPA, r.LPB = 0, 0
		for _, s := range g.Seats {
			if sideOf(s.Team) == 0 {
				r.LPA += max(s.LP, 0)
			} else {
				r.LPB += max(s.LP, 0)
			}
		}
		switch {
		case failure != "":
			r.Status, r.Error = "error", failure
		case g.Phase != engine.PhaseFinished:
			r.Status = "cancelled"
		default:
			r.Status = "done"
			job.Done++
			if g.WinnerTeam < 0 {
				r.Winner = "draw"
				job.Draws++
			} else {
				side := sideOf(g.WinnerTeam)
				r.Winner = []string{"A", "B"}[side]
				job.Sides[side].Wins++
			}
		}
	})
}

// Jobs returns a copy of every remembered job, newest first.
func (a *Arena) Jobs() []ArenaJob {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]ArenaJob, 0, len(a.jobs))
	for i := len(a.jobs) - 1; i >= 0; i-- {
		j := *a.jobs[i]
		j.Games = append([]ArenaGame(nil), j.Games...)
		for k := range j.Sides {
			if u := j.Sides[k].Usage; u != nil {
				copied := *u
				j.Sides[k].Usage = &copied
			}
		}
		out = append(out, j)
	}
	return out
}

// Stop cancels a running job, or forgets a finished one. It reports whether
// the job was found.
func (a *Arena) Stop(id, by string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i, j := range a.jobs {
		if j.ID != id {
			continue
		}
		if j.Status == "running" {
			j.Status, j.Stopped = "stopped", "stopped by "+by
			j.cancel()
		} else {
			a.jobs = append(a.jobs[:i], a.jobs[i+1:]...)
		}
		return true
	}
	return false
}
