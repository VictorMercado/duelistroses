package game

import (
	"path/filepath"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
)

// A spectator switches the side they watch from without reconnecting; a
// player cannot.
func TestRewatch(t *testing.T) {
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
	room, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindHuman}, {Kind: KindHuman}}}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer room.Shutdown("done")
	alice := NewClient(auth.User{ID: "alice", Name: "Alice"}, room, nil)
	bob := NewClient(auth.User{ID: "bob", Name: "Bob"}, room, nil)
	fan := NewClient(auth.User{ID: "fan", Name: "Fan"}, room, nil)
	room.Join(alice, &starter, Watch{})
	room.Join(bob, &starter, Watch{})
	room.Join(fan, nil, Watch{Set: true, Seat: 0})
	on(room, func() {})
	messages(t, fan)

	on(room, func() { room.rewatch(fan, 1) })
	if got := room.viewKey(fan); got != spectatorView+1 {
		t.Fatalf("after switching, the spectator's view is %d, want %d", got, spectatorView+1)
	}
	var welcomed, state bool
	for _, m := range messages(t, fan) {
		welcomed = welcomed || (m.T == "welcome" && m.You != nil && m.You.Watch == 1)
		state = state || m.T == "state"
	}
	if !welcomed || !state {
		t.Fatalf("the spectator was not told (welcome %v, state %v)", welcomed, state)
	}

	messages(t, alice)
	on(room, func() { room.rewatch(alice, 1) })
	if alice.seat != 0 {
		t.Fatal("a player was moved off their seat")
	}
	refused := false
	for _, m := range messages(t, alice) {
		refused = refused || m.T == "error"
	}
	if !refused {
		t.Fatal("a player switching sides was not refused")
	}
}
