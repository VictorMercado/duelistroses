package game

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/db"
)

// lastRoster is the newest voice roster a connection was sent, by peer.
func lastRoster(t *testing.T, c *Client) map[int]VoicePeer {
	t.Helper()
	var peers map[int]VoicePeer
	for _, m := range messages(t, c) {
		if m.T == "voice" {
			peers = map[int]VoicePeer{}
			for _, p := range m.Peers {
				peers[p.Cid] = p
			}
		}
	}
	return peers
}

func TestVoiceFollowsTheChatRules(t *testing.T) {
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
	bob := NewClient(auth.User{ID: "b", Name: "Bob"}, room, nil)
	room.Join(bob, &starter, Watch{})
	// Carol watches through Alice, so she sees Alice's hand.
	carol := NewClient(auth.User{ID: "c", Name: "Carol"}, room, nil)
	room.Join(carol, nil, Watch{Set: true, User: "a"})
	on(room, func() {})
	if room.game == nil || alice.seat != 0 || bob.seat != 1 || carol.seat != -1 {
		t.Fatal("the room did not seat the players")
	}

	// Nobody is in voice until they ask, and Alice alone has nobody to call.
	on(room, func() { room.setVoice(alice, true) })
	if peers := lastRoster(t, alice); peers == nil || len(peers) != 0 {
		t.Fatalf("alice alone in voice got %+v", peers)
	}
	on(room, func() { room.setVoice(bob, true); room.setVoice(carol, true) })

	// The players hear each other. Carol hears both, but only Alice's side hears her.
	a, b, c := lastRoster(t, alice), lastRoster(t, bob), lastRoster(t, carol)
	if !a[bob.id].Speak || !a[bob.id].Hear || !a[carol.id].Hear || !a[carol.id].Speak {
		t.Fatalf("alice's roster: %+v", a)
	}
	if !b[alice.id].Hear || b[carol.id].Hear || !b[carol.id].Speak {
		t.Fatalf("bob would hear the spectator who sees alice's hand: %+v", b)
	}
	if !c[alice.id].Hear || !c[bob.id].Hear || c[bob.id].Speak {
		t.Fatalf("carol's roster: %+v", c)
	}

	// Call setup goes between linked connections only.
	data := json.RawMessage(`{"sdp":"x"}`)
	on(room, func() { room.rtc(carol, bob.id, data) })
	relayed := false
	for _, m := range messages(t, bob) {
		relayed = relayed || (m.T == "rtc" && m.Cid == carol.id)
	}
	if !relayed {
		t.Fatal("carol could not call bob to listen to him")
	}

	// Muting spectators silences Carol for everyone; she still listens.
	on(room, func() { room.muteSpectators(alice, true) })
	if a := lastRoster(t, alice); a[carol.id].Hear {
		t.Fatal("a muted spectator is still heard")
	}
	if c := lastRoster(t, carol); !c[alice.id].Hear {
		t.Fatal("a muted spectator stopped hearing the players")
	}

	// Leaving voice hangs up: Bob drops out of everyone's roster.
	on(room, func() { room.setVoice(bob, false) })
	if _, ok := lastRoster(t, alice)[bob.id]; ok {
		t.Fatal("bob left voice but alice still calls him")
	}
	on(room, func() { room.rtc(alice, bob.id, data) })
	for _, m := range messages(t, bob) {
		if m.T == "rtc" {
			t.Fatal("call setup reached someone out of voice")
		}
	}
}
