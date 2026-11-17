package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"duelistRoses/auth"
)

// social is what the friends list needs beyond the stored friendships: who
// was recently here, and invitations to a room. Both are short lived, so they
// are kept in memory.
type social struct {
	mu      sync.Mutex
	seen    map[string]time.Time
	invites map[string][]invite // by the invited user's id
}

type invite struct {
	From   auth.Person `json:"from"`
	RoomID string      `json:"roomId"`
	at     time.Time
}

const (
	onlineWindow = 20 * time.Second
	inviteLife   = 3 * time.Minute
)

type friendView struct {
	auth.Person
	Online bool   `json:"online"`
	RoomID string `json:"roomId,omitempty"` // the room they are in, if any
}

func (s *Server) registerFriends(mux *http.ServeMux) {
	s.social.seen = map[string]time.Time{}
	s.social.invites = map[string][]invite{}

	// account is the caller, who must have a real account for anything here.
	account := func(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
		u, _, err := s.Auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return u, false
		}
		if u.Guest {
			fail(w, http.StatusForbidden, auth.ErrGuestFriend.Error())
			return u, false
		}
		return u, true
	}
	body := func(w http.ResponseWriter, r *http.Request) (req struct{ Name, ID, RoomID string }, ok bool) {
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req) != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return req, false
		}
		return req, true
	}

	// The client polls this, which is also how the server knows who is around.
	mux.HandleFunc("GET /api/friends", func(w http.ResponseWriter, r *http.Request) {
		u, ok := account(w, r)
		if !ok {
			return
		}
		friends, incoming, outgoing := s.Auth.Friends.Of(u)
		now := time.Now()

		s.social.mu.Lock()
		s.social.seen[u.ID] = now
		views := make([]friendView, 0, len(friends))
		for _, f := range friends {
			room := s.Hub.RoomOf(f.ID)
			views = append(views, friendView{Person: f, RoomID: room, Online: room != "" || now.Sub(s.social.seen[f.ID]) < onlineWindow})
		}
		live := []invite{}
		for _, in := range s.social.invites[u.ID] {
			if now.Sub(in.at) < inviteLife && s.Hub.Get(in.RoomID) != nil {
				live = append(live, in)
			}
		}
		s.social.invites[u.ID] = live
		s.social.mu.Unlock()

		writeJSON(w, http.StatusOK, map[string]any{"friends": views, "incoming": incoming, "outgoing": outgoing, "invites": live})
	})

	mux.HandleFunc("POST /api/friends/request", func(w http.ResponseWriter, r *http.Request) {
		u, ok := account(w, r)
		if !ok {
			return
		}
		req, ok := body(w, r)
		if !ok {
			return
		}
		other, found := s.Auth.FindAccount(req.Name)
		if !found {
			fail(w, http.StatusNotFound, "no duelist has that name")
			return
		}
		accepted, err := s.Auth.Friends.Request(u, other)
		if errors.Is(err, auth.ErrSelfFriend) {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not save the request")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"friends": accepted})
	})

	mux.HandleFunc("POST /api/friends/accept", func(w http.ResponseWriter, r *http.Request) {
		u, ok := account(w, r)
		if !ok {
			return
		}
		req, ok := body(w, r)
		if !ok {
			return
		}
		if err := s.Auth.Friends.Accept(u, req.ID); err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"friends": true})
	})

	// Unfriend, decline a request, or cancel one you sent.
	mux.HandleFunc("POST /api/friends/remove", func(w http.ResponseWriter, r *http.Request) {
		u, ok := account(w, r)
		if !ok {
			return
		}
		req, ok := body(w, r)
		if !ok {
			return
		}
		if err := s.Auth.Friends.Remove(u, req.ID); err != nil {
			fail(w, http.StatusInternalServerError, "could not save the change")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"friends": false})
	})

	// Invite a friend to the room the caller is in.
	mux.HandleFunc("POST /api/friends/invite", func(w http.ResponseWriter, r *http.Request) {
		u, ok := account(w, r)
		if !ok {
			return
		}
		req, ok := body(w, r)
		if !ok {
			return
		}
		if !s.Auth.Friends.AreFriends(u.ID, req.ID) {
			fail(w, http.StatusForbidden, "you can only invite friends")
			return
		}
		room := s.Hub.RoomOf(u.ID)
		if room == "" {
			fail(w, http.StatusBadRequest, "open a lobby first")
			return
		}
		s.social.mu.Lock()
		kept := []invite{}
		for _, in := range s.social.invites[req.ID] {
			if in.From.ID != u.ID {
				kept = append(kept, in)
			}
		}
		s.social.invites[req.ID] = append(kept, invite{From: auth.Person{ID: u.ID, Name: u.Name}, RoomID: room, at: time.Now()})
		s.social.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"roomId": room})
	})
}
