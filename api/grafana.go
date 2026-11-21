package api

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

// Grafana (the monitoring dashboards) is shown inside the admin portal: the
// game server proxies it at /grafana/, to administrators only, and signs in
// to it on their behalf, so there is no second login and nothing else to
// open. Grafana itself is configured to live under /grafana/ and to allow
// being embedded (see docker-compose.yml).
//
//	GRAFANA_URL             where Grafana is (default http://localhost:3000; grafana:3000 in compose)
//	GRAFANA_ADMIN_USER      its admin user (default admin)
//	GRAFANA_ADMIN_PASSWORD  its admin password: unset, monitoring is off
//
// An embedded page cannot send the Authorization header the rest of the API
// uses, so the admin portal first trades its token for a cookie scoped to
// /grafana/ (HttpOnly, SameSite=Strict, never sent by another site): POST
// /api/admin/grafana/session.

const grafanaCookie = "duelist_grafana"

func (s *Server) registerGrafana(mux *http.ServeMux) {
	password := os.Getenv("GRAFANA_ADMIN_PASSWORD")
	user := env("GRAFANA_ADMIN_USER", "admin")
	target, err := url.Parse(env("GRAFANA_URL", "http://localhost:3000"))
	if err != nil {
		log.Printf("grafana: GRAFANA_URL: %v; monitoring is off", err)
		password = ""
	}

	mux.HandleFunc("POST /api/admin/grafana/session", func(w http.ResponseWriter, r *http.Request) {
		u, raw, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		if !u.Admin {
			fail(w, http.StatusForbidden, "that is for administrators")
			return
		}
		if password == "" {
			fail(w, http.StatusServiceUnavailable, "monitoring is not set up on this server (GRAFANA_ADMIN_PASSWORD is unset)")
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name: grafanaCookie, Value: raw, Path: "/grafana/",
			HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure(r),
			// The token inside expires on its own; the portal asks again each time it opens the page.
			MaxAge: int((12 * time.Hour).Seconds()),
		})
		w.WriteHeader(http.StatusNoContent)
	})

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path, pr.Out.URL.RawPath = pr.In.URL.Path, pr.In.URL.RawPath // Grafana serves from /grafana/ itself
			pr.Out.Host = target.Host
			pr.SetXForwarded()
			// Signed in as Grafana's admin; our own cookie stays here.
			pr.Out.Header.Del("Cookie")
			for _, c := range pr.In.Cookies() {
				if c.Name != grafanaCookie {
					pr.Out.AddCookie(c)
				}
			}
			pr.Out.SetBasicAuth(user, password)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("grafana: %s: %v", r.URL.Path, err)
			http.Error(w, "Grafana is not reachable: is the monitoring stack running?", http.StatusBadGateway)
		},
	}
	mux.HandleFunc("/grafana/", func(w http.ResponseWriter, r *http.Request) {
		if password == "" {
			http.Error(w, "Monitoring is not set up on this server.", http.StatusServiceUnavailable)
			return
		}
		c, err := r.Cookie(grafanaCookie)
		if err != nil {
			http.Error(w, "Open Monitoring from the admin portal.", http.StatusUnauthorized)
			return
		}
		u, err := s.Auth.Verify(c.Value)
		if err != nil {
			http.Error(w, "Your session has expired: open Monitoring from the admin portal again.", http.StatusUnauthorized)
			return
		}
		if !u.Admin {
			http.Error(w, "That is for administrators.", http.StatusForbidden)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// secure reports whether the page was reached over HTTPS, directly or behind
// a proxy (Traefik) that says so.
func secure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
