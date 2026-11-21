#!/usr/bin/env bash
# Restart the local dev environment: the Go server (go run .) and the Vite dev
# server (pnpm dev in web/). Safe to run repeatedly; agents use it to refresh.
#
#   ./dev.sh           stop anything running, start both, wait until they answer
#   ./dev.sh stop      stop both
#   ./dev.sh status    show what is running
#   ./dev.sh logs      tail both logs (Ctrl-C to quit)
#
# It also starts Prometheus (localhost:9090) and Grafana (localhost:3000/grafana/) in
# Docker, scraping the local Go server's :9091 (see docker-compose.dev.yml).
# Set NO_MONITORING=1 to skip them; `./dev.sh stop` stops them too.
#
# Environment variables come from .env (see .env.example). Both servers run in
# the background; their output goes to .dev/go.log and .dev/web.log.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.dev"
mkdir -p "$RUN_DIR"

# Load .env so the Go server (and Vite) see ANTHROPIC_API_KEY etc.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
else
  echo "warning: no .env found (copy .env.example to .env)" >&2
fi

GO_PORT="${PORT:-8080}"
WEB_PORT="${WEB_PORT:-5173}"

# Kill a process group recorded in a pid file, then anything still holding the port.
stop_one() {
  local name="$1" port="$2" pidfile="$RUN_DIR/$1.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      # Negative pid = the whole group: go run's compiled child, pnpm's vite child.
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
  # Fallback for servers started some other way (a terminal, an earlier agent).
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill -TERM $pids 2>/dev/null || true
  fi
  # Give them a moment, then force.
  for _ in {1..20}; do
    lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1 || { echo "stopped $name"; return 0; }
    sleep 0.25
  done
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null || true
  echo "stopped $name (forced)"
}

COMPOSE=(docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.dev.yml")

# Make sure the Docker daemon answers, launching Docker Desktop if needed.
ensure_docker() {
  command -v docker >/dev/null 2>&1 || { echo "warning: docker not installed; skipping monitoring" >&2; return 1; }
  docker info >/dev/null 2>&1 && return 0
  if [[ "$(uname)" == Darwin ]]; then
    echo "starting Docker Desktop..."
    open -a Docker || true
  fi
  for _ in {1..90}; do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "warning: Docker daemon not reachable; skipping monitoring" >&2
  return 1
}

start_monitoring() {
  [[ -n "${NO_MONITORING:-}" ]] && return 0
  ensure_docker || return 0
  # --no-deps: the game server runs on the host, never the app container.
  "${COMPOSE[@]}" up -d --quiet-pull --no-deps prometheus grafana
  wait_http grafana "http://localhost:3000/grafana/api/health" 90 &&
    echo "  also in the admin portal's Monitoring tab; here, sign in as ${GRAFANA_ADMIN_USER:-admin} / GRAFANA_ADMIN_PASSWORD from .env" || true
}

stop_monitoring() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || return 0
  "${COMPOSE[@]}" stop prometheus grafana >/dev/null 2>&1 && echo "stopped monitoring" || true
}

# Wait for a URL with no pid to watch (containers).
wait_http() {
  local name="$1" url="$2" timeout="${3:-60}"
  for ((i = 0; i < timeout * 2; i++)); do
    if curl -s -o /dev/null --max-time 1 "$url"; then
      echo "$name ready at ${url%/api/health}"
      return 0
    fi
    sleep 0.5
  done
  echo "warning: $name not ready after ${timeout}s (${COMPOSE[*]} logs $name)" >&2
  return 1
}

# Working directory of a pid (empty if it is gone or not ours to inspect).
proc_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

# Catch this app's servers on any port: `go run`, its compiled binary, and
# pnpm/vite/esbuild, but only processes whose cwd is inside this checkout, so
# other projects' dev servers are left alone.
stop_strays() {
  local module pids=() pid exe args cwd
  module="$(awk '/^module /{print $2; exit}' "$ROOT/go.mod" 2>/dev/null || true)"
  module="${module##*/}"
  while read -r pid exe args; do
    [[ "$pid" == "$$" ]] && continue
    # Match on the executable, not any substring, so shells whose command
    # text merely mentions "go run" or "vite" are never touched.
    case "${exe##*/}:$args" in
      go:run* | node:*pnpm\ dev* | node:*vite/bin/vite.js* | esbuild:--service*) ;;
      "$module":*) [[ "$exe" == */go-build*/exe/* ]] || continue ;;
      *) continue ;;
    esac
    cwd="$(proc_cwd "$pid")"
    [[ "$cwd" == "$ROOT" || "$cwd" == "$ROOT"/* ]] && pids+=("$pid")
  done < <(ps -axo pid=,command=)
  ((${#pids[@]})) || return 0
  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in {1..20}; do
    local alive=()
    for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null && alive+=("$pid"); done
    ((${#alive[@]})) || { echo "stopped ${#pids[@]} stray dev process(es)"; return 0; }
    sleep 0.25
  done
  kill -KILL "${alive[@]}" 2>/dev/null || true
  echo "stopped ${#pids[@]} stray dev process(es) (forced)"
}

stop_all() {
  stop_one go "$GO_PORT"
  stop_one web "$WEB_PORT"
  stop_strays
}

# Start a command in its own process group, detached from this shell.
start_one() {
  local name="$1" dir="$2"; shift 2
  local log="$RUN_DIR/$name.log"
  : >"$log"
  (
    cd "$dir"
    set -m  # job control: the background job becomes its own process group
    nohup "$@" >>"$log" 2>&1 </dev/null &
    echo $! >"$RUN_DIR/$name.pid"
  )
  echo "started $name (pid $(cat "$RUN_DIR/$name.pid"), log $log)"
}

wait_for() {
  local name="$1" url="$2" timeout="${3:-90}"
  for ((i = 0; i < timeout * 2; i++)); do
    if curl -s -o /dev/null --max-time 1 "$url"; then
      echo "$name ready at $url"
      return 0
    fi
    # Bail early if the process died (compile error, missing deps, ...).
    local pid
    pid="$(cat "$RUN_DIR/$name.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "error: $name exited; last log lines:" >&2
      tail -n 30 "$RUN_DIR/$name.log" >&2
      return 1
    fi
    sleep 0.5
  done
  echo "error: $name not ready after ${timeout}s; last log lines:" >&2
  tail -n 30 "$RUN_DIR/$name.log" >&2
  return 1
}

status() {
  for pair in "go:$GO_PORT" "web:$WEB_PORT"; do
    local name="${pair%%:*}" port="${pair##*:}"
    if lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$name: running on :$port"
    else
      echo "$name: not running"
    fi
  done
}

case "${1:-start}" in
  stop)
    stop_all
    stop_monitoring
    ;;
  status)
    status
    if docker info >/dev/null 2>&1; then "${COMPOSE[@]}" ps prometheus grafana; fi
    ;;
  logs) tail -n 50 -F "$RUN_DIR/go.log" "$RUN_DIR/web.log" ;;
  start | restart)
    stop_all
    if [[ ! -d "$ROOT/web/node_modules" ]]; then
      (cd "$ROOT/web" && pnpm install)
    fi
    start_one go "$ROOT" go run .
    start_one web "$ROOT/web" pnpm dev --port "$WEB_PORT" --strictPort
    ok=0
    wait_for go "http://localhost:$GO_PORT/" 120 || ok=1
    wait_for web "http://localhost:$WEB_PORT/" 60 || ok=1
    start_monitoring
    exit $ok
    ;;
  *)
    echo "usage: $0 [start|restart|stop|status|logs]" >&2
    exit 2
    ;;
esac
