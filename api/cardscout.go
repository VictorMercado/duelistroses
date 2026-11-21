package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"duelistRoses/auth"
	"duelistRoses/cardscout"
)

// registerCardScout wires the card scout's review page in the admin portal:
// what it found, its options for each card, and accepting or rejecting them.
func (s *Server) registerCardScout(mux *http.ServeMux) {
	admin := func(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			u, _, err := s.Auth.FromRequest(r)
			if err != nil {
				fail(w, http.StatusUnauthorized, "sign in first")
				return
			}
			if !u.Admin {
				fail(w, http.StatusForbidden, "that is for administrators")
				return
			}
			if s.Scout == nil {
				fail(w, http.StatusNotFound, "the card scout is off on this server")
				return
			}
			next(w, r, u)
		}
	}
	id := func(w http.ResponseWriter, r *http.Request) (int64, bool) {
		n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, http.StatusBadRequest, "not a suggestion id")
		}
		return n, err == nil
	}
	done := func(w http.ResponseWriter, err error) {
		switch {
		case errors.Is(err, cardscout.ErrNotFound):
			fail(w, http.StatusNotFound, err.Error())
		case err != nil:
			fail(w, http.StatusBadRequest, err.Error())
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}

	mux.HandleFunc("GET /api/admin/scout", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		list, err := s.Scout.List(r.URL.Query().Get("status"), 0)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not read the suggestions")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": s.Scout.Status(), "suggestions": list})
	}))
	// {"running": true|false} switches background scouting on or off.
	mux.HandleFunc("POST /api/admin/scout/running", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		var in struct{ Running bool }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		done(w, s.Scout.SetRunning(in.Running))
	}))
	// Scouts the next card now, running or not.
	mux.HandleFunc("POST /api/admin/scout/scan", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if !s.Scout.Available {
			fail(w, http.StatusBadRequest, "no Anthropic credentials on the server")
			return
		}
		s.Scout.ScanSoon(0)
		w.WriteHeader(http.StatusAccepted)
	}))
	// A card image an administrator wants in the game (multipart: "card", the
	// image of the real card; "art", optional, the picture to draw it with;
	// "hint", optional notes for Claude). Claude reads and adapts it in the
	// background; the suggestion shows as "working" until it is done.
	mux.HandleFunc("POST /api/admin/scout/upload", admin(func(w http.ResponseWriter, r *http.Request, u auth.User) {
		r.Body = http.MaxBytesReader(w, r.Body, 2*cardscout.MaxUpload+64<<10)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			fail(w, http.StatusBadRequest, "send the card image as a form upload (at most 15 MB each)")
			return
		}
		read := func(field string) ([]byte, error) {
			f, _, err := r.FormFile(field)
			if errors.Is(err, http.ErrMissingFile) {
				return nil, nil
			}
			if err != nil {
				return nil, err
			}
			defer f.Close()
			return io.ReadAll(io.LimitReader(f, cardscout.MaxUpload+1))
		}
		card, err := read("card")
		if err != nil || len(card) == 0 {
			fail(w, http.StatusBadRequest, "drop the image of the card first")
			return
		}
		art, err := read("art")
		if err != nil {
			fail(w, http.StatusBadRequest, "the art could not be read")
			return
		}
		if len(card) > cardscout.MaxUpload || len(art) > cardscout.MaxUpload {
			fail(w, http.StatusBadRequest, "an image is over 15 MB")
			return
		}
		id, err := s.Scout.Upload(u.Name, card, art, r.FormValue("hint"))
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]int64{"id": id})
	}))
	// {"option": 0|1} saves that option as a new card.
	mux.HandleFunc("POST /api/admin/scout/{id}/accept", admin(func(w http.ResponseWriter, r *http.Request, u auth.User) {
		n, ok := id(w, r)
		if !ok {
			return
		}
		var in struct{ Option int }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		num, err := s.Scout.Accept(r.Context(), n, in.Option, u.Name)
		if err != nil {
			done(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"num": num})
	}))
	mux.HandleFunc("POST /api/admin/scout/{id}/reject", admin(func(w http.ResponseWriter, r *http.Request, u auth.User) {
		if n, ok := id(w, r); ok {
			done(w, s.Scout.Reject(n, u.Name))
		}
	}))
	// {"feedback": "..."} asks Claude again, with the reviewer's notes.
	mux.HandleFunc("POST /api/admin/scout/{id}/rescan", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		n, ok := id(w, r)
		if !ok {
			return
		}
		var in struct{ Feedback string }
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in)
		done(w, s.Scout.Rescan(n, in.Feedback))
	}))
	mux.HandleFunc("POST /api/admin/scout/{id}/assets", admin(func(w http.ResponseWriter, r *http.Request, _ auth.User) {
		if n, ok := id(w, r); ok {
			done(w, s.Scout.RetryAssets(n))
		}
	}))
}
