// Package reports takes in the error reports game clients send when
// something goes wrong for a player, and lets administrators read them.
//
// A report is JSON (see web/src/net/errorReport.ts for the full shape). The
// server reads a few fields to list and group reports and keeps the rest as
// sent: what the client was doing (breadcrumbs), its connection, and the
// state of the duel when the error happened.
package reports

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"duelistRoses/auth"
	"duelistRoses/db"
	"duelistRoses/metrics"
)

const (
	// MaxBody is the largest report accepted. Browsers send keepalive
	// requests (used so a report survives the page closing) up to 64 KiB.
	MaxBody = 64 << 10
	// keep is how many reports are kept; older ones are deleted.
	keep = 10000
)

// Kinds are the kinds of report a client may send.
var Kinds = map[string]bool{
	"exception":          true, // window.onerror
	"unhandledrejection": true, // a promise nobody caught
	"react":              true, // a component threw while rendering
	"websocket":          true, // the game connection was lost for good
	"api":                true, // the server answered a request with 5xx
	"asset":              true, // a texture, model or sound failed to load
	"webgl":              true, // the WebGL context was lost
	"manual":             true, // the player pressed "report a problem"
}

// Report is the part of a report the server reads. Everything else is kept
// as the client sent it.
type Report struct {
	V       int    `json:"v"`
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Stack   string `json:"stack"`
	Build   struct {
		Version string `json:"version"`
		Commit  string `json:"commit"`
	} `json:"build"`
	Game *struct {
		RoomID string `json:"roomId"`
	} `json:"game"`
}

// Summary is one report in a list.
type Summary struct {
	ID          int64     `json:"id"`
	ReceivedAt  time.Time `json:"receivedAt"`
	Kind        string    `json:"kind"`
	Message     string    `json:"message"`
	Fingerprint string    `json:"fingerprint"`
	UserID      string    `json:"userId,omitempty"`
	UserName    string    `json:"userName,omitempty"`
	RoomID      string    `json:"roomId,omitempty"`
	Build       string    `json:"build,omitempty"`
	IP          string    `json:"ip,omitempty"`
}

// Group is every report of one bug.
type Group struct {
	Fingerprint string    `json:"fingerprint"`
	Kind        string    `json:"kind"`
	Message     string    `json:"message"`
	Count       int       `json:"count"`
	Users       int       `json:"users"`
	FirstSeen   time.Time `json:"firstSeen"`
	LastSeen    time.Time `json:"lastSeen"`
	LatestID    int64     `json:"latestId"`
}

type Store struct {
	db   *sql.DB
	auth *auth.Service

	mu      sync.Mutex
	buckets map[string]*bucket
	global  bucket
	inserts int
}

func New(database *sql.DB, accounts *auth.Service) *Store {
	return &Store{db: database, auth: accounts, buckets: map[string]*bucket{}}
}

func (s *Store) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/client-errors", s.receive)

	mux.HandleFunc("GET /api/admin/client-errors", s.admin(func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
		list, err := s.List(limit, before, r.URL.Query().Get("fingerprint"))
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("GET /api/admin/client-errors/groups", s.admin(func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		groups, err := s.Groups(days)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, groups)
	}))
	mux.HandleFunc("GET /api/admin/client-errors/{id}", s.admin(func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		var raw string
		var sum Summary
		var at string
		err := s.db.QueryRow(`SELECT id, received_at, kind, message, fingerprint, user_id, user_name, room_id, build, ip, report FROM client_errors WHERE id = ?`, id).
			Scan(&sum.ID, &at, &sum.Kind, &sum.Message, &sum.Fingerprint, &sum.UserID, &sum.UserName, &sum.RoomID, &sum.Build, &sum.IP, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, http.StatusNotFound, "no such report")
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		sum.ReceivedAt = db.ParseTime(at)
		writeJSON(w, http.StatusOK, map[string]any{"summary": sum, "report": json.RawMessage(raw)})
	}))
	// Deletes every report, or one bug's with ?fingerprint=.
	mux.HandleFunc("DELETE /api/admin/client-errors", s.admin(func(w http.ResponseWriter, r *http.Request) {
		fp := r.URL.Query().Get("fingerprint")
		var err error
		if fp != "" {
			_, err = s.db.Exec(`DELETE FROM client_errors WHERE fingerprint = ?`, fp)
		} else {
			_, err = s.db.Exec(`DELETE FROM client_errors`)
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

func (s *Store) receive(w http.ResponseWriter, r *http.Request) {
	ip := ClientIP(r)
	if !s.allow(ip) {
		fail(w, http.StatusTooManyRequests, "too many reports")
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxBody)
	var raw json.RawMessage
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		fail(w, http.StatusBadRequest, "a report is a JSON object of at most 64 KiB")
		return
	}
	var rep Report
	if err := json.Unmarshal(raw, &rep); err != nil {
		fail(w, http.StatusBadRequest, "malformed report")
		return
	}
	if !Kinds[rep.Kind] {
		fail(w, http.StatusBadRequest, "unknown kind")
		return
	}
	rep.Message = clip(strings.TrimSpace(rep.Message), 1000)
	if rep.Message == "" {
		fail(w, http.StatusBadRequest, "a report needs a message")
		return
	}
	if rep.ID == "" || len(rep.ID) > 64 {
		rep.ID = strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	// Who sent it comes from their token, never from the report.
	var user auth.User
	if u, _, err := s.auth.FromRequest(r); err == nil {
		user = u
	}
	room := ""
	if rep.Game != nil {
		room = clip(rep.Game.RoomID, 64)
	}
	build := clip(strings.Trim(rep.Build.Version+" "+rep.Build.Commit, " "), 64)
	fp := Fingerprint(rep.Kind, rep.Message, rep.Stack)

	_, err := s.db.Exec(`INSERT OR IGNORE INTO client_errors (report_id, received_at, kind, message, fingerprint, user_id, user_name, room_id, build, ip, report) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rep.ID, db.Time(time.Now()), rep.Kind, rep.Message, fp, user.ID, user.Name, room, build, ip, string(raw))
	if err != nil {
		log.Printf("client error report: %v", err)
		fail(w, http.StatusInternalServerError, "could not save the report")
		return
	}
	metrics.ClientError(rep.Kind)
	who := user.Name
	if who == "" {
		who = "signed out"
	}
	log.Printf("client error [%s] %s from %s (%s, fingerprint %s): %s", rep.Kind, who, ip, build, fp, clip(rep.Message, 200))
	s.prune()
	w.WriteHeader(http.StatusNoContent)
}

// prune keeps the newest reports, checking every 100 inserts.
func (s *Store) prune() {
	s.mu.Lock()
	s.inserts++
	due := s.inserts%100 == 0
	s.mu.Unlock()
	if due {
		s.db.Exec(`DELETE FROM client_errors WHERE id <= (SELECT id FROM client_errors ORDER BY id DESC LIMIT 1 OFFSET ?)`, keep)
	}
}

// List is the newest reports, optionally of one bug, older than before (an id; 0 for the newest).
func (s *Store) List(limit int, before int64, fingerprint string) ([]Summary, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	if before <= 0 {
		before = 1 << 62
	}
	rows, err := s.db.Query(`SELECT id, received_at, kind, message, fingerprint, user_id, user_name, room_id, build, ip FROM client_errors
		WHERE id < ? AND (? = '' OR fingerprint = ?) ORDER BY id DESC LIMIT ?`, before, fingerprint, fingerprint, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Summary{}
	for rows.Next() {
		var sum Summary
		var at string
		if err := rows.Scan(&sum.ID, &at, &sum.Kind, &sum.Message, &sum.Fingerprint, &sum.UserID, &sum.UserName, &sum.RoomID, &sum.Build, &sum.IP); err != nil {
			return nil, err
		}
		sum.ReceivedAt = db.ParseTime(at)
		list = append(list, sum)
	}
	return list, rows.Err()
}

// Groups is every bug reported in the last days (7 by default), most reported first.
func (s *Store) Groups(days int) ([]Group, error) {
	if days <= 0 {
		days = 7
	}
	since := db.Time(time.Now().AddDate(0, 0, -days))
	rows, err := s.db.Query(`SELECT fingerprint, kind, message, COUNT(*), COUNT(DISTINCT NULLIF(user_id, '')), MIN(received_at), MAX(received_at), MAX(id)
		FROM client_errors WHERE received_at >= ? GROUP BY fingerprint ORDER BY COUNT(*) DESC LIMIT 200`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var g Group
		var first, last string
		if err := rows.Scan(&g.Fingerprint, &g.Kind, &g.Message, &g.Count, &g.Users, &first, &last, &g.LatestID); err != nil {
			return nil, err
		}
		g.FirstSeen, g.LastSeen = db.ParseTime(first), db.ParseTime(last)
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

var (
	numbers = regexp.MustCompile(`\d+`)
	// A bundle file's content hash changes every build; the bug does not.
	bundleHash = regexp.MustCompile(`-[A-Za-z0-9_-]{8}\.js`)
)

// Fingerprint names a bug: the same kind, message and top stack frame, with
// numbers (ids, line and column numbers) and bundle hashes left out.
func Fingerprint(kind, message, stack string) string {
	top := ""
	for _, line := range strings.Split(stack, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "at ") || strings.Contains(line, "@") {
			top = line
			break
		}
	}
	norm := func(s string) string { return numbers.ReplaceAllString(bundleHash.ReplaceAllString(s, ".js"), "#") }
	sum := sha1.Sum([]byte(kind + "\x00" + norm(message) + "\x00" + norm(top)))
	return hex.EncodeToString(sum[:6])
}

// --- rate limiting -----------------------------------------------------------

// A bucket allows a burst of reports, then refills at a steady rate.
type bucket struct {
	tokens float64
	last   time.Time
}

func (b *bucket) take(now time.Time, perMinute, burst float64) bool {
	if b.last.IsZero() {
		b.tokens = burst
	} else {
		b.tokens = min(burst, b.tokens+now.Sub(b.last).Minutes()*perMinute)
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// allow limits each address to 20 reports a minute (bursts of 10), and the
// server to 600 a minute, so a broken client cannot fill the database.
func (s *Store) allow(ip string) bool {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.buckets) > 10000 {
		for k, b := range s.buckets {
			if now.Sub(b.last) > 10*time.Minute {
				delete(s.buckets, k)
			}
		}
	}
	b := s.buckets[ip]
	if b == nil {
		b = &bucket{}
		s.buckets[ip] = b
	}
	return b.take(now, 20, 10) && s.global.take(now, 600, 100)
}

// --- helpers -----------------------------------------------------------------

func (s *Store) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, _, err := s.auth.FromRequest(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "sign in first")
			return
		}
		if !u.Admin {
			fail(w, http.StatusForbidden, "that is for administrators")
			return
		}
		next(w, r)
	}
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Cut on a rune boundary.
	for n > 0 && n < len(s) && s[n]&0xC0 == 0x80 {
		n--
	}
	return s[:n]
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// --- internal (Grafana) ------------------------------------------------------

// IPSummary is every report from one address.
type IPSummary struct {
	IP          string    `json:"ip"`
	Reports     int       `json:"reports"`
	Bugs        int       `json:"bugs"`
	Users       string    `json:"users"`
	FirstSeen   time.Time `json:"firstSeen"`
	LastSeen    time.Time `json:"lastSeen"`
	LastKind    string    `json:"lastKind"`
	LastMessage string    `json:"lastMessage"`
}

// RegisterInternal adds the endpoints Grafana reads to the metrics address
// (internal only: they need no token). Both take ?from=&to= in Unix
// milliseconds (Grafana's ${__from} and ${__to}), the last 24 hours by default.
//
//	GET /internal/client-errors        the newest reports (?limit=, 500 at most; &ip= for one address)
//	GET /internal/client-errors/ips    reports grouped by address, most first
func (s *Store) RegisterInternal(handle func(string, http.Handler)) {
	handle("GET /internal/client-errors", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		from, to := timeRange(r)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 || limit > 500 {
			limit = 500
		}
		ip := r.URL.Query().Get("ip")
		rows, err := s.db.Query(`SELECT id, received_at, kind, message, fingerprint, user_id, user_name, room_id, build, ip FROM client_errors
			WHERE received_at >= ? AND received_at <= ? AND (? = '' OR ip = ?) ORDER BY id DESC LIMIT ?`, from, to, ip, ip, limit)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		list := []Summary{}
		for rows.Next() {
			var sum Summary
			var at string
			if err := rows.Scan(&sum.ID, &at, &sum.Kind, &sum.Message, &sum.Fingerprint, &sum.UserID, &sum.UserName, &sum.RoomID, &sum.Build, &sum.IP); err != nil {
				fail(w, http.StatusInternalServerError, err.Error())
				return
			}
			sum.ReceivedAt = db.ParseTime(at)
			list = append(list, sum)
		}
		writeJSON(w, http.StatusOK, list)
	}))
	handle("GET /internal/client-errors/ips", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		from, to := timeRange(r)
		rows, err := s.db.Query(`SELECT c.ip, g.n, g.bugs, g.users, g.first, c.received_at, c.kind, c.message
			FROM (SELECT ip, COUNT(*) n, COUNT(DISTINCT fingerprint) bugs, COALESCE(GROUP_CONCAT(DISTINCT NULLIF(user_name, '')), '') users,
			             MIN(received_at) first, MAX(id) last
			      FROM client_errors WHERE received_at >= ? AND received_at <= ? GROUP BY ip) g
			JOIN client_errors c ON c.id = g.last
			ORDER BY g.n DESC LIMIT 500`, from, to)
		if err != nil {
			fail(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		list := []IPSummary{}
		for rows.Next() {
			var g IPSummary
			var first, last string
			if err := rows.Scan(&g.IP, &g.Reports, &g.Bugs, &g.Users, &first, &last, &g.LastKind, &g.LastMessage); err != nil {
				fail(w, http.StatusInternalServerError, err.Error())
				return
			}
			if g.IP == "" {
				g.IP = "(before IPs were kept)"
			}
			g.FirstSeen, g.LastSeen = db.ParseTime(first), db.ParseTime(last)
			list = append(list, g)
		}
		writeJSON(w, http.StatusOK, list)
	}))
}

// timeRange reads ?from= and ?to= (Unix milliseconds) as stored timestamps.
func timeRange(r *http.Request) (string, string) {
	to := time.Now()
	from := to.Add(-24 * time.Hour)
	if ms, err := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64); err == nil {
		from = time.UnixMilli(ms)
	}
	if ms, err := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64); err == nil {
		to = time.UnixMilli(ms)
	}
	return db.Time(from), db.Time(to)
}
