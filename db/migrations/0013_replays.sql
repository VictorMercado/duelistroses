-- Recorded duels, to watch again later. `frames` is the gzipped JSON replay
-- (see package replay): every step of the duel as seen with nothing hidden,
-- with the action that caused it. It is a recording, not a re-simulation, so
-- it still plays back as it happened after the rules or cards change.
-- `players` is the JSON list of who sat where, for listing.
CREATE TABLE replays (
    id          TEXT PRIMARY KEY,
    room        TEXT NOT NULL,
    mode        TEXT NOT NULL,
    map         TEXT NOT NULL DEFAULT '',
    started_at  TEXT NOT NULL,
    ended_at    TEXT NOT NULL,
    finished    INTEGER NOT NULL,
    winner_team INTEGER NOT NULL,
    turns       INTEGER NOT NULL,
    steps       INTEGER NOT NULL,
    players     TEXT NOT NULL,
    frames      BLOB NOT NULL
);
CREATE INDEX replays_ended ON replays (ended_at);

-- Who played each recorded duel, to list one duelist's replays.
CREATE TABLE replay_players (
    replay_id TEXT NOT NULL REFERENCES replays (id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    PRIMARY KEY (replay_id, user_id)
);
CREATE INDEX replay_players_user ON replay_players (user_id);
