package content

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"duelistRoses/auth"
	"duelistRoses/db"
)

// An administrator may list, change and delete anyone's decks, and a deck they
// change stays its owner's. Players still only touch their own.
func TestAdminEditsAnyonesDeck(t *testing.T) {
	dir := t.TempDir()
	database := db.OpenTemp(t)
	accounts, err := auth.New(dir, database, "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	library, err := New(dir, database, dir, accounts)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	accounts.Register(mux)
	library.Register(mux)
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	read := func(w *httptest.ResponseRecorder, v any) {
		t.Helper()
		if err := json.Unmarshal(w.Body.Bytes(), v); err != nil {
			t.Fatalf("%d %s: %v", w.Code, w.Body, err)
		}
	}
	signIn := func(path, name, password string) (auth.User, string) {
		var resp struct {
			Token string
			User  auth.User
		}
		read(call("POST", path, "", `{"name":"`+name+`","password":"`+password+`"}`), &resp)
		return resp.User, resp.Token
	}

	accounts.EnsureAdmin("root", "rootpass")
	_, rootToken := signIn("/api/auth/login", "root", "rootpass")
	alice, aliceToken := signIn("/api/auth/register", "alice", "password1")
	_, bobToken := signIn("/api/auth/register", "bob", "password1")

	starter := library.StarterDecks()[0]
	body := func(name string) string {
		b, _ := json.Marshal(deckInput{Name: name, LeaderNum: starter.LeaderNum, Cards: starter.Cards})
		return string(b)
	}
	var deck Deck
	read(call("POST", "/api/decks", aliceToken, body("Alice's")), &deck)

	if w := call("GET", "/api/decks?owner="+alice.ID, bobToken, ""); w.Code != http.StatusForbidden {
		t.Errorf("a player listed someone's decks: %d", w.Code)
	}
	if w := call("PUT", "/api/decks/"+deck.ID, bobToken, body("Bob's now")); w.Code != http.StatusNotFound {
		t.Errorf("a player changed someone's deck: %d", w.Code)
	}

	var listed []Deck
	read(call("GET", "/api/decks?owner="+alice.ID, rootToken, ""), &listed)
	if len(listed) != 1 || listed[0].ID != deck.ID {
		t.Fatalf("admin listing: %+v", listed)
	}
	var changed Deck
	read(call("PUT", "/api/decks/"+deck.ID, rootToken, body("Tuned by admin")), &changed)
	if changed.Name != "Tuned by admin" || changed.OwnerID != alice.ID || changed.OwnerName != "alice" {
		t.Fatalf("an admin's change took the deck from its owner: %+v", changed)
	}
	if mine := library.DecksOf(alice.ID); len(mine) != 1 || mine[0].Name != "Tuned by admin" {
		t.Fatalf("alice's decks: %+v", mine)
	}

	if w := call("DELETE", "/api/decks/"+deck.ID, bobToken, ""); w.Code != http.StatusNotFound {
		t.Errorf("a player deleted someone's deck: %d", w.Code)
	}
	if w := call("DELETE", "/api/decks/"+deck.ID, rootToken, ""); w.Code != http.StatusNoContent {
		t.Errorf("admin delete: %d %s", w.Code, w.Body)
	}
	if len(library.DecksOf(alice.ID)) != 0 {
		t.Error("the deck is still there")
	}

	// Building for others: a friend may, a stranger may not, an admin may.
	bob, _ := accounts.FindAccount("bob")
	carol, carolToken := signIn("/api/auth/register", "carol", "password1")
	forUser := func(name, owner string) string {
		b, _ := json.Marshal(deckInput{Name: name, LeaderNum: starter.LeaderNum, Cards: starter.Cards, OwnerID: owner})
		return string(b)
	}
	if w := call("POST", "/api/decks", carolToken, forUser("Gift", alice.ID)); w.Code != http.StatusForbidden {
		t.Errorf("a stranger built a deck for alice: %d", w.Code)
	}
	accounts.Friends.Request(carol, alice)
	accounts.Friends.Request(alice, carol)
	var gift Deck
	read(call("POST", "/api/decks", carolToken, forUser("Gift", alice.ID)), &gift)
	if gift.OwnerID != alice.ID || gift.MadeByID != carol.ID || gift.MadeByName != "carol" {
		t.Fatalf("a friend's deck: %+v", gift)
	}
	if mine := library.DecksOf(carol.ID); len(mine) != 0 {
		t.Errorf("the gift landed in its maker's decks: %+v", mine)
	}
	var made []Deck
	read(call("GET", "/api/decks?made=1", carolToken, ""), &made)
	if len(made) != 1 || made[0].ID != gift.ID {
		t.Fatalf("decks carol made: %+v", made)
	}
	var tuned Deck
	read(call("PUT", "/api/decks/"+gift.ID, carolToken, body("Gift, tuned")), &tuned)
	if tuned.OwnerID != alice.ID || tuned.Name != "Gift, tuned" || tuned.MadeByID != carol.ID {
		t.Fatalf("the maker's edit: %+v", tuned)
	}
	if w := call("PUT", "/api/decks/"+gift.ID, bobToken, body("Bob's now")); w.Code != http.StatusNotFound {
		t.Errorf("someone else changed the gift: %d", w.Code)
	}
	// No longer friends: the maker loses access, the deck stays alice's.
	accounts.Friends.Remove(carol, alice.ID)
	if w := call("PUT", "/api/decks/"+gift.ID, carolToken, body("again")); w.Code != http.StatusNotFound {
		t.Errorf("an ex-friend changed the gift: %d", w.Code)
	}
	if mine := library.DecksOf(alice.ID); len(mine) != 1 || mine[0].Name != "Gift, tuned" {
		t.Fatalf("alice's decks: %+v", mine)
	}
	var fromAdmin Deck
	read(call("POST", "/api/decks", rootToken, forUser("From admin", bob.ID)), &fromAdmin)
	if fromAdmin.OwnerID != bob.ID || fromAdmin.MadeByName != "root" {
		t.Fatalf("an admin's deck for bob: %+v", fromAdmin)
	}
}
