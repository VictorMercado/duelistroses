package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// AccountInfo is an account as the admin dashboard lists it. It never carries
// the password hash.
type AccountInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Admin bool   `json:"admin"`
	// FromConfig marks an admin named in ADMIN_USERS: the dashboard cannot
	// take that away, only the server's configuration can.
	FromConfig bool      `json:"fromConfig,omitempty"`
	Created    time.Time `json:"created,omitempty"`
}

// EnsureAdmin makes sure an administrator account exists, so a fresh server
// can be managed at all. A missing account is created with the password; an
// existing one keeps its password and is only given admin access. It reports
// whether the account was created.
func (s *Service) EnsureAdmin(name, password string) (bool, error) {
	name, err := cleanName(name)
	if err != nil {
		return false, err
	}
	if a, ok := s.store.Find(name); ok {
		if !a.Admin {
			_, err = s.store.Update(a.ID, func(a *account) { a.Admin = true })
		}
		return false, err
	}
	if password == "" || len(password) > 72 {
		return false, errors.New("the admin password must be 1 to 72 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return false, err
	}
	a, err := s.store.Create(name, string(hash))
	if err != nil {
		return false, err
	}
	_, err = s.store.Update(a.ID, func(a *account) { a.Admin = true })
	return err == nil, err
}

func (s *Service) accountInfo(a account) AccountInfo {
	fromConfig := s.admins[strings.ToLower(a.Name)]
	return AccountInfo{ID: a.ID, Name: a.Name, Admin: a.Admin || fromConfig, FromConfig: fromConfig, Created: a.Created}
}

// registerAdmin wires the dashboard's endpoints. Every one of them needs an
// administrator's token.
func (s *Service) registerAdmin(mux *http.ServeMux) {
	admin := func(w http.ResponseWriter, r *http.Request) (User, bool) {
		u, _, err := s.FromRequest(r)
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
	update := func(w http.ResponseWriter, id string, change func(*account)) {
		a, err := s.store.Update(id, change)
		if errors.Is(err, ErrNoAccount) {
			fail(w, http.StatusNotFound, err.Error())
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not save the account")
			return
		}
		writeJSON(w, http.StatusOK, s.accountInfo(a))
	}

	mux.HandleFunc("GET /api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		accounts := s.store.List()
		out := make([]AccountInfo, 0, len(accounts))
		for _, a := range accounts {
			out = append(out, s.accountInfo(a))
		}
		writeJSON(w, http.StatusOK, out)
	})

	// An administrator can open an account for someone, with a password to
	// hand over, and make it an administrator straight away.
	mux.HandleFunc("POST /api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		var req struct {
			Name     string `json:"name"`
			Password string `json:"password"`
			Admin    bool   `json:"admin"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req) != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		name, err := cleanName(req.Name)
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(req.Password) < 8 || len(req.Password) > 72 {
			fail(w, http.StatusBadRequest, "a password is 8 to 72 characters")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not create the account")
			return
		}
		a, err := s.store.Create(name, string(hash))
		if errors.Is(err, ErrNameTaken) {
			fail(w, http.StatusConflict, err.Error())
			return
		}
		if err == nil && req.Admin {
			a, err = s.store.Update(a.ID, func(a *account) { a.Admin = true })
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not create the account")
			return
		}
		writeJSON(w, http.StatusCreated, s.accountInfo(a))
	})

	mux.HandleFunc("PUT /api/admin/users/{id}/admin", func(w http.ResponseWriter, r *http.Request) {
		me, ok := admin(w, r)
		if !ok {
			return
		}
		var req struct {
			Admin bool `json:"admin"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req) != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		id := r.PathValue("id")
		if id == me.ID && !req.Admin {
			// Otherwise the last administrator could lock everyone out.
			fail(w, http.StatusBadRequest, "you cannot take away your own admin access")
			return
		}
		update(w, id, func(a *account) { a.Admin = req.Admin })
	})

	mux.HandleFunc("PUT /api/admin/users/{id}/password", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := admin(w, r); !ok {
			return
		}
		var req struct {
			Password string `json:"password"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req) != nil {
			fail(w, http.StatusBadRequest, "malformed request")
			return
		}
		if req.Password == "" || len(req.Password) > 72 {
			fail(w, http.StatusBadRequest, "a password is 1 to 72 characters")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not set the password")
			return
		}
		update(w, r.PathValue("id"), func(a *account) { a.Hash = string(hash) })
	})
}

// AccountByID looks a registered duelist up by id.
func (s *Service) AccountByID(id string) (AccountInfo, bool) {
	a, ok := s.store.Get(id)
	if !ok {
		return AccountInfo{}, false
	}
	return s.accountInfo(a), true
}

// Account looks a registered duelist up by name, for their public profile.
func (s *Service) Account(name string) (AccountInfo, bool) {
	a, ok := s.store.Find(strings.Join(strings.Fields(name), " "))
	if !ok {
		return AccountInfo{}, false
	}
	return s.accountInfo(a), true
}
