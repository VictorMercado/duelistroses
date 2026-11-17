package db

import (
	"strconv"
	"strings"
	"testing"
)

// Every migration has its own version number; a shared one would be skipped.
func TestMigrationVersionsAreUnique(t *testing.T) {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int]string{}
	for _, e := range entries {
		v, err := strconv.Atoi(strings.SplitN(e.Name(), "_", 2)[0])
		if err != nil {
			t.Errorf("%s: name must start with a number", e.Name())
		}
		if other, dup := seen[v]; dup {
			t.Errorf("%s and %s share version %d", other, e.Name(), v)
		}
		seen[v] = e.Name()
	}
}
