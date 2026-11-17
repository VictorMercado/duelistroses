package game

import (
	"context"
	"math/rand"
	"testing"

	"duelistRoses/bot"
)

type namedBot string

func (b namedBot) Name() string                                         { return string(b) }
func (b namedBot) Choose(context.Context, bot.Observation) bot.Decision { return bot.Decision{} }

func TestBotsOnlyRooms(t *testing.T) {
	o := Options{Mode: "2v2", Seats: []SeatSpec{{Kind: KindBot}, {Kind: KindBot}, {Kind: KindBot}, {Kind: KindBot}}}
	if err := o.Normalize(); err != nil {
		t.Fatalf("a room of computer players only is refused: %v", err)
	}

	hub := &Hub{NewBot: func(kind string) bot.Bot { return namedBot("Claude Opus") }}
	r := &Room{hub: hub, rng: rand.New(rand.NewSource(1))}
	for i := range 3 {
		s := &slot{Index: i, Team: i % 2}
		r.seatBot(s, "llm")
		r.slots = append(r.slots, s)
	}
	want := []string{"Claude Opus", "Claude Opus 2", "Claude Opus 3"}
	for i, s := range r.slots {
		if s.Name != want[i] {
			t.Errorf("seat %d is called %q, want %q", i, s.Name, want[i])
		}
	}
	if !r.botsOnly() {
		t.Error("a table of bots is not bots only")
	}

	// Watching everything is the admin projection, but only where nobody plays.
	c := &Client{seat: -1, watch: Watch{Set: true, Seat: -1, All: true}}
	if r.viewKey(c) != adminView {
		t.Errorf("view key %d, want the full view", r.viewKey(c))
	}
	r.openSeat(r.slots[0])
	if r.viewKey(c) == adminView {
		t.Error("a table with a human seat shows everything to a spectator")
	}
}
