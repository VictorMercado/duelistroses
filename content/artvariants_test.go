package content

import (
	"os"
	"path/filepath"
	"testing"
)

func TestArtVariants(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "cards", "sm"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"cards/001.webp", "cards/sm/001.webp", "cards/002.webp"} {
		if err := os.WriteFile(filepath.Join(dir, f), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	old := artDir
	artDir = dir
	defer func() { artDir = old }()

	cases := []struct{ image, full, small string }{
		{"cards/001.png", "cards/001.webp", "cards/sm/001.webp"},
		{"cards/002.png", "cards/002.webp", ""}, // no small copy yet
		{"cards/003.png", "", ""},               // art added after the copies were made
		{"", "", ""},
	}
	for _, c := range cases {
		full, small := artVariants(c.image)
		if full != c.full || small != c.small {
			t.Errorf("artVariants(%q) = %q, %q; want %q, %q", c.image, full, small, c.full, c.small)
		}
	}
}
