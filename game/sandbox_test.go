package game

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// on runs f on the room's goroutine and waits for it.
func on(r *Room, f func()) {
	done := make(chan struct{})
	r.post(func() { f(); close(done) })
	<-done
}

// drain empties a client's queue, returning the last welcome and state.
func drain(t *testing.T, c *Client) (you *Identity, state *engine.View) {
	t.Helper()
	for {
		select {
		case b := <-c.out:
			var m Outgoing
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			if m.T == "error" {
				t.Fatalf("server error: %s", m.Message)
			}
			if m.You != nil {
				you = m.You
			}
			if m.State != nil {
				state = m.State
			}
		default:
			return
		}
	}
}

func TestSandbox(t *testing.T) {
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
	room, err := hub.Create("", Options{Sandbox: true, Mode: "2v2", TurnSeconds: 60}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer room.Shutdown("done")

	// Nobody but an administrator gets in.
	outsider := NewClient(auth.User{ID: "u", Name: "Player"}, room, nil)
	starter := library.StarterDecks()[0]
	room.Join(outsider, &starter, Watch{})
	on(room, func() {})
	if outsider.closeCode != 4403 {
		t.Fatalf("a player who is not an administrator joined a sandbox (code %d)", outsider.closeCode)
	}

	admin := NewClient(auth.User{ID: "a", Name: "Admin", Admin: true}, room, nil)
	room.Join(admin, &starter, Watch{})
	on(room, func() {})
	you, state := drain(t, admin)
	if room.game == nil || len(room.slots) != 2 || room.slots[1].Kind != KindPuppet || room.opts.TurnSeconds != 0 {
		t.Fatal("the sandbox did not start a private 1v1 against a puppet")
	}
	if you == nil || you.Sandbox == nil || !you.Sandbox.Follow || !you.Sandbox.Unlimited || state == nil || state.Reveal == nil {
		t.Fatalf("the sandbox controls or full view are missing: %+v", you)
	}

	// Ending the turn hands the administrator the other seat.
	on(room, func() { room.act(admin.seat, engine.Action{Type: engine.ActEndTurn}, admin, 1) })
	if you, _ := drain(t, admin); admin.seat != 1 || you == nil || you.Seat != 1 {
		t.Fatalf("the controls did not follow the turn: seat %d", admin.seat)
	}
	// A card given now goes to the puppet's hand.
	hand := 0
	on(room, func() { hand = len(room.game.Seats[1].Hand) })
	on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "give", Num: starter.Cards[0]}) })
	on(room, func() {
		if len(room.game.Seats[1].Hand) != hand+1 {
			t.Error("the card did not go to the controlled seat")
		}
	})
	// Switching by hand sticks until the turn moves on.
	on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "control", Seat: 0}) })
	if admin.seat != 0 {
		t.Error("switching seats by hand did not work")
	}
	on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "unlimited", On: false}) })
	on(room, func() {
		if room.game.Unlimited || room.unlimited {
			t.Error("free play did not turn off")
		}
		if room.timer != nil {
			t.Error("a sandbox runs a clock")
		}
	})
	drain(t, admin)

	// A map the board's size is laid under the duel as it stands.
	same := library.RandomMap("a", 7)
	if same == nil {
		t.Fatal("no 7×7 preset map to test with")
	}
	var before *engine.Game
	on(room, func() { before = room.game })
	on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "map", Map: same.ID}) })
	on(room, func() {
		if room.game != before {
			t.Error("a map the same size dealt a new duel")
		}
		if want := same.TileMap(); room.game.Tiles[engine.Pos{X: 0, Y: 0}] != want[engine.Pos{X: 0, Y: 0}] || room.opts.Map == nil || room.opts.Map.ID != same.ID {
			t.Error("the terrain did not change to the chosen map")
		}
	})
	drain(t, admin)
	// A freshly generated one, the same way.
	on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "map"}) })
	on(room, func() {
		if room.game != before || room.opts.Map != nil {
			t.Error("a generated map did not replace the terrain in place")
		}
	})
	// Another size deals a new duel on it.
	if other := library.RandomMap("a", 9); other != nil {
		on(room, func() { room.adminTool(admin, incoming{T: "admin", Op: "map", Map: other.ID}) })
		on(room, func() {
			if room.game == before || room.game.Cfg.Size != 9 {
				t.Error("a map of another size did not deal a new duel on it")
			}
		})
	}
	drain(t, admin)
}

func TestEndBotsDuel(t *testing.T) {
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
	room, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindBot}, {Kind: KindBot}}, HostID: "host"}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	stranger := NewClient(auth.User{ID: "x", Name: "Stranger"}, room, nil)
	host := NewClient(auth.User{ID: "host", Name: "Host"}, room, nil)
	for _, c := range []*Client{stranger, host} {
		room.Join(c, nil, Watch{Set: true, Seat: -1, All: true})
	}
	on(room, func() {})
	on(room, func() { room.endBotsDuel(stranger) })
	if hub.Get(room.ID) == nil {
		t.Fatal("someone who did not start the duel ended it")
	}
	on(room, func() { room.endBotsDuel(host) })
	<-room.done
	if hub.Get(room.ID) != nil || stranger.closeCode != 4410 {
		t.Errorf("the duel did not end for everyone (code %d)", stranger.closeCode)
	}
}
