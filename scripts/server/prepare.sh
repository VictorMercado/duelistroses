#!/usr/bin/env bash
# Gets the production server ready for the code about to be pushed, from this
# machine. Run by the pre-push hook before every push to main, never by hand:
#
#   1. bootstrap.sh on the server: packages, Docker, the deploy user, the
#      webhook, folders, the checkout (only what is missing; a new server gets
#      everything);
#   2. the secrets, which only this machine holds (sync-secrets.sh);
#   3. content/assets, which is not in git (sync-assets.sh).
#
# Then the push reaches GitHub, whose webhook runs scripts/deploy.sh on the
# server.
#
# Settings (git config, this clone):
#   duelist.assetsHost  ssh host of the server     (default duelistcity)
#   duelist.appDir      the checkout on the server (default /opt/duelistroses)
#   duelist.deployUser  who owns and deploys it    (default deploy)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cfg() { git -C "$ROOT" config --get "$1" || echo "$2"; }
host="$(cfg duelist.assetsHost duelistcity)"
app="$(cfg duelist.appDir /opt/duelistroses)"
user="$(cfg duelist.deployUser deploy)"
repo="$(git -C "$ROOT" remote get-url origin)"
branch=main

for value in "$app" "$user" "$repo"; do
  [[ "$value" != *"'"* && "$value" != *" "* ]] || { echo "prepare: no quotes or spaces in duelist.appDir, duelist.deployUser or the origin URL" >&2; exit 1; }
done

ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" \
  "if [ \"\$(id -u)\" = 0 ]; then bash -s -- '$repo' '$branch' '$app' '$user'; else sudo -n bash -s -- '$repo' '$branch' '$app' '$user'; fi" \
  <"$ROOT/scripts/server/bootstrap.sh" \
  || { echo "prepare: setting up $host failed (see above)" >&2; exit 1; }

"$ROOT/scripts/server/sync-secrets.sh" "$host" "$user"
"$ROOT/scripts/server/sync-assets.sh" "$host" "$app/content/assets"
