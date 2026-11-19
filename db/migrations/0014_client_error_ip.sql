-- The address each client error report came from (the player's, read through
-- trusted proxies' X-Forwarded-For), to tie an error to a client.
ALTER TABLE client_errors ADD COLUMN ip TEXT NOT NULL DEFAULT '';
CREATE INDEX client_errors_ip ON client_errors (ip, received_at);
