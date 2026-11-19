#!/usr/bin/env bash
# Copies content/assets (card art, textures, sounds, music) from this machine
# to a server, where the Docker build picks them up (see the Dockerfile).
#
#   scripts/server/sync-assets.sh <host> <path to the server's content/assets>
#
# Only changed files are sent. Afterwards they belong to whoever owns the
# server's repo (the deploy user), not to whoever ssh'd in. fonts/ is left
# out: git delivers it. legacy/ is left out: the game never loads it.
#
#   DELETE=1   also delete server files that are gone here
#   DRY_RUN=1  only list what would be sent
#
# Run by scripts/server/prepare.sh (the pre-push hook).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/content/assets"
host="$1"
dest="${2%/}"

die() { echo "sync-assets: $*" >&2; exit 1; }

[[ -d "$SRC/cards" ]] || die "$SRC/cards is missing (run scripts/content/import_assets.sh)"
if [[ -n "${DELETE:-}" ]]; then
  # A half-empty folder mirrored with delete would wipe the server's art.
  cards=$(find "$SRC/cards" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
  [[ "$cards" -ge 100 ]] || die "only $cards card images in $SRC/cards; refusing to delete on the server"
fi

ssh=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$host")
# The folder is created owned like the repo above it (content/), and the
# copied files end up owned the same way.
owner="$("${ssh[@]}" "mkdir -p '$dest' && stat -c %U:%G '$(dirname "$dest")'")" \
  || die "cannot reach $host over ssh, or cannot create $dest there"

args=(-rlt --exclude .DS_Store --exclude 'fonts/' --exclude 'legacy/')
[[ -n "${DELETE:-}" ]] && args+=(--delete)
[[ -n "${DRY_RUN:-}" ]] && args+=(-n -v)

rsync "${args[@]}" "$SRC/" "$host:$dest/" || die "copying to $host:$dest failed"
[[ -n "${DRY_RUN:-}" ]] && exit 0
# rsync -t keeps the times; the owner is set here, so the files are the deploy user's.
"${ssh[@]}" "chown -R '$owner' '$dest' && chmod -R u+rwX,go+rX '$dest'" \
  || die "copied, but could not hand $dest to $owner"
echo "sync-assets: $SRC -> $host:$dest (owner $owner)"
