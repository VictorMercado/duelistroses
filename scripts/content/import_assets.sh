#!/bin/sh
# Copies game assets into content/assets, which the server serves at /assets.
#
#   sh scripts/content/import_assets.sh [path-to-source-repo]
#
# The destination is not committed (see .gitignore); rerun this after a clone.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GAME="${1:-$ROOT}"
DEST="$ROOT/content/assets"
SPRITES="$GAME/assets/yugiohAssets/game assets/PlayStation 2 - Yu-Gi-Oh! The Duelists of the Roses - Miscellaneous - Cards"
PUBLIC="$GAME/web/public"

mkdir -p "$DEST/cards"

# Card art, one sprite per card number: img_007.png -> cards/007.png
if [ -d "$SPRITES" ]; then
  for f in "$SPRITES"/img_*.png; do
    n="$(basename "$f" .png)"
    cp "$f" "$DEST/cards/${n#img_}.png"
  done
fi

# The back of a face-down card. Card art is drawn from the numbered sprites
# (upscaled by upscale_cards.py, masked by build_masks.py): no HD folder.
[ -f "$PUBLIC/cards/mysteryCard.png" ] && cp "$PUBLIC/cards/mysteryCard.png" "$DEST/cards/"

for dir in terrains textures attributes audio fonts; do
  if [ -d "$PUBLIC/$dir" ]; then
    mkdir -p "$DEST/$dir"
    cp -R "$PUBLIC/$dir/." "$DEST/$dir/"
  fi
done

# WebP copies of the card art, which the client draws (see build_webp.sh).
if command -v cwebp >/dev/null; then
  sh "$ROOT/scripts/content/build_webp.sh" "$ROOT/content/assets"
else
  echo "cwebp not found: card art will be served as PNG (brew install webp, then run build_webp.sh)"
fi

echo "assets in $DEST:"
for dir in cards terrains textures attributes audio fonts; do
  [ -d "$DEST/$dir" ] && echo "  $dir: $(find "$DEST/$dir" -maxdepth 1 -type f | wc -l | tr -d ' ') files"
done
