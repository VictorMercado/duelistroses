package reports

import (
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
)

// Named groups TRUSTED_PROXIES may use beside CIDRs and addresses.
var proxyGroups = map[string]string{
	// Traefik on the LAN, Docker's bridge, the host itself.
	"private": "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7",
	// Cloudflare's edge (https://www.cloudflare.com/ips/).
	"cloudflare": cloudflareRanges,
}

const cloudflareRanges = "173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18," +
	"190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14," +
	"172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32," +
	"2a06:98c0::/29,2c0f:f248::/32"

var (
	// trusted are the proxies whose forwarding headers are believed.
	// TRUSTED_PROXIES (comma-separated CIDRs, addresses, "private" or
	// "cloudflare") replaces the default, "private,cloudflare".
	trusted    = parseTrusted(os.Getenv("TRUSTED_PROXIES"))
	cloudflare = parseTrusted("cloudflare")
)

func parseTrusted(env string) []netip.Prefix {
	if strings.TrimSpace(env) == "" {
		env = "private,cloudflare"
	}
	var out []netip.Prefix
	for _, s := range strings.Split(env, ",") {
		s = strings.TrimSpace(s)
		if group, ok := proxyGroups[strings.ToLower(s)]; ok {
			out = append(out, parseTrusted(group)...)
		} else if s == "" {
			continue
		} else if p, err := netip.ParsePrefix(s); err == nil {
			out = append(out, p.Masked())
		} else if a, err := netip.ParseAddr(s); err == nil {
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
		} else {
			log.Printf("TRUSTED_PROXIES: %q is not an address, CIDR, \"private\" or \"cloudflare\"", s)
		}
	}
	return out
}

func in(list []netip.Prefix, a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range list {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// ClientIP is the address of the player who sent r (player → Cloudflare →
// Traefik → us). Forwarding headers are believed only when the connection
// comes from a trusted proxy: X-Forwarded-For is walked from the right (the
// hop nearest us) to the first address that is not a trusted proxy, so a
// client cannot fake it by sending its own header. When the chain ends at
// Cloudflare (Traefik replaced X-Forwarded-For with Cloudflare's address),
// Cloudflare's CF-Connecting-IP names the player.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || !in(trusted, peer) {
		return host
	}
	last := peer.Unmap()
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		a = a.Unmap()
		if !in(trusted, a) {
			return a.String()
		}
		last = a
	}
	// Every hop was a trusted proxy. If the outermost is Cloudflare, it says
	// who connected to it; otherwise the player is on the LAN.
	if in(cloudflare, last) {
		for _, h := range []string{"CF-Connecting-IP", "X-Real-IP"} {
			if a, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get(h))); err == nil && !in(trusted, a) {
				return a.Unmap().String()
			}
		}
	}
	return last.String()
}
