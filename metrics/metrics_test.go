package metrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestRoute(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "cards"), 0o755)
	WatchAssets(dir)
	for path, want := range map[string]string{
		"/assets/cards/1.png":    "assets/cards",
		"/assets/made-up/x.png":  "assets/other",
		"/api/rooms":             "api",
		"/ws/abc":                "ws",
		"/app/index-abc.js":      "client",
		"/.well-known/jwks.json": "auth",
	} {
		if got := route(path); got != want {
			t.Errorf("route(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestRecorderKeepsInterfaces(t *testing.T) {
	var rec http.ResponseWriter = &recorder{ResponseWriter: httptest.NewRecorder()}
	if _, ok := rec.(http.Hijacker); !ok {
		t.Fatal("websocket upgrades need Hijack")
	}
	if _, ok := rec.(io.ReaderFrom); !ok {
		t.Fatal("file responses need ReadFrom")
	}
	n, _ := rec.(io.ReaderFrom).ReadFrom(strings.NewReader("hello"))
	if n != 5 || rec.(*recorder).bytes != 5 {
		t.Fatalf("counted %d bytes", rec.(*recorder).bytes)
	}
}

func TestInstrumentServesFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("0123456789"), 0o644)
	h := Instrument(http.StripPrefix("/assets/", http.FileServer(http.Dir(dir))))
	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/assets/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "0123456789" {
		t.Fatalf("body %q", body)
	}
}

func TestInstrumentUpgradesWebsockets(t *testing.T) {
	up := websocket.Upgrader{}
	h := Instrument(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c.WriteMessage(websocket.TextMessage, []byte("hi"))
		c.Close()
	}))
	srv := httptest.NewServer(h)
	defer srv.Close()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/room", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, msg, err := c.ReadMessage(); err != nil || string(msg) != "hi" {
		t.Fatalf("read %q %v", msg, err)
	}
}
