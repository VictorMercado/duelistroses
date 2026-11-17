package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"duelistRoses/bot"
	"duelistRoses/cardlab"
	"duelistRoses/game"

	"duelistRoses/auth"
)

// registerAdmin wires the administrators' room controls: every room on the
// server, private ones included, and closing any of them.
func (s *Server) registerAdmin(mux *http.ServeMux) {
	admin := func(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
		u, _, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return u, false
		}
		if !u.Admin {
			fail(w, http.StatusForbidden, "that is for administrators")
			return u, false
		}
		return u, true
	}

	mux.HandleFunc("GET /api/admin/rooms", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		writeJSON(w, http.StatusOK, s.Hub.All())
	})

	// Closing a room ends its duel, if one is on, and disconnects everyone in it.
	mux.HandleFunc("DELETE /api/admin/rooms/{id}", func(w http.ResponseWriter, r *http.Request) {
		me, ok := admin(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		if !s.Hub.Close(id, "An administrator closed this room") {
			fail(w, http.StatusNotFound, "that room is gone")
			return
		}
		log.Printf("admin %s (%s) closed room %s", me.Name, me.ID, id)
		w.WriteHeader(http.StatusNoContent)
	})

	// The arena: batches of test games between computer players, run on the
	// server in parallel, with their results and what the LLM calls cost.
	mux.HandleFunc("GET /api/admin/arena", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		if s.Arena == nil {
			fail(w, http.StatusNotFound, "the arena is off on this server")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"kinds": s.Arena.Kinds(), "jobs": s.Arena.Jobs()})
	})
	mux.HandleFunc("POST /api/admin/arena", func(w http.ResponseWriter, r *http.Request) {
		me, ok := admin(w, r)
		if !ok {
			return
		}
		if s.Arena == nil {
			fail(w, http.StatusNotFound, "the arena is off on this server")
			return
		}
		var spec game.ArenaSpec
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&spec); err != nil {
			fail(w, http.StatusBadRequest, "that is not a test job")
			return
		}
		job, err := s.Arena.Start(spec, me.Name)
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": job.ID})
	})
	// Stops a running job; a finished one is forgotten.
	mux.HandleFunc("DELETE /api/admin/arena/{id}", func(w http.ResponseWriter, r *http.Request) {
		me, ok := admin(w, r)
		if !ok {
			return
		}
		if s.Arena == nil || !s.Arena.Stop(r.PathValue("id"), me.Name) {
			fail(w, http.StatusNotFound, "that job is gone")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// The card lab: a conversation with Claude that designs cards. It only
	// proposes them; saving goes through the card editor's endpoints.
	mux.HandleFunc("GET /api/admin/cardlab", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		available := s.CardLab != nil && s.CardLab.Available
		writeJSON(w, http.StatusOK, map[string]any{"available": available, "models": bot.Models, "default": s.LLMDefault})
	})
	mux.HandleFunc("POST /api/admin/cardlab", func(w http.ResponseWriter, r *http.Request) {
		me, ok := admin(w, r)
		if !ok {
			return
		}
		if s.CardLab == nil {
			fail(w, http.StatusNotFound, "the card lab is off on this server")
			return
		}
		var in struct {
			Session string `json:"session"`
			Model   string `json:"model"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		reply, err := s.CardLab.Send(r.Context(), in.Session, in.Model, in.Message)
		switch {
		case errors.Is(err, cardlab.ErrNoSession):
			fail(w, http.StatusGone, err.Error())
		case err != nil:
			fail(w, http.StatusBadGateway, err.Error())
		default:
			log.Printf("card lab: %s, conversation %s, $%.4f this message", me.Name, reply.Session, reply.TurnCost)
			writeJSON(w, http.StatusOK, reply)
		}
	})
}
