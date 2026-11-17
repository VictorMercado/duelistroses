// Package db opens the server's one SQLite database and keeps its schema up
// to date. Everything that lasts lives there: accounts, friends, decks, maps,
// duel records and the card catalog itself.
package db

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // pure Go: the server still builds with CGO_ENABLED=0
)

//go:embed migrations/*.sql
var migrations embed.FS

// Open opens (creating if needed) the database at path and applies any
// migration it has not had yet.
func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite takes one writer at a time. One connection makes that queueing
	// Go's job instead of a "database is locked" error; this server's load is
	// far below what that costs. Code holding a transaction must therefore
	// never use the *sql.DB itself until it commits.
	d.SetMaxOpenConns(1)
	if err := migrate(d); err != nil {
		d.Close()
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return d, nil
}

func migrate(d *sql.DB) error {
	if _, err := d.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	// Files are named 0001_what.sql; the number is the version. Two files
	// with one number would see the second skipped as already applied, so
	// that refuses to start instead.
	seen := map[int]string{}
	for _, name := range names {
		version, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", name)
		}
		if other, dup := seen[version]; dup {
			return fmt.Errorf("migrations %s and %s share version %d: renumber one", other, name, version)
		}
		seen[version] = name
	}
	for _, name := range names {
		version, _ := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		var applied int
		if err := d.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := d.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, Time(time.Now())); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// Time is how times are stored: UTC RFC 3339 text, which sorts correctly.
func Time(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// ParseTime reads a time written by Time; "" is the zero time.
func ParseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

// Bool converts SQLite's 0 and 1.
func Bool(b bool) int {
	if b {
		return 1
	}
	return 0
}

// Empty reports whether a table has no rows, which is when its legacy JSON
// file (if any) is imported.
func Empty(d interface {
	QueryRow(string, ...any) *sql.Row
}, table string) (bool, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n)
	return n == 0, err
}

// ImportLegacy reads a JSON file the server kept before it had a database and
// hands its bytes to load. Once loaded, the file is renamed to .imported so it
// is never read again but stays on disk as a backup. A missing file is fine.
func ImportLegacy(path string, load func(data []byte) error) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := load(data); err != nil {
		return fmt.Errorf("importing %s: %w", path, err)
	}
	return os.Rename(path, path+".imported")
}
