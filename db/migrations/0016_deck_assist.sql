-- The deck assistant (package deckai): every message a player sent it, with
-- what it cost and how it went, for the administrators' overview.
--   steps: JSON list of the tools Claude used.
--   proposals: JSON list of the decks it proposed ({name, leaderNum, cards, summary, deckCost, fusions}).
--   refusals: deck checks and proposals the rules refused before it got one right.
--   error: why the request failed, '' when it answered.
CREATE TABLE deck_assist_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    user_name    TEXT NOT NULL DEFAULT '',
    session      TEXT NOT NULL,
    model        TEXT NOT NULL,
    message      TEXT NOT NULL,
    reply        TEXT NOT NULL DEFAULT '',
    steps        TEXT NOT NULL DEFAULT '[]',
    proposals    TEXT NOT NULL DEFAULT '[]',
    refusals     INTEGER NOT NULL DEFAULT 0,
    calls        INTEGER NOT NULL DEFAULT 0,
    input        INTEGER NOT NULL DEFAULT 0,
    output       INTEGER NOT NULL DEFAULT 0,
    cache_read   INTEGER NOT NULL DEFAULT 0,
    cache_write  INTEGER NOT NULL DEFAULT 0,
    cost_usd     REAL NOT NULL DEFAULT 0,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX deck_assist_log_time ON deck_assist_log (created_at);

-- The model players' conversations use (one row, id 1; none: the server default).
CREATE TABLE deck_assist_settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    player_model  TEXT NOT NULL
);
