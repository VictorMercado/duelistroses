-- The card scout (package cardscout): cards found in the outside card
-- database, each with up to two ways Claude suggests it could work in this
-- game, waiting for an administrator to accept one (it is then saved to
-- `cards` as card `card_num`) or reject them.
--   status: pending, accepted, rejected, failed (Claude could not finish).
--   options: JSON list of {title, card, summary, newBehaviour, warnings}.
--   source: JSON of the card as found (text, stats, image links).
--   assets: '' (not yet), working, done, failed: the art, its WebP copies
--   and its holo mask, made after acceptance; assets_log says what ran.
CREATE TABLE card_suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   INTEGER NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    summon      TEXT NOT NULL,
    released    TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL,
    status      TEXT NOT NULL,
    options     TEXT NOT NULL DEFAULT '[]',
    note        TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT '',
    cost_usd    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    decided_at  TEXT NOT NULL DEFAULT '',
    decided_by  TEXT NOT NULL DEFAULT '',
    chosen      INTEGER,
    card_num    INTEGER,
    assets      TEXT NOT NULL DEFAULT '',
    assets_log  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX card_suggestions_status ON card_suggestions (status, id);

-- Whether the scout is running, kept across restarts (one row, id 1).
CREATE TABLE card_scout_state (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    running INTEGER NOT NULL DEFAULT 0
);
