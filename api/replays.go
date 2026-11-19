package api

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"duelistRoses/replay"
)

// registerReplays serves recorded duels. There are no permissions yet:
// anyone, signed in or not, may list and watch any replay.
//
//	GET /api/replays?user=<account id>&before=<RFC 3339>&limit=<n>
//	GET /api/replays/{id}         what the replay is
//	GET /api/replays/{id}/frames  the recording itself (see package replay)
func (s *Server) registerReplays(mux *http.ServeMux) {
	if s.Replays == nil {
		return
	}
	mux.HandleFunc("GET /api/replays", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		if limit <= 0 || limit > 100 {
			limit = 30
		}
		var before time.Time
		if b := q.Get("before"); b != "" {
			t, err := time.Parse(time.RFC3339Nano, b)
			if err != nil {
				fail(w, http.StatusBadRequest, "before is an RFC 3339 time")
				return
			}
			before = t
		}
		list, err := s.Replays.List(q.Get("user"), before, limit)
		if err != nil {
			log.Printf("listing replays: %v", err)
			fail(w, http.StatusInternalServerError, "could not list the replays")
			return
		}
		writeJSON(w, http.StatusOK, list)
	})
	mux.HandleFunc("GET /api/replays/{id}", func(w http.ResponseWriter, r *http.Request) {
		m, err := s.Replays.Get(r.PathValue("id"))
		if errors.Is(err, replay.ErrNotFound) {
			fail(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			log.Printf("reading replay: %v", err)
			fail(w, http.StatusInternalServerError, "could not read the replay")
			return
		}
		writeJSON(w, http.StatusOK, m)
	})
	mux.HandleFunc("GET /api/replays/{id}/frames", func(w http.ResponseWriter, r *http.Request) {
		frames, err := s.Replays.Frames(r.PathValue("id"))
		if errors.Is(err, replay.ErrNotFound) {
			fail(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			log.Printf("reading replay: %v", err)
			fail(w, http.StatusInternalServerError, "could not read the replay")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Vary", "Accept-Encoding")
		// A recording never changes once saved.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		// Stored gzipped: sent as is to any client that takes gzip (every browser).
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(frames)
			return
		}
		plain, err := replay.Gunzip(frames)
		if err != nil {
			fail(w, http.StatusInternalServerError, "the replay is damaged")
			return
		}
		w.Write(plain)
	})
}
