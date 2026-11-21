package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"duelistRoses/bot"
	"duelistRoses/deckai"
)

// The deck builder's assistant: a conversation with Claude that proposes
// decks. Saving still goes through the deck endpoints. Administrators pick
// the model for each conversation and the one players get, and see what
// every message cost.
func (s *Server) registerDeckAI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/deck-assistant", func(w http.ResponseWriter, r *http.Request) {
		available := s.DeckAI != nil && s.DeckAI.Available
		out := map[string]any{"available": available}
		if available {
			model := s.DeckAI.PlayerModel()
			out["model"] = model
			// Administrators get the picker.
			if user, _, err := s.Auth.FromRequest(r); err == nil && user.Admin {
				out["models"] = bot.Models
			}
		}
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("POST /api/deck-assistant", func(w http.ResponseWriter, r *http.Request) {
		user, _, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		if user.Guest {
			fail(w, http.StatusForbidden, "make an account to use the deck assistant")
			return
		}
		if s.DeckAI == nil {
			fail(w, http.StatusNotFound, "the deck assistant is off on this server")
			return
		}
		var in struct {
			Session string        `json:"session"`
			Model   string        `json:"model"`
			Message string        `json:"message"`
			Draft   *deckai.Draft `json:"draft"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		who := deckai.Sender{ID: user.ID, Name: user.Name, Admin: user.Admin}
		reply, err := s.DeckAI.Send(r.Context(), who, in.Session, in.Model, in.Message, in.Draft)
		switch {
		case errors.Is(err, deckai.ErrNoSession):
			fail(w, http.StatusGone, err.Error())
		case errors.Is(err, deckai.ErrBusy):
			fail(w, http.StatusTooManyRequests, err.Error())
		case err != nil:
			fail(w, http.StatusBadGateway, err.Error())
		default:
			writeJSON(w, http.StatusOK, reply)
		}
	})

	admin := func(w http.ResponseWriter, r *http.Request) bool {
		user, _, err := s.Auth.FromRequest(r)
		switch {
		case err != nil:
			fail(w, http.StatusUnauthorized, "sign in first")
		case !user.Admin:
			fail(w, http.StatusForbidden, "that is for administrators")
		case s.DeckAI == nil:
			fail(w, http.StatusNotFound, "the deck assistant is off on this server")
		default:
			return true
		}
		return false
	}
	// The overview: each model's record and the newest messages, over the
	// last `days` days (default 30).
	mux.HandleFunc("GET /api/admin/deck-assistant", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		days, err := strconv.Atoi(r.URL.Query().Get("days"))
		if err != nil || days <= 0 {
			days = 30
		}
		since := time.Now().AddDate(0, 0, -days)
		stats, err := s.DeckAI.Stats(since)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		entries, err := s.DeckAI.Log(since, 200)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"available": s.DeckAI.Available, "models": bot.Models,
			"playerModel": s.DeckAI.PlayerModel(), "defaultModel": s.DeckAI.DefaultModel,
			"stats": stats, "log": entries,
		})
	})
	mux.HandleFunc("PUT /api/admin/deck-assistant", func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		var in struct {
			PlayerModel string `json:"playerModel"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		if err := s.DeckAI.SetPlayerModel(in.PlayerModel); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
