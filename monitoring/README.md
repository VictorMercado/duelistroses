# Monitoring

`docker compose up -d` starts, beside the game server:

| Service | Address | What it is |
|---|---|---|
| Prometheus | http://localhost:9090 (server-local only) | Scrapes the game server (`app:9091`) and cAdvisor every 15 s, keeps 30 days (`PROMETHEUS_RETENTION`) and evaluates the alerts in `prometheus/alerts.yml` |
| Grafana | The admin portal's **Monitoring** tab; also http://localhost:3000/grafana/ | The **Duelist server** dashboard is the home page. In the portal there is no login (the game server proxies it to administrators, see `api/grafana.go`); directly, sign in as `admin` / `GRAFANA_ADMIN_PASSWORD` |
| cAdvisor | (internal) | Each container's CPU, memory and real network traffic |

Prometheus and Grafana listen on 127.0.0.1 only. From your machine:

```sh
ssh -L 3000:localhost:3000 -L 9090:localhost:9090 you@your-server
```

The game server's `/metrics` is on `METRICS_ADDR` (`:9091`), never on the
public port, and compose does not publish it. Running `go run .` locally, it is
at http://localhost:9091/metrics.

## Is the server choking?

Look at these, roughly in order:

1. **Room queue wait** (`duelist_room_queue_wait_seconds`): how long an
   action, bot move or timer waits before its room runs it. Each room handles
   its work one item at a time, so this rises first when the server falls
   behind. A p95 above about 100 ms is lag players can feel. The
   `RoomsFallingBehind` alert fires on it.
2. **Room task duration** (`duelist_room_task_seconds`): one slow kind of work
   (a big board's state broadcast, a rule-based bot thinking) holding a room up.
3. **CPU used**: the process's CPU against the cores Go may use (GOMAXPROCS).
   It stays high when the server needs more CPU or a bigger machine.
4. **Slow clients dropped** (`duelist_ws_slow_client_drops_total`): a
   connection whose 64-message send queue filled up. A few from bad phone
   connections are normal. Many at once means the server cannot write fast
   enough.
5. Memory, goroutines and GC pauses: goroutines should follow connections.
   If they keep growing with nobody connected, something is leaking.

## Should assets move to Google Cloud Storage / a CDN?

The **Asset delivery** row answers it:

- **Assets' share of egress**: the share of every byte sent that was asset
  files, over the dashboard's time range. Game traffic (websocket state and the
  API) is small. If assets are most of the bandwidth you pay for, a bucket
  behind Cloud CDN takes it off this server. The `AssetBandwidthHigh` alert
  fires when assets are over 80% of the server's outgoing bytes for an hour
  (and over 1 MB/s).
- **Asset bytes/s by folder**: which folder (`cards`, `textures`, `audio`...)
  costs the most bandwidth.
- **Asset cache hits (304)**: assets are cached for 30 days, so returning
  players should mostly get 304s. Mostly 200s means mostly new players (or
  caches being cleared).
- **Asset serving time / CPU time**: the CPU cost. Files go out through
  `sendfile`, so serving them takes very little CPU. This number is an upper
  bound, because most of that time is spent waiting on the network. If CPU is
  high while this stays low, assets are not the cause.
- **Requests in flight**: slow phones hold asset downloads open. Hundreds
  here mean many open connections, not CPU load.
- **Container network (cAdvisor)**: what really left the container, including
  TLS and headers, against what the app counted.

App-counted bytes are payload before TLS. If a proxy in front compresses
responses, the bytes on the wire are fewer.

## Client error reports

The game client sends a report to `POST /api/client-errors` when something
goes wrong for a player. It does this for:

- uncaught exceptions and rejected promises
- React render errors (with the component stack)
- textures or sounds that fail to load
- WebGL context loss
- 5xx answers from the API
- giving up on reconnecting to a room

`reportProblem(note)` in `web/src/net/errorReport.ts` sends a player's own
report, ready to put behind a "Report a problem" button.

Reports are stored in SQLite (`client_errors`, newest 10,000 kept), logged to
the server log with the sender's IP, and counted in `duelist_client_errors_total`. Reading them
takes an administrator's token:

```sh
TOKEN=$(curl -s https://your-host/api/auth/login -d '{"name":"admin","password":"..."}' | jq -r .token)

# Each bug once, most reported first (last 7 days; ?days=30 for more)
curl -s -H "Authorization: Bearer $TOKEN" https://your-host/api/admin/client-errors/groups | jq

# Newest reports (?fingerprint=<one bug>&limit=50&before=<id> to page)
curl -s -H "Authorization: Bearer $TOKEN" https://your-host/api/admin/client-errors | jq

# One report, with everything the client sent
curl -s -H "Authorization: Bearer $TOKEN" https://your-host/api/admin/client-errors/42 | jq

# Clear them (or one bug's: ?fingerprint=...)
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" https://your-host/api/admin/client-errors
```

The **fingerprint** groups reports of one bug. It is built from the kind, the
message and the top stack frame, leaving out numbers and bundle hashes, so the
same bug in a newer build lands in the same group.

### Client IPs in Grafana

Each report keeps the player's IP. With players → Cloudflare → Traefik →
the server, it is read from `X-Forwarded-For` (skipping proxy hops), or from
Cloudflare's `CF-Connecting-IP` when the chain ends at Cloudflare. Those
headers are believed only from proxies in `TRUSTED_PROXIES` (default
`private,cloudflare`: the LAN and Cloudflare's published ranges), so a player
cannot fake them. The **Client errors** row shows:

- **Client errors by IP**: each address in the time range, its report and bug
  counts, the players signed in from it, and its last error. Click an IP to
  fill the **Client IP** variable at the top.
- **Recent client errors**: the newest 500 reports with time, IP, player,
  kind, message, room and build; only one address when **Client IP** is set.

Grafana reads them with the Infinity datasource (installed when the container
starts, so it needs internet the first time) from
`http://app:9091/internal/client-errors` and `/internal/client-errors/ips`.
Those are on the metrics port, which is not published, so they need no token.
IPs are not Prometheus labels (one series per address would grow without end).

### What a report holds

The full type is `ErrorReport` in `web/src/net/errorReport.ts`. In short:

| Field | What it tells you |
|---|---|
| `kind`, `message`, `stack`, `componentStack`, `source` | What broke and where |
| `build` | `version` + git `commit` of the client bundle (set `BUILD_SHA` when building the image) |
| `page` | Path, menu screen, tab visible, online, seconds since load, installed as an app |
| `device` | User agent, platform, touch, cores, memory, screen and viewport, GPU, network type/RTT, low-power mode |
| `user` | Who the client thought was signed in (the server records the real sender from the token) |
| `connection` | Websocket status and last measured latency |
| `game` | When in a room: the room (mode, map, seats), our seat, spectator/admin/sandbox, a **summary** (phase, whose turn, turn clock, every seat's LP/stars/hand and deck counts, the pending choice, our hand, how many legal moves), the **whole game state** as the server last sent it, the last update's events, the last log lines, and the player's input state (input mode, cursor square, hand card picked) |
| `breadcrumbs` | The last 50 things that happened, oldest first: screen changes, connection status and close codes, each action sent (with its id and target), refusals from the server, failed API calls, asset failures, turns passing, tab hidden/shown |

The server keeps the report as sent (at most 64 KiB). If a report would be
bigger, the client drops the legal-move list first, then the full state
(keeping the summary), then older breadcrumbs.

Reports carry no token or password. Chat lines are left out of the log. If a
report cannot be sent (offline, server down), up to five wait in the browser's
storage and go out when it is back online. Each address may send 20 reports a
minute, and the server takes 600 a minute in total.
