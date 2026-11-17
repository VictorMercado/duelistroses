package auth

import (
	"database/sql"
	"encoding/json"
	"errors"

	"duelistRoses/db"
)

// Person is another duelist as shown in a friends list.
type Person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Friends is who knows whom. Friendship is between accounts, since only an
// account has a name that is unique and lasts. It lives in the friend_links
// table: a friendship is a 'friend' row each way, a request one 'request' row
// from the asker.
type Friends struct{ db *sql.DB }

var (
	ErrSelfFriend  = errors.New("you cannot add yourself")
	ErrGuestFriend = errors.New("create an account to use the friends list")
	ErrNoRequest   = errors.New("there is no request from that duelist")
)

// friendRecord is one user in the friends.json file kept before the database.
type friendRecord struct {
	Friends  []string `json:"friends,omitempty"`
	Outgoing []string `json:"outgoing,omitempty"`
}

func newFriends(database *sql.DB, legacy string) (*Friends, error) {
	f := &Friends{db: database}
	empty, err := db.Empty(database, "friend_links")
	if err != nil || !empty {
		return f, err
	}
	return f, db.ImportLegacy(legacy, func(data []byte) error {
		var users map[string]*friendRecord
		if err := json.Unmarshal(data, &users); err != nil {
			return err
		}
		tx, err := database.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for id, r := range users {
			// Each side lists the other, so each row is written once from each
			// side; OR IGNORE makes the second a no-op.
			for _, other := range r.Friends {
				if _, err := tx.Exec(`INSERT OR IGNORE INTO friend_links (from_id, to_id, kind) VALUES (?, ?, 'friend')`, id, other); err != nil {
					return err
				}
			}
			for _, other := range r.Outgoing {
				if _, err := tx.Exec(`INSERT OR IGNORE INTO friend_links (from_id, to_id, kind) VALUES (?, ?, 'request')`, id, other); err != nil {
					return err
				}
			}
		}
		return tx.Commit()
	})
}

func linkKind(q interface {
	QueryRow(string, ...any) *sql.Row
}, from, to string) string {
	var kind string
	q.QueryRow(`SELECT kind FROM friend_links WHERE from_id = ? AND to_id = ?`, from, to).Scan(&kind)
	return kind
}

// befriend makes two users friends, replacing any request between them.
func befriend(tx *sql.Tx, a, b string) error {
	for _, pair := range [][2]string{{a, b}, {b, a}} {
		if _, err := tx.Exec(`INSERT INTO friend_links (from_id, to_id, kind) VALUES (?, ?, 'friend')
			ON CONFLICT (from_id, to_id) DO UPDATE SET kind = 'friend'`, pair[0], pair[1]); err != nil {
			return err
		}
	}
	return nil
}

// Request asks to become friends. If the other duelist had already asked, the
// two become friends at once; it reports whether that happened.
func (f *Friends) Request(from, to User) (bool, error) {
	if from.Guest || to.Guest {
		return false, ErrGuestFriend
	}
	if from.ID == to.ID {
		return false, ErrSelfFriend
	}
	tx, err := f.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	switch linkKind(tx, from.ID, to.ID) {
	case "friend":
		return true, nil
	case "request":
		return false, nil // already asked
	}
	if linkKind(tx, to.ID, from.ID) == "request" {
		if err := befriend(tx, from.ID, to.ID); err != nil {
			return false, err
		}
		return true, tx.Commit()
	}
	if _, err := tx.Exec(`INSERT INTO friend_links (from_id, to_id, kind) VALUES (?, ?, 'request')`, from.ID, to.ID); err != nil {
		return false, err
	}
	return false, tx.Commit()
}

// Accept answers yes to a request that other sent.
func (f *Friends) Accept(u User, other string) error {
	tx, err := f.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if linkKind(tx, other, u.ID) != "request" {
		return ErrNoRequest
	}
	if err := befriend(tx, u.ID, other); err != nil {
		return err
	}
	return tx.Commit()
}

// Remove ends whatever there is between two users: a friendship, or a request
// in either direction (declining and cancelling are the same thing).
func (f *Friends) Remove(u User, other string) error {
	_, err := f.db.Exec(`DELETE FROM friend_links WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`, u.ID, other, other, u.ID)
	return err
}

func (f *Friends) AreFriends(a, b string) bool {
	return linkKind(f.db, a, b) == "friend"
}

// people lists the accounts named by a query that returns ids, by name.
func (f *Friends) people(query string, args ...any) []Person {
	out := []Person{}
	rows, err := f.db.Query(`SELECT a.id, a.name FROM accounts a WHERE a.id IN (`+query+`) ORDER BY a.name`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var p Person
		if rows.Scan(&p.ID, &p.Name) == nil {
			out = append(out, p)
		}
	}
	return out
}

// Of lists a user's friends and the requests waiting in each direction.
func (f *Friends) Of(u User) (friends, incoming, outgoing []Person) {
	friends = f.people(`SELECT to_id FROM friend_links WHERE from_id = ? AND kind = 'friend'`, u.ID)
	incoming = f.people(`SELECT from_id FROM friend_links WHERE to_id = ? AND kind = 'request'`, u.ID)
	outgoing = f.people(`SELECT to_id FROM friend_links WHERE from_id = ? AND kind = 'request'`, u.ID)
	return friends, incoming, outgoing
}
