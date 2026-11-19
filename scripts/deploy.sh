#!/usr/bin/env bash
# Deploy the latest code from GitHub: pull, build a new image, stop the old
# game container, start a new one, and check that it answers. Run it on the
# server from anywhere:
#
#   ./scripts/deploy.sh                 deploy origin/main
#   BRANCH=dev ./scripts/deploy.sh      deploy another branch
#   APP_DIR=/opt/duelistroses ./scripts/deploy.sh
#
# The image is built before the old container is stopped, so downtime is only
# the restart. If the new container does not answer, the previous image is
# started again. Player data lives in the duelist-data volume and survives.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export APP_DIR

# git pull can rewrite this file while bash is still reading it, so run from a
# temporary copy instead of the file in the repo.
if [[ -z "${DEPLOY_SELF_COPY:-}" ]]; then
  tmp="$(mktemp "${TMPDIR:-/tmp}/deploy.XXXXXX")"
  cp "${BASH_SOURCE[0]}" "$tmp"
  DEPLOY_SELF_COPY="$tmp" exec bash "$tmp" "$@"
fi
rm -f "$DEPLOY_SELF_COPY"

# One deploy at a time: a second webhook call waits for the first to finish.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${TMPDIR:-/tmp}/duelistroses-deploy.lock"
  flock 9
fi
BRANCH="${BRANCH:-main}"
SERVICE=app
CONTAINER=duelistroses
IMAGE=duelistroses:latest
PREVIOUS=duelistroses:previous
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

# Push notifications (subscribe in the ntfy app). NTFY_URL= turns them off.
NTFY_URL="${NTFY_URL-https://ntfy.sh/deploy_duelistcity}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; FAIL_REASON="$*"; exit 1; }

# notify TITLE PRIORITY TAGS MESSAGE. A failed notification never fails the deploy.
notify() {
  [[ -n "$NTFY_URL" ]] || return 0
  curl -fsS --max-time 10 -o /dev/null \
    -H "Title: $1" -H "Priority: $2" -H "Tags: $3" \
    -d "$4" "$NTFY_URL" || echo "warning: ntfy notification failed" >&2
}

# Any exit before the end of the script is a failed deploy: say so.
STAGE=starting
FAIL_REASON=""
NOTIFIED=0
on_exit() {
  local code=$?
  if [[ $code -ne 0 && $NOTIFIED -eq 0 ]]; then
    notify "Deploy failed: duelistroses" high "rotating_light" \
      "Failed while $STAGE on $(hostname) (branch ${BRANCH}, ${BUILD_SHA:-unknown commit}).${FAIL_REASON:+ $FAIL_REASON}"
  fi
}
trap on_exit EXIT

cd "$APP_DIR"
[[ -f docker-compose.yml ]] || die "no docker-compose.yml in $APP_DIR"

# --- 1. Pull ----------------------------------------------------------------
STAGE="pulling from GitHub"
# DEPLOY_BY / DEPLOY_MESSAGE are set by the webhook (scripts/hooks.json).
notify "Deploying duelistroses" low "rocket" \
  "Push to $BRANCH${DEPLOY_BY:+ by $DEPLOY_BY}${DEPLOY_MESSAGE:+: ${DEPLOY_MESSAGE%%$'\n'*}}"
log "Pulling $BRANCH from GitHub"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  die "local changes to tracked files on the server; commit or discard them first"
fi
OLD_SHA="$(git rev-parse --short HEAD)"
git fetch --prune origin
git checkout "$BRANCH"
git merge --ff-only "origin/$BRANCH"
export BUILD_SHA="$(git rev-parse --short HEAD)"
echo "$OLD_SHA -> $BUILD_SHA"

# --- 1b. Secrets into .env --------------------------------------------------
# Secrets live outside the repo (default /etc/duelistroses/secrets.env, mode
# 600) as KEY=VALUE lines. Each one replaces that key in .env or is added to
# it; every other line already in .env is kept as is.
SECRETS_FILE="${SECRETS_FILE:-/etc/duelistroses/secrets.env}"
STAGE="copying secrets into .env"
if [[ -r "$SECRETS_FILE" ]]; then
  log "Copying secrets from $SECRETS_FILE into .env"
  touch .env
  tmp_env="$(mktemp "$APP_DIR/.env.XXXXXX")"
  chmod 600 "$tmp_env"
  awk '
    # First file: the secrets. Remember each KEY=VALUE line by key.
    FNR == NR {
      if ($0 ~ /^[[:space:]]*(#|$)/) next
      line = $0; sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      key = line; sub(/=.*/, "", key)
      if (!(key in secret)) order[++n] = key
      secret[key] = line
      next
    }
    # Second file: the current .env. Drop the keys the secrets replace.
    {
      line = $0; sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      key = line; sub(/=.*/, "", key)
      if (line ~ /=/ && key in secret) next
      print
    }
    END { for (i = 1; i <= n; i++) print secret[order[i]] }
  ' "$SECRETS_FILE" .env >"$tmp_env"
  mv "$tmp_env" .env
  echo "set: $(grep -Ev '^[[:space:]]*(#|$)' "$SECRETS_FILE" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/=.*//' | paste -sd ' ' -)"
elif [[ -e "$SECRETS_FILE" ]]; then
  die "$SECRETS_FILE exists but $(id -un) cannot read it"
else
  echo "warning: no $SECRETS_FILE; using .env as it is" >&2
fi

# --- 1c. Assets -------------------------------------------------------------
# Card art, textures, sounds and music are not in git: the pre-push hook copies
# them here before the push (scripts/server/prepare.sh). Building without them
# would ship a game with no cards, so stop instead.
STAGE="checking content/assets"
cards=$(find content/assets/cards -maxdepth 1 -name '*.png' 2>/dev/null | wc -l)
[[ "$cards" -ge 100 ]] \
  || die "content/assets has $cards card images: push from a clone with the assets and the pre-push hook installed (sh scripts/install-hooks.sh), which copies them here first"
[[ -d content/assets/audio && -d content/assets/textures && -d content/assets/terrains ]] \
  || die "content/assets is missing audio, textures or terrains: push again from a clone with the assets"
echo "assets: $cards card images"

# --- 2. Build (old container keeps serving meanwhile) -----------------------
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$PREVIOUS"
fi
STAGE="building the image"
log "Building image ($BUILD_SHA)"
docker compose build --pull "$SERVICE"

# --- 3. Stop the old container, start the new one ---------------------------
STAGE="restarting the container"
log "Stopping old container"
docker compose stop "$SERVICE" || true
docker compose rm -f "$SERVICE" || true
# Also remove a same-named container started outside compose.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

log "Starting new container"
docker compose up -d --no-build --remove-orphans

# --- 4. Health check --------------------------------------------------------
healthy() {
  for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != true ]]; then
      sleep 1; continue
    fi
    if curl -fs -o /dev/null --max-time 2 "$HEALTH_URL"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

STAGE="health-checking the new container"
log "Waiting for $HEALTH_URL"
if healthy; then
  echo "deployed $BUILD_SHA"
  NOTIFIED=1
  notify "Deployed duelistroses" default "white_check_mark" \
    "$OLD_SHA -> $BUILD_SHA on $(hostname): $(git log -1 --format=%s)"
else
  echo "new container did not answer within ${HEALTH_TIMEOUT}s; last logs:" >&2
  docker compose logs --tail 50 "$SERVICE" >&2 || true
  if docker image inspect "$PREVIOUS" >/dev/null 2>&1; then
    log "Rolling back to the previous image ($OLD_SHA)"
    docker tag "$PREVIOUS" "$IMAGE"
    docker compose up -d --no-build --force-recreate "$SERVICE"
    if healthy; then
      echo "rolled back to the previous image" >&2
      FAIL_REASON="Rolled back to $OLD_SHA, which is serving."
    else
      echo "rollback container is not answering either" >&2
      FAIL_REASON="Rollback to $OLD_SHA is NOT answering either: the site may be down."
    fi
  fi
  printf 'error: deploy of %s failed (code is at %s; run "git checkout %s" to match the running image)\n' \
    "$BUILD_SHA" "$BUILD_SHA" "$OLD_SHA" >&2
  exit 1
fi

# --- 5. Clean up ------------------------------------------------------------
log "Pruning dangling images"
STAGE="pruning images"
docker image prune -f || true
