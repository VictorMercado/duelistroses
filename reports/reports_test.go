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
	if len(list) != 1 || list[0].RoomID != "r1" || list[0].Build != "1.0 deadbee" || list[0].IP != "10.0.0.1" {
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

func TestInternalEndpoints(t *testing.T) {
	database := db.OpenTemp(t)
	accounts, err := auth.New(t.TempDir(), database, "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	store := New(database, accounts)
	public, internal := http.NewServeMux(), http.NewServeMux()
	store.Register(public)
	store.RegisterInternal(internal.Handle)

	send := func(id, xff string) {
		r := httptest.NewRequest("POST", "/api/client-errors", strings.NewReader(`{"id":"`+id+`","kind":"exception","message":"boom `+id+`"}`))
		r.RemoteAddr = "172.18.0.2:1234"
		r.Header.Set("X-Forwarded-For", xff)
		w := httptest.NewRecorder()
		public.ServeHTTP(w, r)
		if w.Code != http.StatusNoContent {
			t.Fatalf("report: %d %s", w.Code, w.Body)
		}
	}
	send("a", "198.51.100.9")
	send("b", "198.51.100.9")
	send("c", "203.0.113.5")

	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		internal.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	var list []Summary
	json.Unmarshal(get("/internal/client-errors").Body.Bytes(), &list)
	if len(list) != 3 || list[0].IP != "203.0.113.5" {
		t.Fatalf("list: %+v", list)
	}
	json.Unmarshal(get("/internal/client-errors?ip=198.51.100.9").Body.Bytes(), &list)
	if len(list) != 2 {
		t.Fatalf("one ip: %+v", list)
	}
	var ips []IPSummary
	json.Unmarshal(get("/internal/client-errors/ips").Body.Bytes(), &ips)
	if len(ips) != 2 || ips[0].IP != "198.51.100.9" || ips[0].Reports != 2 || ips[0].LastMessage != "boom b" {
		t.Fatalf("ips: %+v", ips)
	}
	// A range before the reports holds none.
	json.Unmarshal(get("/internal/client-errors?from=0&to=1000").Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("old range: %+v", list)
	}
}
