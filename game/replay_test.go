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
	"duelistRoses/replay"
)

// TestReplayRecordsADuel plays a duel to its end and reads the recording
// back: one frame for the deal and one for each action, ending finished.
func TestReplayRecordsADuel(t *testing.T) {
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
	hub.Replays = replay.NewStore(database)
	starter := library.StarterDecks()[0]

	room, err := hub.Create("", Options{Mode: "1v1", Seats: []SeatSpec{{Kind: KindHuman}, {Kind: KindHuman}}}, library.StarterDecks())
	if err != nil {
		t.Fatal(err)
	}
	defer room.Shutdown("done")
	alice := NewClient(auth.User{ID: "alice", Name: "Alice"}, room, nil)
	bob := NewClient(auth.User{ID: "bob", Name: "Bob"}, room, nil)
	room.Join(alice, &starter, Watch{})
	room.Join(bob, &starter, Watch{})
	var id string
	on(room, func() {
		if room.game == nil {
			t.Fatal("the duel did not start")
		}
		id = room.replayID
		room.act(room.game.Turn, engine.Action{Type: engine.ActEndTurn}, nil, 0)
		room.act(room.game.Turn, engine.Action{Type: engine.ActConcede}, nil, 0)
	})
	if id == "" {
		t.Fatal("the duel was not recorded")
	}

	var meta replay.Meta
	for deadline := time.Now().Add(2 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		if meta, err = hub.Replays.Get(id); err == nil || time.Now().After(deadline) {
			break
		}
	}
	if err != nil {
		t.Fatalf("the replay was not saved: %v", err)
	}
	if !meta.Finished || meta.Steps != 3 || len(meta.Players) != 2 || meta.Players[0].UserID != "alice" {
		t.Fatalf("replay described as %+v", meta)
	}
	mine, _ := hub.Replays.List("bob", time.Time{}, 10)
	if len(mine) != 1 || mine[0].ID != id {
		t.Fatalf("bob's replays: %+v", mine)
	}

	packed, err := hub.Replays.Frames(id)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := replay.Gunzip(packed)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		V      int           `json:"v"`
		Room   RoomInfo      `json:"room"`
		Frames []replayFrame `json:"frames"`
		End    replayEnd     `json:"end"`
	}
	if err := json.Unmarshal(plain, &doc); err != nil {
		t.Fatalf("the recording is not JSON: %v", err)
	}
	if doc.V != replay.Version || len(doc.Room.Seats) != 2 || len(doc.Frames) != 3 || !doc.End.Finished {
		t.Fatalf("recording: v%d, %d seats, %d frames, end %+v", doc.V, len(doc.Room.Seats), len(doc.Frames), doc.End)
	}
	if doc.Frames[0].Seat != -1 || doc.Frames[0].Action != nil {
		t.Errorf("the first frame is not the deal: %+v", doc.Frames[0])
	}
	if a := doc.Frames[2].Action; a == nil || a.Type != engine.ActConcede {
		t.Errorf("the last frame is not the concession: %+v", a)
	}
	if r := doc.Frames[0].State.Reveal; r == nil || len(r.Hands) != 2 {
		t.Error("a frame hides the hands")
	}
	if doc.Frames[2].State.Phase != engine.PhaseFinished {
		t.Error("the last frame is not the finished duel")
	}
	t.Logf("%d frames in %d bytes", len(doc.Frames), len(packed))
}
