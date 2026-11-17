# Security to-do

Work deferred until Duelist City has real users. Written for an agent picking
this up later: each task says why, where, what to do, and how to know it is
done. Line numbers were right when this was written (2026-11-11); search for
the quoted code if they have drifted.

Do the tasks in order. **Task 2 must land in the same change as task 1**, or
moving the token into a cookie opens a hole that does not exist today.

## How auth works today

- The Go server (`auth/auth.go`) issues an RS256 JWT at sign-in, signed with
  `DATA_DIR/signing_key.pem`. Claims: user id, name, guest flag, issuer
  (`PUBLIC_URL`), audience, expiry: 7 days for accounts, 30 for guests.
- There is no session store. Verification is the signature, issuer and expiry
  only, so a token cannot be revoked before it expires.
- `GET /api/auth/me` returns the user plus a renewed token (`token` field), and
  the lobby (`web/src/components/ui/Lobby.tsx`, the effect guarded by `vouched`)
  stores it. Active players never hit the expiry.
- The client keeps the token in `localStorage` (zustand persist, key
  `duelist-session`, `web/src/stores/sessionStore.ts`). It sends it as
  `Authorization: Bearer` on HTTP (`web/src/net/api.ts`, `request()`) and as
  `?token=` in the websocket URL (`wsUrl()` in the same file).
- Accounts and bcrypt hashes are in `DATA_DIR/accounts.json`.
- In dev, Vite proxies `/api` and `/ws` to the Go server (`web/vite.config.ts`),
  so page and API share an origin. `VITE_API_URL` / `VITE_WS_URL` allow a client
  served from another origin, which is why CORS is `*` today.

## Why change it

- **Script in the page can read `localStorage`:** XSS, a compromised npm
  dependency, or a browser extension with access to the site. A stolen token
  works from anywhere for up to 7 days (30 for guests) and cannot be revoked.
- **The token is in the websocket URL.** URLs end up in server logs, proxy logs
  and browser history.
- **Sign out only forgets the token in the browser.** The token stays valid.

HttpOnly cookies stop page script from reading the token, so it cannot be
stolen and used elsewhere. They do not stop a malicious extension that has the
`cookies` permission, or one acting inside the page while it is open.
Short-lived tokens plus server-side revocation (task 4) limit what such an
extension can do.

---

## Task 1: move the token into an HttpOnly cookie

**Server (`auth/auth.go`):**
- `respondWithToken`: set a cookie instead of returning the token in the body.
  - Name: `duelist_session`.
  - Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - `Max-Age` equal to the token lifetime.
  - Keep returning `user` in the body.
- `GET /api/auth/me`: renew by re-setting the cookie, not by returning `token`.
- `FromRequest`: read the cookie first.
  - Keep the `Authorization: Bearer` header working only if something
    non-browser needs it (bots in `bot/` run in-process and do not).
  - Remove the `?token=` query parameter path.
- Add `POST /api/auth/logout`: clears the cookie (`Max-Age=0`). After task 4
  it also revokes the session.

**Client:**
- `web/src/stores/sessionStore.ts`: drop `token` from the persisted state. Keep
  `user` (the profile, for display), `deckId` and `mapId`.
  - "Signed in" becomes `user !== null`, confirmed by `/api/auth/me` on load.
  - Update every `token` reader: grep `useSessionStore` and `token` under
    `web/src` (Lobby, Builder, Friends, admin screens, `net/session.ts`).
- `web/src/net/api.ts`, `request()`: send `credentials: 'include'` (or
  `'same-origin'` if cross-origin is dropped, see below). Stop adding the
  Authorization header. `whoAmI` no longer returns a token.
  - Remove the `token` parameters threaded through the API helpers.
- `wsUrl()`: remove `token` from the query. The browser sends the cookie on the
  websocket handshake for same-site URLs.
- `Lobby.tsx`:
  - The "Sign out" button calls `POST /api/auth/logout`, then clears `user`.
  - Simplify the `vouched` renewal guard, since the token no longer lives in
    React state. The rule stays: sign out only on a 401, never on a network
    error.
- Users signed in before this change hold a token in `localStorage` and no
  cookie, so they are signed out once. That is acceptable; do not write a
  migration.

**Decide on cross-origin (`VITE_API_URL`):** cookies across sites need
`SameSite=None; Secure` plus credentialed CORS with an explicit origin.
- Preferred: drop cross-origin hosting. The Go server already serves `web/dist`
  in production (see `Dockerfile`), so serve client and API from one origin.
- If cross-origin must stay: make the allowed origins an env var (for example
  `ALLOWED_ORIGINS`) and echo back only a listed `Origin`, with
  `Access-Control-Allow-Credentials: true`.

**Done when:**
- `localStorage` holds no token after sign-in.
- The `/ws/...` URL has no `token` parameter.
- Reloading keeps you signed in.
- Sign out followed by a reload stays signed out.

## Task 2: check the websocket Origin (same change as task 1)

`api/api.go:38`: `CheckOrigin: func(*http.Request) bool { return true }`. The
comment says this is safe *because* auth is in the URL, not a cookie. With
cookies, any website the player visits could open an authenticated websocket
as them (cross-site websocket hijacking).

- Accept only an `Origin` that matches `PUBLIC_URL`, or the `ALLOWED_ORIGINS`
  list from task 1.
- In dev, allow `http://localhost:*` and the LAN address used for phone
  testing. Make this an env var, not hard-coded.
- Update the comment above the upgrader.

**Done when:** a Go test shows a websocket upgrade with
`Origin: https://evil.example` is refused (403), and one with the configured
origin succeeds.

## Task 3: protect cookie-authenticated HTTP routes from CSRF

`SameSite=Lax` blocks cross-site POST, PUT and DELETE from carrying the cookie
in modern browsers. Add a second layer anyway:

- Middleware for state-changing methods on `/api/`: require `Origin` (or
  `Referer` when `Origin` is missing) to match the allowed origins. Reject
  with 403 otherwise.
- `api/api.go:52`, `CORS()`: stop sending `Access-Control-Allow-Origin: *` for
  `/api/` routes that use the cookie.
  - Public read-only routes (`/api/config`, `/api/rooms`, the catalog,
    `/.well-known/`) may keep `*`.
  - Never combine `*` with `Allow-Credentials`.
- `content/service.go:340`: `/assets` may keep `*`. These are public files, and
  WebGL needs CORS for textures.

**Done when:** tests show
- a POST with a foreign `Origin` is refused;
- a POST from the allowed origin works;
- public GETs still answer cross-origin.

## Task 4: short sessions you can revoke

Goal: sign out everywhere, and end a user's sessions when their password
changes or an admin acts.

- Add a session store as a JSON file in `DATA_DIR`, next to `accounts.json`,
  in the same style as `newFileStore`. Each entry: session id, user id,
  created time, last-seen time, user agent.
- Two cookies:
  - **Access token:** a JWT carrying a `sid` claim, lifetime about 15 minutes.
    Verified without a lookup, as today.
  - **Refresh cookie:** `duelist_refresh`, opaque random id,
    `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`, lifetime 30 days.
- `/api/auth/me` (or a new `POST /api/auth/refresh`): when the access token is
  expired or close to it, check the refresh id against the store, rotate it,
  and set new cookies. A refresh id used a second time means it was stolen:
  revoke that whole session.
- Logout deletes the session.
- Changing a password (`setAccountPassword`, admin route) and an admin's
  "sign out user" action delete all that user's sessions.
- Long websocket connections: on reconnect the handshake re-checks the cookie,
  so a revoked session is cut off at its next reconnect. Optionally, also
  close live sockets for a revoked `sid` (the hub knows each client's user).

**Done when:** tests cover refresh rotation, reuse detection, logout, and
"password change ends other sessions".

## Task 5: other hardening found along the way

- **Default admin password.** `main.go` creates `admin` / `admin` when
  `ADMIN_PASSWORD` is unset, and only logs a warning. Before going public,
  refuse to start in production (for example, when `PUBLIC_URL` is not
  localhost) unless `ADMIN_PASSWORD` is set, or generate a random password and
  print it once.
- **No rate limiting on sign-in.** `POST /api/auth/login`, `/register` and
  `/guest` accept unlimited attempts. bcrypt slows guessing but does not stop
  it. Add a per-IP and per-account limit, for example 10 per minute, with
  backoff. Guest creation also needs a per-IP limit so nobody can mass-create
  identities.
- **Security headers** on the page responses served from `web/dist`:
  - `Content-Security-Policy` (scripts from self only; Google Fonts if used;
    `connect-src` for the API and websocket);
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: same-origin`;
  - `frame-ancestors 'none'`.
  The CSP is what actually limits XSS, which is the main way into either
  storage choice.
- **Signing key and data volume.** `docker-compose.yml` mounts the named
  volume `duelist-data` at `/srv/data`. Confirm production does too. A lost
  key signs everyone out, and a lost `accounts.json` deletes accounts. Back the
  volume up.
- **`PUBLIC_URL` must be fixed in production.** It is the token issuer, and
  changing it invalidates every session.

## Out of scope / already fine

- Passwords are bcrypt with an 8–72 character limit (`auth/auth.go:368`), and
  unknown names are compared against a decoy hash, so failed sign-ins take the
  same time whether or not the account exists.
- Request bodies for credentials are capped at 4 KB.
- Admin status is checked on each request (`withRole`), not frozen into the
  token, so granting or removing admin applies immediately.
