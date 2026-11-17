package reports

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/db"
)

func TestReports(t *testing.T) {
	database := db.OpenTemp(t)
	accounts, err := auth.New(t.TempDir(), database, "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.EnsureAdmin("boss", "secret-pass"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	accounts.Register(mux)
	New(database, accounts).Register(mux)
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.RemoteAddr = "10.0.0.1:1234"
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	report := `{"v":1,"id":"abc","kind":"exception","message":"x is undefined","stack":"TypeError\n    at draw (https://g/app/index-AbCd1234.js:10:20)","build":{"version":"1.0","commit":"deadbee"},"game":{"roomId":"r1","phase":"playing"}}`
	if w := call("POST", "/api/client-errors", "", report); w.Code != http.StatusNoContent {
		t.Fatalf("report: %d %s", w.Code, w.Body)
	}
	// The same report sent again (a retry) is kept once.
	call("POST", "/api/client-errors", "", report)
	if w := call("POST", "/api/client-errors", "", `{"kind":"nope","message":"m"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown kind: %d", w.Code)
	}
	if w := call("POST", "/api/client-errors", "", `{"kind":"exception","message":"`+strings.Repeat("a", MaxBody)+`"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("oversized: %d", w.Code)
	}

	if w := call("GET", "/api/admin/client-errors", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("list without a token: %d", w.Code)
	}
	w := call("POST", "/api/auth/login", "", `{"name":"boss","password":"secret-pass"}`)
	var login struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &login)

	w = call("GET", "/api/admin/client-errors", login.Token, "")
	var list []Summary
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0].RoomID != "r1" || list[0].Build != "1.0 deadbee" {
		t.Fatalf("list: %s", w.Body)
	}
	w = call("GET", "/api/admin/client-errors/groups", login.Token, "")
	var groups []Group
	json.Unmarshal(w.Body.Bytes(), &groups)
	if len(groups) != 1 || groups[0].Count != 1 {
		t.Fatalf("groups: %s", w.Body)
	}
	w = call("GET", "/api/admin/client-errors/"+jsonInt(list[0].ID), login.Token, "")
	if !strings.Contains(w.Body.String(), `"phase":"playing"`) {
		t.Fatalf("one report keeps the whole JSON: %s", w.Body)
	}
	if w := call("DELETE", "/api/admin/client-errors", login.Token, ""); w.Code != http.StatusNoContent {
		t.Fatalf("clear: %d", w.Code)
	}
}

func TestFingerprintIgnoresBuildsAndNumbers(t *testing.T) {
	a := Fingerprint("exception", "card 12 missing", "at f (https://g/app/index-AbCd1234.js:10:20)")
	b := Fingerprint("exception", "card 99 missing", "at f (https://g/app/index-ZzZz9999.js:11:3)")
	if a != b {
		t.Fatal("the same bug in another build should group together")
	}
	if a == Fingerprint("exception", "other", "at f (x.js:1:1)") {
		t.Fatal("different messages should not group")
	}
}

func TestRateLimit(t *testing.T) {
	s := &Store{buckets: map[string]*bucket{}}
	allowed := 0
	for range 50 {
		if s.allow("1.2.3.4") {
			allowed++
		}
	}
	if allowed != 10 {
		t.Fatalf("burst: %d allowed, want 10", allowed)
	}
	if !s.allow("5.6.7.8") {
		t.Fatal("another address has its own limit")
	}
}

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }
