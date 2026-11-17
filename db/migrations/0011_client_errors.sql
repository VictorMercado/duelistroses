-- Error reports sent by game clients (POST /api/client-errors), for
-- troubleshooting. `report` is the whole JSON the client sent; the other
-- columns are copied out of it so reports can be listed and grouped.
-- `fingerprint` groups reports of the same bug: kind, message and the top
-- frame of the stack.
CREATE TABLE client_errors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    kind        TEXT NOT NULL,
    message     TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    user_id     TEXT NOT NULL DEFAULT '',
    user_name   TEXT NOT NULL DEFAULT '',
    room_id     TEXT NOT NULL DEFAULT '',
    build       TEXT NOT NULL DEFAULT '',
    report      TEXT NOT NULL
);
CREATE INDEX client_errors_received ON client_errors (received_at);
CREATE INDEX client_errors_fingerprint ON client_errors (fingerprint, received_at);
