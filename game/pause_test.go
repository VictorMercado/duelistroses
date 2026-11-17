package game

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// messages empties a client's queue, returning everything in it.
func messages(t *testing.T, c *Client) []Outgoing {
	t.Helper()
	var out []Outgoing
	for {
		select {
		case b := <-c.out:
			var m Outgoing
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			out = append(out, m)
		default:
			return out
		}
	}
}

func TestPause(t *testing.T) {
	database := db.OpenTemp(t)
	dir := t.TempDir()
	accounts, err := auth.New(dir, database, "http://localhost", nil)
	if err != nil {
		t.Fatal(err)
	}
	library, err := content.New(dir, database, filepath.Join(dir, "assets"), accounts)
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(library, func(string) bot.Bot { return namedBot("bot") })
	starter := library.StarterDecks()[0]

	// Against a computer player, the player may pause.
	room, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindHuman}, {Kind: KindBot}}, TurnSeconds: 60}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer room.Shutdown("done")
	player := NewClient(auth.User{ID: "p", Name: "Player"}, room, nil)
	room.Join(player, &starter, Watch{})
	on(room, func() {})
	if room.game == nil || !room.info.Pausable {
		t.Fatal("a duel against a bot did not start pausable")
	}
	on(room, func() {
		// The player's own turn, with a clock running.
		room.game.Turn = player.seat
		room.schedule()
	})
	messages(t, player)

	on(room, func() { room.pause(player, true, 1) })
	var paused, cleared bool
	for _, m := range messages(t, player) {
		paused = paused || (m.Room != nil && m.Room.Paused)
		cleared = cleared || (m.State != nil && m.Deadline == 0)
	}
	if !paused || !cleared || !room.paused || room.timer != nil {
		t.Fatalf("pausing did not stop the duel (paused %v, clock cleared %v)", paused, cleared)
	}
	left := room.pausedClock
	if left <= 0 || left > 60*time.Second {
		t.Fatalf("the clock kept %v", left)
	}

	// Nothing moves while it is paused.
	on(room, func() { room.act(player.seat, engine.Action{Type: engine.ActEndTurn}, player, 2) })
	refused := false
	for _, m := range messages(t, player) {
		refused = refused || (m.T == "error" && m.ID == 2)
	}
	if !refused || room.game.Turn != player.seat {
		t.Fatal("a move was played in a paused duel")
	}

	// Picking it up again restarts the clock where it stopped.
	on(room, func() { room.pause(player, false, 3) })
	if room.paused || room.timer == nil || room.deadline.IsZero() {
		t.Fatal("resuming did not start the clock again")
	}
	if got := time.Until(room.turnClockEnds); got > left || got < left-time.Second {
		t.Fatalf("the clock resumed with %v, want about %v", got, left)
	}

	// With another person at the table, nobody may.
	two, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindHuman}, {Kind: KindHuman}}, TurnSeconds: 60}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer two.Shutdown("done")
	a := NewClient(auth.User{ID: "a", Name: "A"}, two, nil)
	b := NewClient(auth.User{ID: "b", Name: "B"}, two, nil)
	two.Join(a, &starter, Watch{})
	two.Join(b, &starter, Watch{})
	on(two, func() {})
	if two.game == nil || two.info.Pausable {
		t.Fatal("a duel between two people is pausable")
	}
	on(two, func() { two.pause(a, true, 1) })
	if two.paused {
		t.Fatal("a player paused a duel against another person")
	}
}
