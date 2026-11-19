#!/usr/bin/env bash
# Copies the server's secrets from this machine, the one place they live
# outside a server (they never go in git):
#
#   ~/.config/duelistroses/secrets.env  -> /etc/duelistroses/secrets.env
#       KEY=VALUE lines for the game: ANTHROPIC_API_KEY, ADMIN_NAME,
#       ADMIN_PASSWORD, GRAFANA_ADMIN_PASSWORD... scripts/deploy.sh merges
#       them into .env on every deploy.
#   ~/.config/duelistroses/webhook.env  -> /etc/duelistroses/webhook.env
#       WEBHOOK_SECRET=..., the secret of the GitHub webhook that deploys.
#
#   scripts/server/sync-secrets.sh <host> <deploy user>
#
# A file is only sent when it differs from the server's, and goes in readable
# by the deploy user alone. A new webhook secret restarts the webhook. Run by
# scripts/server/prepare.sh (the pre-push hook); DUELIST_SECRETS_DIR moves the
# local folder.
set -euo pipefail

host="$1"
user="$2"
dir="${DUELIST_SECRETS_DIR:-$HOME/.config/duelistroses}"
ssh=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$host")
die() { echo "sync-secrets: $*" >&2; exit 1; }

# Root on the server, directly or through sudo.
as_root() { "${ssh[@]}" "if [ \"\$(id -u)\" = 0 ]; then $1; else sudo -n sh -c '$1'; fi"; }

for name in secrets.env webhook.env; do
  local_file="$dir/$name"
  remote_file="/etc/duelistroses/$name"
  remote_sum="$(as_root "sha256sum $remote_file 2>/dev/null | cut -d' ' -f1" || true)"
  if [[ ! -f "$local_file" ]]; then
    [[ -n "$remote_sum" ]] && continue # the server has it; nothing to send
    die "$local_file is missing, and $host has no $remote_file either. Create it (mode 600) with its KEY=VALUE lines; see the top of scripts/server/sync-secrets.sh"
  fi
  [[ "$(stat -f %Lp "$local_file" 2>/dev/null || stat -c %a "$local_file")" == 600 ]] || chmod 600 "$local_file"
  local_sum="$(shasum -a 256 "$local_file" | cut -d' ' -f1)"
  [[ "$local_sum" == "$remote_sum" ]] && continue
  as_root "install -m 600 -o $user -g $user /dev/stdin $remote_file" <"$local_file" || die "could not write $remote_file on $host"
  echo "sync-secrets: updated $remote_file"
  if [[ "$name" == webhook.env ]]; then
    as_root "systemctl restart webhook" || die "updated the webhook secret, but could not restart the webhook"
  fi
done
