package auth

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"duelistRoses/db"
)

// sqlStore keeps accounts in the accounts table.
type sqlStore struct{ db *sql.DB }

// newSQLStore opens the account store, importing the accounts.json file at
// legacy into an empty table.
func newSQLStore(database *sql.DB, legacy string) (*sqlStore, error) {
	s := &sqlStore{db: database}
	empty, err := db.Empty(database, "accounts")
	if err != nil || !empty {
		return s, err
	}
	return s, db.ImportLegacy(legacy, func(data []byte) error {
		var list []account
		if err := json.Unmarshal(data, &list); err != nil {
			return err
		}
		tx, err := database.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, a := range list {
			if err := insertAccount(tx, a); err != nil {
				return err
			}
		}
		return tx.Commit()
	})
}

func insertAccount(x interface {
	Exec(string, ...any) (sql.Result, error)
}, a account) error {
	_, err := x.Exec(`INSERT INTO accounts (id, name, name_key, hash, admin, created) VALUES (?, ?, ?, ?, ?, ?)`,
		a.ID, a.Name, strings.ToLower(a.Name), a.Hash, db.Bool(a.Admin), db.Time(a.Created))
	return err
}

const accountColumns = `id, name, hash, admin, created`

func scanAccount(row interface{ Scan(...any) error }) (account, error) {
	var a account
	var created string
	err := row.Scan(&a.ID, &a.Name, &a.Hash, &a.Admin, &created)
	a.Created = db.ParseTime(created)
	return a, err
}

func (s *sqlStore) Create(name, hash string) (account, error) {
	a := account{ID: newID(), Name: name, Hash: hash, Created: time.Now().UTC()}
	if err := insertAccount(s.db, a); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return account{}, ErrNameTaken
		}
		return account{}, err
	}
	return a, nil
}

func (s *sqlStore) Find(name string) (account, bool) {
	a, err := scanAccount(s.db.QueryRow(`SELECT `+accountColumns+` FROM accounts WHERE name_key = ?`, strings.ToLower(name)))
	return a, err == nil
}

func (s *sqlStore) Get(id string) (account, bool) {
	a, err := scanAccount(s.db.QueryRow(`SELECT `+accountColumns+` FROM accounts WHERE id = ?`, id))
	return a, err == nil
}

func (s *sqlStore) List() []account {
	rows, err := s.db.Query(`SELECT ` + accountColumns + ` FROM accounts ORDER BY name_key`)
	if err != nil {
		return []account{}
	}
	defer rows.Close()
	list := []account{}
	for rows.Next() {
		if a, err := scanAccount(rows); err == nil {
			list = append(list, a)
		}
	}
	return list
}

func (s *sqlStore) Update(id string, change func(*account)) (account, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return account{}, err
	}
	defer tx.Rollback()
	a, err := scanAccount(tx.QueryRow(`SELECT `+accountColumns+` FROM accounts WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return account{}, ErrNoAccount
	}
	if err != nil {
		return account{}, err
	}
	before := a
	change(&a)
	a.ID, a.Name = before.ID, before.Name // never renamed here
	if _, err := tx.Exec(`UPDATE accounts SET hash = ?, admin = ?, created = ? WHERE id = ?`, a.Hash, db.Bool(a.Admin), db.Time(a.Created), a.ID); err != nil {
		return account{}, err
	}
	return a, tx.Commit()
}
