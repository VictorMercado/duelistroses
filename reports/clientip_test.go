package reports

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name, remote, xff, want string
	}{
		{"direct", "203.0.113.7:5000", "", "203.0.113.7"},
		{"direct client cannot fake the header", "203.0.113.7:5000", "1.2.3.4", "203.0.113.7"},
		{"behind Traefik", "172.18.0.2:5000", "198.51.100.9", "198.51.100.9"},
		{"spoofed entry left of the real one", "172.18.0.2:5000", "1.2.3.4, 198.51.100.9", "198.51.100.9"},
		{"two proxies", "127.0.0.1:5000", "198.51.100.9, 10.0.0.5", "198.51.100.9"},
		{"LAN player", "172.18.0.2:5000", "192.168.1.20", "192.168.1.20"},
		{"proxy without the header", "172.18.0.2:5000", "", "172.18.0.2"},
		{"garbage header", "172.18.0.2:5000", "nonsense", "172.18.0.2"},
		{"ipv6", "[::1]:5000", "2001:db8::1", "2001:db8::1"},
		// player → Cloudflare (162.158.x) → Traefik (172.18.0.2) → us
		{"Cloudflare kept in the chain", "172.18.0.2:5000", "198.51.100.9, 162.158.1.2", "198.51.100.9"},
		{"Cloudflare plugin rewrote the header", "172.18.0.2:5000", "198.51.100.9", "198.51.100.9"},
		{"Traefik replaced the header with Cloudflare's address", "172.18.0.2:5000", "162.158.1.2|cf=198.51.100.9", "198.51.100.9"},
		{"Cloudflare without CF-Connecting-IP", "172.18.0.2:5000", "162.158.1.2", "162.158.1.2"},
		{"CF-Connecting-IP ignored from a non-Cloudflare hop", "172.18.0.2:5000", "10.0.0.9|cf=1.2.3.4", "10.0.0.9"},
		{"CF-Connecting-IP ignored when sent straight to us", "203.0.113.7:5000", "|cf=1.2.3.4", "203.0.113.7"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.remote
		xff, cf, _ := strings.Cut(c.xff, "|cf=")
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		if cf != "" {
			r.Header.Set("CF-Connecting-IP", cf)
		}
		if got := ClientIP(r); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}
