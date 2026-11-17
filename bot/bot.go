// Package bot holds the computer players. A bot never touches the game: it is
// shown exactly what a human in its seat would see (the same redacted view)
// together with the list of legal actions, and answers with the index of the
// one it picks. It cannot cheat and it cannot make an illegal move.
package bot

import (
	"context"

	"duelistRoses/game/engine"
)

type Observation struct {
	Seat  int
	View  engine.View
	Legal []engine.Action
	// Card looks a card number up in the catalog the game is using.
	Card func(num int) *engine.CardDef
}

// Decision is the chosen action and, optionally, something to say about it.
type Decision struct {
	Index   int
	Comment string
	// Thought is how the bot reached the decision, shown to administrators
	// only: it can mention the bot's hand and plans.
	Thought string
}

type Bot interface {
	Name() string
	// Choose must return an index into o.Legal. It should respect ctx, which
	// is cancelled when the room stops waiting.
	Choose(ctx context.Context, o Observation) Decision
}

// --- shared helpers for reading a view ------------------------------------

type board struct {
	o     Observation
	half  int
	me    engine.SeatView
	cards map[engine.Pos]engine.CardView
	byID  map[int]engine.CardView
	hand  map[int]int // card id -> number
}

func read(o Observation) board {
	b := board{o: o, half: o.View.Size / 2, cards: map[engine.Pos]engine.CardView{}, byID: map[int]engine.CardView{}, hand: map[int]int{}}
	for _, s := range o.View.Seats {
		if s.Index == o.Seat {
			b.me = s
		}
	}
	for _, c := range o.View.Cards {
		b.cards[engine.Pos{X: c.X, Y: c.Y}] = c
		b.byID[c.ID] = c
	}
	for _, h := range o.View.Hand {
		b.hand[h.ID] = h.Num
	}
	return b
}

func (b board) terrain(p engine.Pos) string {
	i := (p.Y+b.half)*b.o.View.Size + (p.X + b.half)
	if i < 0 || i >= len(b.o.View.Tiles) {
		return engine.TerrainNormal
	}
	return b.o.View.Tiles[i]
}

func (b board) team(seat int) int {
	for _, s := range b.o.View.Seats {
		if s.Index == seat {
			return s.Team
		}
	}
	return -1
}

func (b board) enemy(seat int) bool { return b.team(seat) != b.me.Team }

func (b board) enemyLeaders() []engine.SeatView {
	var out []engine.SeatView
	for _, s := range b.o.View.Seats {
		if s.Alive && s.Team != b.me.Team {
			out = append(out, s)
		}
	}
	return out
}

func dist(a, c engine.Pos) int {
	dx, dy := a.X-c.X, a.Y-c.Y
	if dx < 0 {
		dx = -dx
	}
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

// toEnemy is the walking distance from p to the nearest enemy leader.
func (b board) toEnemy(p engine.Pos) int {
	best := 99
	for _, s := range b.enemyLeaders() {
		if d := dist(p, engine.Pos{X: s.LeaderX, Y: s.LeaderY}); d < best {
			best = d
		}
	}
	return best
}

// def looks up a card the bot can see. Hidden cards come as engine.HiddenNum.
func (b board) def(num int) *engine.CardDef {
	if num < 0 {
		return nil
	}
	return b.o.Card(num)
}

// optionDef looks up the card a choice refers to, if it shows one.
func (b board) optionDef(num *int) *engine.CardDef {
	if num == nil {
		return nil
	}
	return b.def(*num)
}
