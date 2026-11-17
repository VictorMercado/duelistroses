package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// OpenTemp opens a fresh database in the test's temporary directory, closed
// when the test ends.
func OpenTemp(t testing.TB) *sql.DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}
