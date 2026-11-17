// Package auth is the one place accounts exist. The game server registers
// players, signs them in and issues signed tokens (RS256 JWTs). Anything
// else that needs to check a token can do so with the public key published at
// the standard OpenID Connect discovery endpoints served from here.
package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const Audience = "duelist-city"

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Guest bool   `json:"guest"`
	// Admin users may watch any duel with nothing hidden.
	Admin bool `json:"admin,omitempty"`
}

type account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Hash string `json:"hash"`
	// Admin is admin access granted from the dashboard (see admin.go).
	Admin   bool      `json:"admin,omitempty"`
	Created time.Time `json:"created,omitempty"`
}

// Store is where accounts live (see sqlStore in store.go).
type Store interface {
	Create(name, hash string) (account, error)
	Find(name string) (account, bool)
	// Get finds an account by id.
	Get(id string) (account, bool)
	List() []account
	// Update changes the account with that id; change must not rename it.
	Update(id string, change func(*account)) (account, error)
}

var (
	ErrNameTaken = errors.New("that name is already taken")
	ErrNoAccount = errors.New("no such account")
)

func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err) // no randomness, no safe ids
	}
	return hex.EncodeToString(b)
}

type Service struct {
	issuer string
	key    *rsa.PrivateKey
	kid    string
	store  Store
	// admins holds the lower-cased account names with admin access.
	admins map[string]bool
	// Friends is who knows whom among the accounts.
	Friends *Friends
	// decoy is compared against when a login names no account, so a wrong
	// name costs the same time as a wrong password.
	decoy []byte
}

// New loads (or on first run creates) the signing key in
// dir. issuer is the public URL of this server; it is written into every token
// and is what verifiers use to find the keys.
//
// Accounts and friends live in database; on the first run with a database,
// the accounts.json and friends.json the server used to keep in dir are
// imported into it.
func New(dir string, database *sql.DB, issuer string, admins []string) (*Service, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	key, err := loadOrCreateKey(filepath.Join(dir, "signing_key.pem"))
	if err != nil {
		return nil, err
	}
	store, err := newSQLStore(database, filepath.Join(dir, "accounts.json"))
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(x509.MarshalPKCS1PublicKey(&key.PublicKey))
	decoy, err := bcrypt.GenerateFromPassword([]byte(newID()), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	friends, err := newFriends(database, filepath.Join(dir, "friends.json"))
	if err != nil {
		return nil, err
	}
	s := &Service{issuer: strings.TrimRight(issuer, "/"), key: key, kid: hex.EncodeToString(sum[:8]), store: store, decoy: decoy, Friends: friends, admins: adminSet(admins)}
	return s, nil
}

// FindAccount looks a registered duelist up by name.
func (s *Service) FindAccount(name string) (User, bool) {
	a, ok := s.store.Find(strings.Join(strings.Fields(name), " "))
	return User{ID: a.ID, Name: a.Name}, ok
}

func loadOrCreateKey(path string) (*rsa.PrivateKey, error) {
	if data, err := os.ReadFile(path); err == nil {
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, fmt.Errorf("%s is not a PEM file", path)
		}
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	data := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return key, os.WriteFile(path, data, 0o600)
}

type claims struct {
	Name  string `json:"name"`
	Guest bool   `json:"guest,omitempty"`
	jwt.RegisteredClaims
}

func (s *Service) Issue(u User) (string, error) {
	now := time.Now()
	lifetime := 7 * 24 * time.Hour
	if u.Guest {
		lifetime = 30 * 24 * time.Hour
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims{
		Name: u.Name, Guest: u.Guest,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: s.issuer, Subject: u.ID, Audience: jwt.ClaimStrings{Audience},
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(lifetime)),
		},
	})
	token.Header["kid"] = s.kid
	return token.SignedString(s.key)
}

func (s *Service) Verify(raw string) (User, error) {
	var c claims
	_, err := jwt.ParseWithClaims(raw, &c, func(*jwt.Token) (any, error) { return &s.key.PublicKey, nil },
		jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(s.issuer), jwt.WithAudience(Audience), jwt.WithExpirationRequired())
	if err != nil {
		return User{}, err
	}
	if c.Subject == "" {
		return User{}, errors.New("token has no subject")
	}
	return s.withRole(User{ID: c.Subject, Name: c.Name, Guest: c.Guest}), nil
}

func adminSet(names []string) map[string]bool {
	set := map[string]bool{}
	for _, name := range names {
		if name = strings.ToLower(strings.TrimSpace(name)); name != "" {
			set[name] = true
		}
	}
	return set
}

// withRole marks an administrator: a name in ADMIN_USERS, or an account given
// admin access from the dashboard. It is decided on every request rather than
// stored in the token, so taking admin access away works at once. Only
// accounts qualify: a guest can call themselves anything.
func (s *Service) withRole(u User) User {
	if u.Guest {
		u.Admin = false
		return u
	}
	a, ok := s.store.Find(u.Name)
	u.Admin = s.admins[strings.ToLower(u.Name)] || (ok && a.ID == u.ID && a.Admin)
	return u
}

// FromRequest reads the caller's token from the Authorization header, or from
// the "token" query parameter (browsers cannot set headers on a websocket).
func (s *Service) FromRequest(r *http.Request) (User, string, error) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw == "" {
		raw = r.URL.Query().Get("token")
	}
	if raw == "" {
		return User{}, "", errors.New("sign in first")
	}
	u, err := s.Verify(raw)
	return u, raw, err
}

// --- HTTP ------------------------------------------------------------------

var namePattern = regexp.MustCompile(`^[\p{L}\p{N} _.-]{2,20}$`)

func cleanName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if !namePattern.MatchString(name) {
		return "", errors.New("a name is 2 to 20 letters, digits, spaces, dots, dashes or underscores")
	}
	return name, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

type credentials struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (s *Service) respondWithToken(w http.ResponseWriter, u User) {
	token, err := s.Issue(u)
	if err != nil {
		fail(w, http.StatusInternalServerError, "could not issue a token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": s.withRole(u)})
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var c credentials
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil {
		fail(w, http.StatusBadRequest, "malformed request")
		return c, false
	}
	return c, true
}

// Register wires the account and discovery endpoints into a mux.
func (s *Service) Register(mux *http.ServeMux) {
	s.registerAdmin(mux)
	mux.HandleFunc("POST /api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		c, ok := readCredentials(w, r)
		if !ok {
			return
		}
		name, err := cleanName(c.Name)
		if err != nil {
			fail(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(c.Password) < 8 || len(c.Password) > 72 {
			fail(w, http.StatusBadRequest, "a password is 8 to 72 characters")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(c.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not create the account")
			return
		}
		a, err := s.store.Create(name, string(hash))
		if errors.Is(err, ErrNameTaken) {
			fail(w, http.StatusConflict, err.Error())
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not create the account")
			return
		}
		s.respondWithToken(w, User{ID: a.ID, Name: a.Name})
	})

	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		c, ok := readCredentials(w, r)
		if !ok {
			return
		}
		a, found := s.store.Find(strings.Join(strings.Fields(c.Name), " "))
		hash := []byte(a.Hash)
		if !found {
			hash = s.decoy
		}
		if bcrypt.CompareHashAndPassword(hash, []byte(c.Password)) != nil || !found {
			fail(w, http.StatusUnauthorized, "wrong name or password")
			return
		}
		s.respondWithToken(w, User{ID: a.ID, Name: a.Name})
	})

	// A guest gets a real identity without a password, good for as long as the
	// browser keeps the token.
	mux.HandleFunc("POST /api/auth/guest", func(w http.ResponseWriter, r *http.Request) {
		c, ok := readCredentials(w, r)
		if !ok {
			return
		}
		name, err := cleanName(c.Name)
		if err != nil {
			name = "Duelist"
		}
		s.respondWithToken(w, User{ID: "guest-" + newID(), Name: name, Guest: true})
	})

	mux.HandleFunc("GET /api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		u, _, err := s.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		// A fresh token with every check: someone who keeps playing is never
		// signed out by expiry, only someone away longer than a token lasts.
		token, err := s.Issue(u)
		if err != nil {
			fail(w, http.StatusInternalServerError, "could not issue a token")
			return
		}
		writeJSON(w, http.StatusOK, struct {
			User
			Token string `json:"token"`
		}{u, token})
	})

	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"issuer":                                s.issuer,
			"jwks_uri":                              s.issuer + "/.well-known/jwks.json",
			"id_token_signing_alg_values_supported": []string{"RS256"},
			"subject_types_supported":               []string{"public"},
			"response_types_supported":              []string{"token"},
		})
	})

	mux.HandleFunc("GET /.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		pub := s.key.PublicKey
		enc := base64.RawURLEncoding
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": s.kid,
			"n": enc.EncodeToString(pub.N.Bytes()),
			"e": enc.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
		}}})
	})
}
