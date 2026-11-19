#!/usr/bin/env bash
# Makes a server able to run and deploy the game, from nothing: packages,
# Docker, the deploy user, the deploy webhook, folders and the checkout. Every
# step checks first and only does what is missing, so on a server that is
# already set up it changes nothing and takes a second or two.
#
# It runs on the server, as root. Nobody runs it by hand: the pre-push hook
# (scripts/git-hooks/pre-push) pipes this file, as it is in the commit being
# pushed, to the server before every push to main:
#
#   ssh <host> 'bash -s -- <repo url> <branch> <app dir> <user>' < scripts/server/bootstrap.sh
#
# What it sets up is the whole of the server's configuration: anything else a
# server needs belongs here, not in a manual step.
set -euo pipefail

REPO="$1"
BRANCH="$2"
APP="$3"
DEPLOY_USER="$4"
CONFIG=/etc/duelistroses

# webhook (github.com/adnanh/webhook) runs scripts/deploy.sh on a push to main.
WEBHOOK_VERSION=2.8.3
WEBHOOK_URL="https://github.com/adnanh/webhook/releases/download/$WEBHOOK_VERSION/webhook-linux-amd64.tar.gz"
WEBHOOK_SHA256=3cdf93f0615f11bfc575c158d0d613666394228f6e830ff6f792178933773f7b

say() { echo "bootstrap: $*"; }
[[ "$(id -u)" == 0 ]] || { say "must run as root"; exit 1; }
changed=0

# --- Packages ---------------------------------------------------------------
need=()
for cmd in git rsync curl; do command -v "$cmd" >/dev/null || need+=("$cmd"); done
if ((${#need[@]})); then
  say "installing ${need[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
  changed=1
fi

# --- Docker, with the compose plugin ------------------------------------------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "installing Docker"
  curl -fsSL https://get.docker.com | sh
  changed=1
fi
systemctl is-enabled --quiet docker || systemctl enable --now docker

# --- The deploy user: owns the checkout, runs the webhook and the containers ---
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  say "creating user $DEPLOY_USER"
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  changed=1
fi
if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "$DEPLOY_USER"
  changed=1
fi

# --- Secrets and settings folder (filled by the pre-push hook) -----------------
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$CONFIG"

# --- The checkout ---------------------------------------------------------------
if [[ ! -d "$APP/.git" ]]; then
  if [[ -d "$APP" && -n "$(ls -A "$APP" | grep -v '^content$' || true)" ]]; then
    say "$APP exists, is not empty and is not a git checkout: move it aside"
    exit 1
  fi
  say "cloning $REPO ($BRANCH) into $APP"
  # content/ may already hold assets copied ahead of the clone: keep them aside meanwhile.
  [[ -d "$APP/content" ]] && mv "$APP/content" "$APP.content.tmp"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP"
  runuser -u "$DEPLOY_USER" -- git clone --quiet --branch "$BRANCH" "$REPO" "$APP"
  if [[ -d "$APP.content.tmp/assets" ]]; then
    rsync -a "$APP.content.tmp/assets/" "$APP/content/assets/"
    rm -rf "$APP.content.tmp"
  fi
  changed=1
fi
# Assets are not in git: the pre-push hook copies them here.
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP/content/assets"

# --- The deploy webhook -----------------------------------------------------------
if [[ ! -x /usr/local/bin/webhook ]]; then
  say "installing webhook $WEBHOOK_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/webhook.tgz" "$WEBHOOK_URL"
  echo "$WEBHOOK_SHA256  $tmp/webhook.tgz" | sha256sum -c --quiet
  tar -xzf "$tmp/webhook.tgz" -C "$tmp"
  install -m 755 "$tmp/webhook-linux-amd64/webhook" /usr/local/bin/webhook
  rm -rf "$tmp"
  changed=1
fi

# Its secret (WEBHOOK_SECRET) arrives with the other secrets; until then the
# service has nothing to check pushes against, so it waits.
unit=/etc/systemd/system/webhook.service
want="$(cat <<UNIT
[Unit]
Description=webhook (duelistroses deploys on push to main)
After=network-online.target docker.service
Wants=network-online.target
ConditionPathExists=$CONFIG/webhook.env

[Service]
User=$DEPLOY_USER
Group=$DEPLOY_USER
EnvironmentFile=$CONFIG/webhook.env
WorkingDirectory=$APP
# -hotreload: a changed scripts/hooks.json applies without a restart.
ExecStart=/usr/local/bin/webhook -hooks $APP/scripts/hooks.json -template -hotreload -verbose -port 9000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
)"
if [[ "$(cat "$unit" 2>/dev/null)" != "$want" ]]; then
  say "writing $unit"
  printf '%s\n' "$want" >"$unit"
  systemctl daemon-reload
  systemctl enable webhook >/dev/null 2>&1
  [[ -f "$CONFIG/webhook.env" ]] && systemctl restart webhook
  changed=1
fi
if [[ -f "$CONFIG/webhook.env" ]] && ! systemctl is-active --quiet webhook; then
  systemctl start webhook
fi

if ((changed)); then say "server updated"; else say "server already set up"; fi
