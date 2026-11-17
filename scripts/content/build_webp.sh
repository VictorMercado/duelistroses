#!/bin/sh
# Makes the WebP copies of the card art the client draws (needs cwebp:
# `brew install webp`, `apt install webp`).
#
#   sh scripts/content/build_webp.sh [asset-dir]
#
# For each cards/NNN.png it writes:
#   cards/NNN.webp     512px, for the card detail view
#   cards/sm/NNN.webp  256px, for the hand and the board
# The holo masks (NNN_Mask.png) stay PNG. The server offers a copy only once
# it exists (content.withFaces), so art added later shows as PNG until this
# runs again. Copies newer than their PNG are skipped.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CARDS="${1:-$ROOT/content/assets}/cards"
FULL=512
SMALL=256
QUALITY=85

command -v cwebp >/dev/null || { echo "cwebp not found: brew install webp" >&2; exit 1; }
mkdir -p "$CARDS/sm"

made=0
for png in "$CARDS"/*.png; do
  name="$(basename "$png" .png)"
  case "$name" in *_Mask) continue ;; esac
  full="$CARDS/$name.webp"
  small="$CARDS/sm/$name.webp"
  if [ ! "$full" -nt "$png" ]; then
    cwebp -quiet -q "$QUALITY" -resize "$FULL" 0 "$png" -o "$full"
    made=$((made + 1))
  fi
  if [ ! "$small" -nt "$png" ]; then
    cwebp -quiet -q "$QUALITY" -resize "$SMALL" 0 "$png" -o "$small"
  fi
done
echo "webp: $made new copies in $CARDS ($(du -sh "$CARDS/sm" | cut -f1) small)"
