package auth

import (
	"os"
	"path/filepath"
	"testing"

	"duelistRoses/db"
)

// Accounts and friends kept in the old JSON files are carried over into the
// database the first time it opens, and the files are set aside.
func TestImportsLegacyFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "accounts.json"), []byte(`[
		{"id":"a1","name":"Alice","hash":"h1","admin":true,"created":"2026-01-02T03:04:05Z"},
		{"id":"b2","name":"bob","hash":"h2"},
		{"id":"c3","name":"Cat","hash":"h3"}]`), 0o600)
	os.WriteFile(filepath.Join(dir, "friends.json"), []byte(`{
		"a1":{"name":"Alice","friends":["b2"],"outgoing":["c3"]},
		"b2":{"name":"bob","friends":["a1"]},
		"c3":{"name":"Cat","incoming":["a1"]}}`), 0o600)

	database := db.OpenTemp(t)
	s, err := New(dir, database, "http://test", nil)
	if err != nil {
		t.Fatal(err)
	}
	a, ok := s.store.Find("ALICE")
	if !ok || a.ID != "a1" || !a.Admin || a.Hash != "h1" || a.Created.Year() != 2026 {
		t.Fatalf("alice not imported: %+v %v", a, ok)
	}
	if len(s.store.List()) != 3 {
		t.Errorf("want 3 accounts, got %d", len(s.store.List()))
	}
	if !s.Friends.AreFriends("a1", "b2") || !s.Friends.AreFriends("b2", "a1") {
		t.Error("friendship not imported")
	}
	_, incoming, _ := s.Friends.Of(User{ID: "c3"})
	if len(incoming) != 1 || incoming[0].Name != "Alice" {
		t.Errorf("request not imported: %+v", incoming)
	}
	if _, err := os.Stat(filepath.Join(dir, "accounts.json.imported")); err != nil {
		t.Error("accounts.json was not set aside")
	}

	// A second start does not import again, and names stay unique ignoring case.
	if _, err := New(dir, database, "http://test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store.Create("alice", "x"); err != ErrNameTaken {
		t.Errorf("duplicate name: %v", err)
	}

	// Asking someone who already asked you makes you friends.
	if _, err := s.Friends.Request(User{ID: "c3", Name: "Cat"}, User{ID: "a1", Name: "Alice"}); err != nil {
		t.Fatal(err)
	}
	if !s.Friends.AreFriends("a1", "c3") {
		t.Error("mutual request did not make friends")
	}
	if err := s.Friends.Remove(User{ID: "a1"}, "c3"); err != nil || s.Friends.AreFriends("c3", "a1") {
		t.Errorf("remove: %v", err)
	}
}
