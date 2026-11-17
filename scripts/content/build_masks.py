# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "rembg[cpu]>=2.0.60",
#   "pillow>=10",
#   "numpy>=1.26",
#   "scipy>=1.11",
# ]
# ///
"""Builds the holo foil masks for card art.

    uv run scripts/content/build_masks.py                   # every card in content/assets/cards
    uv run scripts/content/build_masks.py --force           # also redo masks that already exist
    uv run scripts/content/build_masks.py --only 7,20,300   # just these card numbers
    uv run scripts/content/build_masks.py --model isnet-general-use  # faster, rougher
    uv run scripts/content/build_masks.py --force --only 902,903,904 --model birefnet-dis --keep-holes
                                                            # the God cards: finer model, wings kept apart

Run scripts/content/upscale_cards.py first: the model finds the subject far
better in 512px art than in the 128px sprites.

For each piece of art `Name.png` (e.g. `007.png`) it writes `Name_Mask.png` beside it: the main
subject in white, the background in black. The holographic shader puts the
foil on the black part, so the monster stays clean and the background shines.
build_catalog.py links each card to the mask of the art it is drawn with, so
rerun it afterwards (and rebuild the server, which embeds the catalog):

    python3 scripts/content/build_catalog.py

Spell, trap and ritual art has no subject, so those cards (looked up in
content/data/cards.json by number) get an all-black mask: foil everywhere.

A card with a mask is drawn as a holo card, so only keep masks for the cards
that should be foil (delete the rest, or pass only the files you want).

Existing masks are left alone unless --force is given, so hand-made ones survive.
Allow ~8 s per card on an M1 (about two hours for all 872); it can be stopped
and rerun at any time, since finished masks are skipped. The first run downloads the segmentation model (~900 MB for the default
BiRefNet, ~170 MB for isnet) into ~/.u2net. Look the results over: busy art
can confuse the model, and the script flags masks that cover almost nothing
or almost everything.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from rembg import new_session, remove
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(os.path.dirname(os.path.dirname(HERE)), "content", "data", "cards.json")
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "content", "assets", "cards")
MASK_SUFFIX = "_Mask"
# Not card art: never masked.
SKIP = {"mysterycard"}
EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def card_kinds():
    """Card number -> kind (monster, spell, trap, ritual), from the built catalog."""
    try:
        with open(CATALOG) as f:
            return {c["num"]: c["kind"] for c in json.load(f)}
    except (OSError, ValueError, KeyError):
        return {}


def non_monster(path, kinds):
    base = os.path.splitext(os.path.basename(path))[0]
    return base.isdigit() and kinds.get(int(base), "monster") != "monster"


def is_mask(path):
    return os.path.splitext(os.path.basename(path))[0].lower().endswith(MASK_SUFFIX.lower())


def mask_path(path):
    base, _ = os.path.splitext(path)
    return base + MASK_SUFFIX + ".png"


def collect(targets):
    files = []
    for target in targets:
        if os.path.isdir(target):
            for name in sorted(os.listdir(target)):
                files.append(os.path.join(target, name))
        elif os.path.isfile(target):
            files.append(target)
        else:
            print(f"skip {target}: not found", file=sys.stderr)
    return [
        f for f in files
        if os.path.splitext(f)[1].lower() in EXTENSIONS
        and not is_mask(f)
        and os.path.splitext(os.path.basename(f))[0].lower() not in SKIP
    ]


def clean(alpha, threshold, min_area, smooth, keep_holes=False):
    """Turns the model's soft alpha into a solid silhouette."""
    subject = alpha >= threshold
    # Drop specks: anything much smaller than the biggest piece of subject.
    labels, count = ndimage.label(subject)
    if count:
        sizes = ndimage.sum(subject, labels, range(1, count + 1))
        keep = sizes >= max(min_area * subject.size, sizes.max() * 0.02)
        subject = keep[labels - 1] & (labels > 0)
    # Holes inside the subject (gaps between arms, eyes...) are subject too.
    if not keep_holes:
        subject = ndimage.binary_fill_holes(subject)
    image = Image.fromarray((subject * 255).astype(np.uint8), "L")
    if smooth > 0:
        # Blur then re-threshold rounds off jagged, pixelated edges.
        image = image.filter(ImageFilter.GaussianBlur(smooth)).point(lambda v: 255 if v >= 128 else 0)
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("targets", nargs="*", default=[DEFAULT_DIR], help="art files or folders (default: content/assets/cards)")
    parser.add_argument("--force", action="store_true", help="overwrite masks that already exist")
    parser.add_argument("--model", default="birefnet-general",
                        help="rembg model: birefnet-general (default), isnet-general-use (faster), isnet-anime, u2net...")
    parser.add_argument("--threshold", type=int, default=128, help="alpha (0-255) above which a pixel is subject")
    parser.add_argument("--min-area", type=float, default=0.002, help="drop subject pieces smaller than this share of the image")
    parser.add_argument("--smooth", type=float, default=2.0, help="edge smoothing radius in pixels (0 = off)")
    parser.add_argument("--only", help="comma separated card numbers to do, e.g. --only 7,20,300")
    parser.add_argument("--keep-holes", action="store_true",
                        help="leave background enclosed by the subject (between wings, under an arm) black instead of filling it")
    parser.add_argument("--dry-run", action="store_true", help="list what would be built and stop")
    args = parser.parse_args()

    files = collect(args.targets)
    if args.only:
        wanted = {int(n) for n in args.only.split(",") if n.strip()}
        files = [f for f in files if os.path.splitext(os.path.basename(f))[0].isdigit()
                 and int(os.path.splitext(os.path.basename(f))[0]) in wanted]
    todo = [f for f in files if args.force or not os.path.exists(mask_path(f))]
    print(f"{len(files)} pieces of art, {len(files) - len(todo)} already masked, {len(todo)} to build")
    if args.dry_run or not todo:
        for f in todo:
            print("  " + os.path.basename(f))
        return

    # CPU on purpose: CoreML compiles BiRefNet so slowly it never finishes.
    kinds = card_kinds()
    session = None
    if any(not non_monster(f, kinds) for f in todo):
        session = new_session(args.model, providers=["CPUExecutionProvider"])
    failed = 0
    for i, path in enumerate(todo, 1):
        name = os.path.basename(path)
        try:
            if non_monster(path, kinds):
                # Spells, traps and rituals have no subject to cut out: the whole picture foils.
                with Image.open(path) as art:
                    Image.new("L", art.size, 0).save(mask_path(path), optimize=True)
                print(f"[{i}/{len(todo)}] {name}: {kinds[int(name.split('.')[0])]}, foil everywhere")
                continue
            with Image.open(path) as art:
                art = art.convert("RGB")
                cutout = remove(art, session=session, only_mask=True, post_process_mask=True)
            alpha = np.asarray(cutout.convert("L"))
            mask = clean(alpha, args.threshold, args.min_area, args.smooth, args.keep_holes)
            coverage = np.asarray(mask).mean() / 255
            mask.save(mask_path(path), optimize=True)
            note = "  (check: subject covers almost nothing)" if coverage < 0.03 else \
                   "  (check: subject covers almost everything)" if coverage > 0.95 else ""
            print(f"[{i}/{len(todo)}] {name}: {coverage:.0%} subject{note}")
        except Exception as error:  # keep going: one bad file should not stop the batch
            failed += 1
            print(f"[{i}/{len(todo)}] {name}: FAILED {error}", file=sys.stderr)

    print(f"done: {len(todo) - failed} masks written" + (f", {failed} failed" if failed else ""))
    print("now rebuild the catalog: python3 scripts/content/build_catalog.py")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
