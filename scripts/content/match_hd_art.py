# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "pillow>=10",
#   "numpy>=1.26",
#   "scipy>=1.11",
# ]
# ///
"""Replaces the 128px card sprites with higher resolution art of the same card.

    uv run scripts/content/match_hd_art.py            # dry run: match, report, change nothing
    uv run scripts/content/match_hd_art.py --apply    # write the matches over content/assets/cards/NNN.png

The higher resolution art (assets/yugiohAssets/game assets/card_artwork) is
named by hashes, the sprites by card number, so the two are paired by what the
pictures look like: both are shrunk to a small, slightly blurred thumbnail and
compared pixel by pixel, and the pairing is solved as a whole (each source used
at most once) so two similar cards cannot both claim the same picture.

Every pair is scored. A pair counts as confident when its distance is low (and,
unless it is near exact, clearly better than the sprite's next best candidate);
the rest are usually sprites with no counterpart in the folder. They are listed
for a look, with a side-by-side sheet (sprite | match | runner-up) written to
--sheet. --apply only writes confident pairs unless --all is given.

Before a sprite is replaced the original is kept in content/assets/cards/original/
(the same place upscale_cards.py uses), and is never overwritten there.
"""
import argparse
import csv
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.optimize import linear_sum_assignment

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPRITES = os.path.join(ROOT, "content", "assets", "cards")
SOURCE = os.path.join(ROOT, "assets", "yugiohAssets", "game assets", "card_artwork")
BACKUP = os.path.join(SPRITES, "original")

THUMB = 24
# Mean absolute difference per channel (0-255). Real pairs land around 1-5 and
# wrong ones above 20. Under EXACT a pair is the same picture even when the
# source folder holds a duplicate of it; up to MAX_DISTANCE it must also beat
# its runner-up by MIN_MARGIN.
EXACT = 8.0
MAX_DISTANCE = 18.0
MIN_MARGIN = 1.5


def thumbnail(path: str) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("RGB").resize((128, 128), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.5))
        return np.asarray(im.resize((THUMB, THUMB), Image.LANCZOS), dtype=np.float32).reshape(-1)


def images(folder: str) -> list[str]:
    return sorted(f for f in os.listdir(folder) if f.lower().endswith(".png") and os.path.isfile(os.path.join(folder, f)))


def sheet(rows, path: str):
    """sprite | chosen match | runner-up, one row per pair to look at."""
    cell, pad = 128, 4
    out = Image.new("RGB", (3 * (cell + pad) + 260, max(1, len(rows)) * (cell + pad)), "black")
    draw = ImageDraw.Draw(out)
    for i, r in enumerate(rows):
        y = i * (cell + pad)
        for j, p in enumerate((r["sprite_path"], r["match_path"], r["second_path"])):
            with Image.open(p) as im:
                out.paste(im.convert("RGB").resize((cell, cell)), (j * (cell + pad), y))
        draw.text((3 * (cell + pad) + 6, y + 6), f"{r['sprite']}\nd={r['distance']:.1f}\nnext={r['second_distance']:.1f}", fill="white")
    out.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the matches over the sprites")
    ap.add_argument("--all", action="store_true", help="with --apply, also write pairs that are not confident")
    ap.add_argument("--report", default=os.path.join(HERE, "hd_matches.csv"))
    ap.add_argument("--sheet", default=os.path.join(HERE, "hd_matches_review.png"))
    args = ap.parse_args()

    sprites = images(SPRITES)
    sources = images(SOURCE)
    print(f"{len(sprites)} sprites, {len(sources)} candidate images")
    # Compare against the untouched sprite if it was already replaced once.
    sprite_paths = [os.path.join(BACKUP, s) if os.path.exists(os.path.join(BACKUP, s)) else os.path.join(SPRITES, s) for s in sprites]
    a = np.stack([thumbnail(p) for p in sprite_paths])
    b = np.stack([thumbnail(os.path.join(SOURCE, s)) for s in sources])

    # Mean absolute difference between every sprite and every candidate.
    cost = np.stack([np.abs(b - row).mean(axis=1) for row in a])
    rows_i, cols_i = linear_sum_assignment(cost)

    results = []
    for i, j in zip(rows_i, cols_i):
        order = np.argsort(cost[i])
        second = order[1] if order[0] == j else order[0]
        d, d2 = float(cost[i, j]), float(cost[i, second])
        results.append({
            "sprite": sprites[i], "match": sources[j], "distance": d,
            "second": sources[second], "second_distance": d2,
            "confident": d <= EXACT or (d <= MAX_DISTANCE and d2 - d >= MIN_MARGIN and order[0] == j),
            "sprite_path": sprite_paths[i], "match_path": os.path.join(SOURCE, sources[j]),
            "second_path": os.path.join(SOURCE, sources[second]),
        })
    results.sort(key=lambda r: r["sprite"])

    with open(args.report, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sprite", "match", "distance", "runner_up", "runner_up_distance", "confident"])
        for r in results:
            w.writerow([r["sprite"], r["match"], f"{r['distance']:.2f}", r["second"], f"{r['second_distance']:.2f}", r["confident"]])

    doubtful = sorted((r for r in results if not r["confident"]), key=lambda r: -r["distance"])
    unmatched = sorted(set(sprites) - {r["sprite"] for r in results})
    print(f"{len(results) - len(doubtful)} confident, {len(doubtful)} to check, {len(unmatched)} without any candidate")
    print(f"report: {args.report}")
    if doubtful:
        sheet(doubtful, args.sheet)
        print(f"review sheet (sprite | match | runner-up): {args.sheet}")
    for name in unmatched:
        print(f"  no candidate: {name}")

    if not args.apply:
        print("dry run: nothing written (pass --apply)")
        return

    os.makedirs(BACKUP, exist_ok=True)
    written = 0
    for r in results:
        if not (r["confident"] or args.all):
            continue
        target = os.path.join(SPRITES, r["sprite"])
        keep = os.path.join(BACKUP, r["sprite"])
        if not os.path.exists(keep):
            shutil.copy2(target, keep)
        with Image.open(r["match_path"]) as im:
            im.convert("RGB").save(target, optimize=True)
        written += 1
    print(f"wrote {written} sprites; originals are in {BACKUP}")


if __name__ == "__main__":
    sys.exit(main())
