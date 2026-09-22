package api

import (
	"net/http"
	"net/url"
	"os"
	"strings"
)

// productionOrigin is where the game is served from in production. The Go
// server serves web/dist itself, so browsers there are same-origin; this is
// the explicit fallback for when a reverse proxy rewrites the Host header.
const productionOrigin = "https://duelistroses.netarc.app"

// allowedOrigins is resolved once at startup: the production site plus
// anything in ALLOWED_ORIGINS (comma separated), so another deployment host
// can be added without editing this file.
var allowedOrigins = buildAllowedOrigins()

func buildAllowedOrigins() []string {
	origins := []string{productionOrigin}
	for _, extra := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if extra = strings.TrimRight(strings.TrimSpace(extra), "/"); extra != "" {
			origins = append(origins, extra)
		}
	}
	return origins
}

// isDevHost reports whether hostname is a local development host. The vite dev
// server and the Go server listen on different ports locally, so the port is
// deliberately not part of the check.
func isDevHost(hostname string) bool {
	switch hostname {
	case "localhost", "127.0.0.1", "::1", "0.0.0.0":
		return true
	}
	return strings.HasSuffix(hostname, ".localhost")
}

// resolveAllowedOrigin reports whether the request may talk to this server and,
// when it may, echoes back the origin to use in Access-Control-Allow-Origin.
//
// A request with no Origin header is not a cross-origin browser request (curl,
// a native client), so it is allowed and gets no CORS header.
func resolveAllowedOrigin(r *http.Request) (origin string, ok bool) {
	origin = r.Header.Get("Origin")
	if origin == "" {
		return "", true
	}

	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return "", false
	}

	// Same-origin: the page is talking to the host it was loaded from, which is
	// the normal production path.
	if strings.EqualFold(u.Host, r.Host) {
		return origin, true
	}

	// Dev: the page comes from the vite server, which proxies through to here.
	if isDevHost(u.Hostname()) {
		return origin, true
	}

	for _, allowed := range allowedOrigins {
		if strings.EqualFold(allowed, strings.TrimRight(origin, "/")) {
			return origin, true
		}
	}

	return "", false
}
