package api

import (
	"net/http"
	"time"

	"duelistRoses/auth"
	"duelistRoses/content"
	"duelistRoses/profile"
)

type profileUser struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Guest  bool      `json:"guest,omitempty"`
	Admin  bool      `json:"admin,omitempty"`
	Joined time.Time `json:"joined,omitzero"`
}

type collection struct {
	Decks       int `json:"decks"`
	PublicDecks int `json:"publicDecks"`
	Maps        int `json:"maps"`
	Friends     int `json:"friends"`
}

type profileView struct {
	User       profileUser     `json:"user"`
	Me         bool            `json:"me"`
	Friend     bool            `json:"friend"`
	Record     profile.Record  `json:"record"`
	Decks      []profile.Named `json:"decks"`
	Rivals     []profile.Named `json:"rivals"`
	Maps       []profile.Named `json:"maps"`
	Collection collection      `json:"collection"`
	// OwnDecks are the decks they built, shown to themselves and to
	// administrators (who may edit them); nil for anyone else.
	OwnDecks []content.Deck `json:"ownDecks,omitempty"`
	// CanEdit says the viewer may change OwnDecks.
	CanEdit bool `json:"canEdit,omitempty"`
}

// registerProfiles serves duelists' profiles: GET /api/profile is the
// caller's own, GET /api/profile/{name} anyone's with an account. Any signed
// in duelist may look at any account's profile, as they may look at the
// games being played.
func (s *Server) registerProfiles(mux *http.ServeMux) {
	handle := func(w http.ResponseWriter, r *http.Request, name string) {
		viewer, _, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		if name == "" && viewer.Guest {
			// A guest has no record to show, only who they are.
			writeJSON(w, http.StatusOK, profileView{
				User: profileUser{ID: viewer.ID, Name: viewer.Name, Guest: true}, Me: true,
				Record: profile.Record{Recent: []profile.Summary{}},
				Decks:  []profile.Named{}, Rivals: []profile.Named{}, Maps: []profile.Named{},
			})
			return
		}
		if name == "" {
			name = viewer.Name
		}
		account, ok := s.Auth.Account(name)
		if !ok {
			fail(w, http.StatusNotFound, "there is no duelist by that name")
			return
		}
		me := !viewer.Guest && account.ID == viewer.ID
		view := profileView{
			User:   profileUser{ID: account.ID, Name: account.Name, Admin: account.Admin, Joined: account.Created},
			Me:     me,
			Record: s.Profiles.Get(account.ID),
		}
		view.Friend = !me && s.Auth.Friends.AreFriends(viewer.ID, account.ID)
		view.Decks, view.Rivals, view.Maps = s.Profiles.Top(account.ID, 50)
		view.Collection.Decks, view.Collection.PublicDecks, view.Collection.Maps = s.Hub.Content.Collection(account.ID)
		friends, _, _ := s.Auth.Friends.Of(auth.User{ID: account.ID})
		view.Collection.Friends = len(friends)
		if me || viewer.Admin {
			view.OwnDecks, view.CanEdit = s.Hub.Content.DecksOf(account.ID), true
		}
		if !me && !viewer.Admin {
			// A room's name is how to get into it: other people only see
			// who played, not where.
			for i := range view.Record.Recent {
				view.Record.Recent[i].Room = ""
			}
		}
		writeJSON(w, http.StatusOK, view)
	}
	mux.HandleFunc("GET /api/profile", func(w http.ResponseWriter, r *http.Request) { handle(w, r, "") })
	mux.HandleFunc("GET /api/profile/{name}", func(w http.ResponseWriter, r *http.Request) { handle(w, r, r.PathValue("name")) })
}
