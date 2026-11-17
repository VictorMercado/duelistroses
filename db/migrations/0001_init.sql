-- Times are UTC RFC 3339 text (see db.Time); booleans are 0 or 1; lists and
-- nested records are JSON text.

CREATE TABLE accounts (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE, -- lower-cased name: names are unique ignoring case
  hash     TEXT NOT NULL,
  admin    INTEGER NOT NULL DEFAULT 0,
  created  TEXT NOT NULL DEFAULT ''
);

-- One row per direction: a friendship is two 'friend' rows, a request is one
-- 'request' row from the asker to the asked.
CREATE TABLE friend_links (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('request', 'friend')),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX friend_links_to ON friend_links (to_id);

-- Owners may be guests, who have no account row, so there is no foreign key.
CREATE TABLE decks (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  owner_name  TEXT NOT NULL,
  name        TEXT NOT NULL,
  leader_num  INTEGER NOT NULL,
  cards       TEXT NOT NULL,
  is_public   INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);
CREATE INDEX decks_owner ON decks (owner_id);

CREATE TABLE maps (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  tiles      TEXT NOT NULL,
  is_public  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX maps_owner ON maps (owner_id);

-- A duelist's whole record (see profile.Record) as JSON.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  record  TEXT NOT NULL
);

-- The card catalog. data is the card as the client and engine read it
-- (engine.CardDef plus client-only fields such as art paths).
CREATE TABLE cards (
  num        INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Every version a card has been saved as, newest last, so any edit (by a
-- person or an agent) can be reviewed and undone.
CREATE TABLE card_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  num        INTEGER NOT NULL,
  data       TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX card_revisions_num ON card_revisions (num, id);

-- Fusion recipes, tried in position order: the first match wins.
CREATE TABLE fusions (
  position INTEGER PRIMARY KEY,
  data     TEXT NOT NULL
);

CREATE TABLE starter_decks (
  id       TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  data     TEXT NOT NULL
);
