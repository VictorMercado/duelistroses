package game

import (
	"path/filepath"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
	"duelistRoses/game/engine"
)

func TestArenaDisplay(t *testing.T) {
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

	room, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindHuman}, {Kind: KindHuman}}, TurnSeconds: 60}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer room.Shutdown("done")

	alice := NewClient(auth.User{ID: "a", Name: "Alice"}, room, nil)
	room.Join(alice, &starter, Watch{})
	on(room, func() {})

	// A stranger may not take over everyone's phones.
	stranger := NewClient(auth.User{ID: "x", Name: "Stranger"}, room, nil)
	room.Join(stranger, nil, Watch{Set: true, Seat: -1, Display: true})
	on(room, func() {})
	if room.clients[stranger] || stranger.closeCode != 4403 {
		t.Fatalf("a stranger became the arena display (close code %d)", stranger.closeCode)
	}

	// Alice's second screen becomes the display, and she keeps her seat on
	// the first connection.
	screen := NewClient(auth.User{ID: "a", Name: "Alice"}, room, nil)
	room.Join(screen, nil, Watch{Set: true, Seat: -1, Display: true})
	on(room, func() {})
	if !room.clients[alice] || alice.seat != 0 || screen.seat != -1 {
		t.Fatalf("the display took a seat (alice seat %d, display seat %d)", alice.seat, screen.seat)
	}
	if !room.info.Display || room.info.Spectators != 0 {
		t.Fatalf("room info: display %v, spectators %d", room.info.Display, room.info.Spectators)
	}
	you, _ := drain(t, screen)
	if you == nil || !you.Display {
		t.Fatal("the display was not told it is one")
	}

	bob := NewClient(auth.User{ID: "b", Name: "Bob"}, room, nil)
	room.Join(bob, &starter, Watch{})
	on(room, func() {})
	if room.game == nil {
		t.Fatal("the duel did not start with both players seated")
	}

	// The display sees the board face up only: no hand, nothing to play.
	_, view := drain(t, screen)
	if view == nil || len(view.Hand) != 0 || view.Legal != nil {
		t.Fatalf("the display got a player's view: %+v", view)
	}

	// The display does not point at things.
	messages(t, alice)
	on(room, func() { room.cursor(screen, 0, 0) })
	for _, m := range messages(t, alice) {
		if m.T == "cursor" {
			t.Fatal("the display's cursor was shown to a player")
		}
	}

	// A player's selection goes to the display, and to nobody else.
	messages(t, bob)
	from := engine.Pos{X: 0, Y: 1}
	on(room, func() {
		room.selection(alice, "card", &from, []engine.Pos{{X: 0, Y: 2}, {X: 99, Y: 99}})
		room.selection(alice, "bogus", nil, nil)
	})
	var got []Outgoing
	for _, m := range messages(t, screen) {
		if m.T == "sel" {
			got = append(got, m)
		}
	}
	if len(got) != 1 || got[0].Seat != 0 || got[0].Sel.Kind != "card" || len(got[0].Sel.Targets) != 1 || got[0].Sel.From == nil {
		t.Fatalf("the display got %+v", got)
	}
	for _, m := range messages(t, bob) {
		if m.T == "sel" {
			t.Fatal("a selection reached the other player")
		}
	}

	// Bob turns his own screen into the display mid-duel: he leaves his seat
	// (which waits for him) and the room now has a display, still.
	on(room, func() { room.becomeDisplay(bob) })
	if bob.seat != -1 || !bob.watch.Display || room.slots[1].UserID != "b" || room.slots[1].client != nil {
		t.Fatalf("bob's screen did not become a display (seat %d)", bob.seat)
	}
	// And his phone takes the seat back.
	phone := NewClient(auth.User{ID: "b", Name: "Bob"}, room, nil)
	room.Join(phone, &starter, Watch{})
	on(room, func() {})
	if phone.seat != 1 || !room.clients[bob] {
		t.Fatalf("bob's phone got seat %d; display still here %v", phone.seat, room.clients[bob])
	}

	// The display turns the board; a player cannot.
	on(room, func() { room.orient(alice, 1, true) })
	if room.info.DisplayTurn != 0 || room.info.SeatControls {
		t.Fatal("a player turned the display's board")
	}
	on(room, func() { room.orient(screen, -1, true) })
	if room.info.DisplayTurn != 3 || !room.info.SeatControls {
		t.Fatalf("display turn %d, seat controls %v", room.info.DisplayTurn, room.info.SeatControls)
	}

	// When the display goes, the room says so: phones become boards again.
	room.leave(screen)
	room.leave(bob)
	on(room, func() {})
	if room.info.Display {
		t.Fatal("the room still has a display after it left")
	}
}
