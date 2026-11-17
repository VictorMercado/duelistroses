#!/bin/sh
# Copies game assets into the content service's static folder. Every asset the
# game and the deck builder use is served from here and nowhere else.
#
#   sh tools/import_assets.sh [path-to-game-repo]
#
# The destination is not committed (see .gitignore); rerun this after a clone.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GAME="${1:-$ROOT/..}"
DEST="$ROOT/api/wwwroot/assets"
SPRITES="$GAME/assets/yugiohAssets/game assets/PlayStation 2 - Yu-Gi-Oh! The Duelists of the Roses - Miscellaneous - Cards"
PUBLIC="$GAME/web/public"

mkdir -p "$DEST/cards/hd"

# Card art, one sprite per card number: img_007.png -> cards/007.png
if [ -d "$SPRITES" ]; then
  for f in "$SPRITES"/img_*.png; do
    n="$(basename "$f" .png)"
    cp "$f" "$DEST/cards/${n#img_}.png"
  done
fi

# High resolution art and holo masks, matched to cards by name.
[ -d "$PUBLIC/cards" ] && cp "$PUBLIC"/cards/*.png "$DEST/cards/hd/"

for dir in terrains textures attributes audio fonts; do
  if [ -d "$PUBLIC/$dir" ]; then
    mkdir -p "$DEST/$dir"
    cp -R "$PUBLIC/$dir/." "$DEST/$dir/"
  fi
done

echo "assets in $DEST:"
for dir in cards cards/hd terrains textures attributes audio fonts; do
  [ -d "$DEST/$dir" ] && echo "  $dir: $(find "$DEST/$dir" -maxdepth 1 -type f | wc -l | tr -d ' ') files"
done
