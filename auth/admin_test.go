package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"duelistRoses/db"
)

func TestAdminDashboard(t *testing.T) {
	s, err := New(t.TempDir(), db.OpenTemp(t), "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.Register(mux)
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	login := func(name, password string) (User, string, int) {
		w := call("POST", "/api/auth/login", "", `{"name":"`+name+`","password":"`+password+`"}`)
		if w.Code != 200 {
			return User{}, "", w.Code
		}
		var resp struct {
			Token string
			User  User
		}
		decode(t, w, &resp)
		return resp.User, resp.Token, 200
	}

	if created, err := s.EnsureAdmin("admin", "admin"); err != nil || !created {
		t.Fatalf("seed: %v %v", created, err)
	}
	if created, _ := s.EnsureAdmin("admin", "other"); created {
		t.Fatal("seeded twice")
	}
	root, rootToken, code := login("admin", "admin")
	if code != 200 || !root.Admin {
		t.Fatalf("admin login: %d %+v", code, root)
	}

	call("POST", "/api/auth/register", "", `{"name":"bob","password":"password1"}`)
	bob, bobToken, _ := login("bob", "password1")
	if bob.Admin {
		t.Fatal("bob is admin")
	}
	if w := call("GET", "/api/admin/users", bobToken, ""); w.Code != http.StatusForbidden {
		t.Errorf("a player listed users: %d", w.Code)
	}
	var users []AccountInfo
	decode(t, call("GET", "/api/admin/users", rootToken, ""), &users)
	if len(users) != 2 || strings.Contains(call("GET", "/api/admin/users", rootToken, "").Body.String(), "hash") {
		t.Fatalf("users: %+v", users)
	}

	if w := call("PUT", "/api/admin/users/"+bob.ID+"/admin", rootToken, `{"admin":true}`); w.Code != 200 {
		t.Fatalf("grant: %d %s", w.Code, w.Body)
	}
	if u, _ := s.Verify(bobToken); !u.Admin {
		t.Error("granting admin did not apply to bob's existing token")
	}
	if w := call("PUT", "/api/admin/users/"+root.ID+"/admin", rootToken, `{"admin":false}`); w.Code != http.StatusBadRequest {
		t.Error("an admin removed their own access")
	}

	if w := call("PUT", "/api/admin/users/"+bob.ID+"/password", rootToken, `{"password":"newpass"}`); w.Code != 200 {
		t.Fatalf("password: %d %s", w.Code, w.Body)
	}
	if _, _, code := login("bob", "password1"); code == 200 {
		t.Error("the old password still works")
	}
	if _, _, code := login("bob", "newpass"); code != 200 {
		t.Error("the new password does not work")
	}

	// Creating accounts.
	carol := call("POST", "/api/auth/register", "", `{"name":"carol","password":"password1"}`)
	var carolResp struct{ Token string }
	decode(t, carol, &carolResp)
	if w := call("POST", "/api/admin/users", carolResp.Token, `{"name":"dave","password":"password1"}`); w.Code != http.StatusForbidden {
		t.Errorf("a player created an account: %d", w.Code)
	}
	if w := call("POST", "/api/admin/users", rootToken, `{"name":"dave","password":"short"}`); w.Code != http.StatusBadRequest {
		t.Errorf("a short password was accepted: %d", w.Code)
	}
	var dave AccountInfo
	w := call("POST", "/api/admin/users", rootToken, `{"name":"dave","password":"password1","admin":true}`)
	decode(t, w, &dave)
	if w.Code != http.StatusCreated || dave.Name != "dave" || !dave.Admin {
		t.Fatalf("create: %d %+v", w.Code, dave)
	}
	if u, _, code := login("dave", "password1"); code != 200 || !u.Admin {
		t.Errorf("dave cannot sign in as an admin: %d %+v", code, u)
	}
	if w := call("POST", "/api/admin/users", rootToken, `{"name":"Dave","password":"password1"}`); w.Code != http.StatusConflict {
		t.Errorf("a taken name was accepted: %d", w.Code)
	}
}

func decode(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(w.Body.Bytes(), v); err != nil {
		t.Fatalf("%d %s: %v", w.Code, w.Body, err)
	}
}
