package api

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"duelistRoses/db"
	"duelistRoses/replay"
)

func TestReplayEndpoints(t *testing.T) {
	store := replay.NewStore(db.OpenTemp(t))
	rec := replay.NewRecorder(map[string]string{"id": "room"})
	rec.Add(map[string]int{"seat": -1})
	rec.Add(map[string]int{"seat": 0})
	frames, err := rec.Finish(map[string]bool{"finished": true})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	meta := replay.Meta{ID: "abc", Room: "room", Mode: "1v1", Started: now.Add(-time.Minute), Ended: now, Finished: true, Steps: 2,
		Players: []replay.Player{{UserID: "u1", Name: "Alice"}, {Name: "Bot", Team: 1, Bot: true}}}
	if err := store.Save(meta, frames); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	(&Server{Replays: store}).registerReplays(mux)
	get := func(path string, gz bool) *http.Response {
		req := httptest.NewRequest("GET", path, nil)
		if gz {
			req.Header.Set("Accept-Encoding", "gzip, deflate")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w.Result()
	}

	var list []replay.Meta
	json.NewDecoder(get("/api/replays?user=u1", false).Body).Decode(&list)
	if len(list) != 1 || list[0].ID != "abc" || len(list[0].Players) != 2 {
		t.Fatalf("listed %+v", list)
	}
	json.NewDecoder(get("/api/replays?user=nobody", false).Body).Decode(&list)
	if len(list) != 0 {
		t.Fatalf("someone else's replays listed: %+v", list)
	}
	if res := get("/api/replays/nope/frames", true); res.StatusCode != http.StatusNotFound {
		t.Fatalf("a missing replay answered %d", res.StatusCode)
	}

	want := `{"v":1,"room":{"id":"room"},"frames":[{"seat":-1},{"seat":0}],"end":{"finished":true}}`
	res := get("/api/replays/abc/frames", true)
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatal("a gzip client got the recording unpacked")
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := io.ReadAll(zr); string(b) != want {
		t.Fatalf("recording %s", b)
	}
	if b, _ := io.ReadAll(get("/api/replays/abc/frames", false).Body); string(b) != want {
		t.Fatalf("unpacked recording %s", b)
	}
}
