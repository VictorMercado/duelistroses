# Duelist City

A multiplayer tactical card duel on a grid: deck leaders, summoning stars,
terrain, battles, spells, traps and fusion, for 1v1 or 2v2, against people or
computer players (rule-based or an LLM).

| | What it owns | Where |
|---|---|---|
| **Game server** (Go) | Accounts and tokens, rooms, the rules, bots, the card catalog, decks and maps players build, and the asset files | this folder |
| **Game client** (React + three.js) | Rendering and input, plus the deck builder and map editor | `web/` |

## Run it

Two terminals:

```sh
# 1. game server on :8080 (serves the API, /assets and, once built, the client)
go run .

# 2. game client on :5173 (dev), proxied to the game server
cd web && pnpm install && pnpm dev
```

Card art, textures, sounds and fonts live in `content/assets/` (not committed)
and are served at `/assets`; `sh scripts/content/import_assets.sh` fills it.

Open http://localhost:5173, play as a guest, and pick "Duel a bot". The deck
builder and map editor are on the start menu.

To play against Claude, start the game server with Anthropic credentials
(`ANTHROPIC_API_KEY=...`, or `ant auth login`). `LLM_MODEL` picks the model
(default `claude-opus-5-5`; a smaller model answers faster). Without
credentials the LLM options are disabled and the rule-based bot still works.

### Game server settings (environment)

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `PUBLIC_URL` | `http://localhost:8080` | Written into tokens as the issuer |
| `DATA_DIR` | `./data` | Signing key and the SQLite database (`duelist.db`: accounts, friends, decks, maps, duel records and the card catalog). Keep it and back it up; never commit it |
| `DB_PATH` | `$DATA_DIR/duelist.db` | Where the database lives, if not in `DATA_DIR` |
| `ASSET_DIR` | `./content/assets` | Served at `/assets` |
| `STATIC_DIR` | `./web/dist` | The built client |
| `TURN_SECONDS` | `99` | Seconds per turn (fixed when the turn starts; actions do not reset it), 0 for none |
| `LLM_MODEL` | `claude-opus-5-5` | |
| `ADMIN_USERS` | none | Account names that are always administrators |
| `ADMIN_NAME` / `ADMIN_PASSWORD` | `admin` / `admin` | The administrator account created on first start (change the password from the dashboard) |
| `METRICS_ADDR` | `:9091` | Prometheus metrics (`/metrics`), apart from the public port; `off` disables. See [monitoring/README.md](monitoring/README.md) |

The client talks to its own origin; set `VITE_API_URL` at build time to point it at a game server elsewhere.

### Docker

`docker compose up -d --build` runs the game server with Prometheus, Grafana
and cAdvisor. Settings and secrets come from `.env` (copy `.env.example`;
`GRAFANA_ADMIN_PASSWORD` is required). Monitoring, alerts and client error
reports are described in [monitoring/README.md](monitoring/README.md).

## How a duel works

- Each duelist has a deck leader on the board, 4000 LP and a 40 card deck.
- You start with 4 summoning stars and gain 3 a turn, up to 12. A monster costs
  its level; spells and traps are free. One card may be played per turn, onto a
  square next to your leader, face down.
- Every card, and your leader, gets one order a turn: move, flip, or change
  battle position. Cards move one square, two when face up on terrain that
  favours them.
- Moving onto an enemy monster is a battle; onto the enemy leader is a direct
  attack for the monster's full ATK. Moving onto your own monster fuses the two
  when a recipe exists; moving a power-up onto a monster equips it.
- Spells activate when you flip them. Traps spring by themselves.
- At most 5 monsters and 5 spell/trap cards each. A duelist at 0 LP, or who
  cannot draw, is out; the last team standing wins.

## Friends and lobbies

Friends need an account (guests can still join by room name or link). Add a
friend by duelist name; once they accept, each sees when the other is online.

"Open a lobby" makes a private room that waits for its host. In it:

- take a seat to pick a team: seats alternate, so in 2v2 south and east are
  one team, north and west the other;
- the host switches between 1v1 and 2v2, fills empty seats with computer
  players, invites friends, and starts once every seat is filled.

## Spectating, chat and admins

The menu lists every public game. To watch one you choose a side: a player
(you see their team's face-down cards and that player's hand) or a team (the
cards, no hand). The other side's face-down cards stay mystery cards until
revealed. Spectators can move a cursor and read cards, but not act. A private
duel can only be watched by friends of a player on the side being watched.

Every room has chat. Players speak to the whole room. A spectator sees one
side's secrets, so what they say, and their cursor, is shown only to that side;
any player can also mute spectators for the room.

Accounts named in `ADMIN_USERS` (comma separated, on the game server) can watch
any duel, public or private, with nothing hidden: every card, every hand, and
the order of every deck. Register the account before naming it there. Guests
never qualify, whatever they call themselves.

On first start the server creates an administrator account (`admin` /
`admin` unless `ADMIN_NAME` and `ADMIN_PASSWORD` say otherwise): change its
password before the server is public. Administrators get a 🛡️ Admin button in
the menu, a dashboard for listing accounts, granting or removing admin access
and setting passwords. An administrator playing a duel gets the 🛠 Test tools:
any card into the hand or onto the field (at the board cursor, face down), the
rest of their deck in any order, and a refreshed turn. Everyone in the duel
sees in the log when the tools are used.

## Controls

| | Keyboard | Controller |
|---|---|---|
| Move cursor | WASD / arrows | D-pad / left stick |
| Pick up / confirm | K / Enter | A |
| Back | L / Esc | B |
| Hand | J | Y |
| Flip / activate / mark to fuse | O | X |
| Attack ↔ defense / discard | U | LT |
| Next / previous piece | Tab / [ | RB / LB |
| Terrain details | I | RT |
| End turn | E | Start |

Keys can be rebound in the settings panel. Any controller the browser's Gamepad
API reports works, including Bluetooth ones. Mouse and touch use the same
actions: click a square, or the buttons along the bottom.

## Code map

```
main.go            wiring and configuration
auth/              accounts, token issuing, OIDC discovery + JWKS
content/           card catalog (embedded from content/data), decks, maps, /assets
game/engine/       the rules: pure, deterministic, no I/O (start here)
game/              rooms (one goroutine each), connections, map generation
bot/               computer players: rule-based and LLM
api/               lobby, room creation, websocket upgrade
metrics/           Prometheus metrics: HTTP by route, room queues, websockets
reports/           client error reports (POST /api/client-errors) and their admin API
monitoring/        Prometheus config and alerts, Grafana dashboard
web/src/net/       protocol types, the room connection, error reporting (errorReport.ts)
web/src/input/     keyboard and gamepad, turned into one set of actions
web/src/game/      the interaction state machine, catalog lookups
web/src/components/ui/Builder.tsx  deck builder and map editor
scripts/content/   catalog generation (build_catalog.py) and asset import
```

Tests: `go test ./...` (rules, including random playouts, and bot-vs-bot games on the real card data).

Adding a card whose behaviour already exists is data only: give it an `effect`
in `scripts/content/build_catalog.py`, rerun it, and rebuild the server (the catalog is embedded). A new behaviour is one new `case` in
`game/engine/effects.go`.
