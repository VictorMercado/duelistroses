"""Remakes card holo masks with gmg.py's Gemini + rembg method, for review.

    venv/bin/python batch_masks.py 3 294 683          # these card numbers
    venv/bin/python batch_masks.py --list cards.txt   # numbers from a file (one per line, # comments)
    venv/bin/python batch_masks.py --sheet            # just redraw the review sheet
    venv/bin/python batch_masks.py --apply 3 294      # copy reviewed masks over the live ones

Each card's art (content/assets/cards/NNN.png) goes to Gemini to have its
background removed; rembg then cuts the subject out of Gemini's picture, and
its alpha becomes the mask: subject white (kept clean), background black (foil).

New masks go to make_mask/review/NNN_Mask.png, never straight over the live
ones, with review/sheet.jpg showing old and new side by side over the art.
Gemini redraws the picture rather than cutting it, so a card whose redraw
drifts from the original (its mask would not line up) is flagged in the
sheet and left out of --apply unless named with --force.

Cards already in review/ are skipped (delete one to redo it), so a run can be
stopped and resumed without paying twice.
"""
import argparse
import io
import json
import os
import shutil
import sys

import numpy as np
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CARDS = os.path.join(ROOT, "content", "assets", "cards")
CATALOG = os.path.join(ROOT, "content", "data", "cards.json")
REVIEW = os.path.join(HERE, "review")
MODEL = "gemini-3-pro-image-preview"
PROMPT = (
    "Generate a copy of this image but remove the background. The background must be transparent. "
    "Keep the subject exactly where it is, at exactly the same size and pose; do not crop, move or redraw it."
)
# Mean colour difference (0-255) between Gemini's picture and the art above
# which the redraw is taken to have drifted.
DRIFT = 38.0

load_dotenv(os.path.join(HERE, ".env"))


def catalog():
    try:
        with open(CATALOG) as f:
            return {c["num"]: c for c in json.load(f)}
    except (OSError, ValueError):
        return {}


CATALOG_CARDS = catalog()


def names():
    return {n: c["name"] for n, c in CATALOG_CARDS.items()}


def art_path(num):
    """The card's art, as the catalog names it (most are NNN.png; Pot of Greed is 871.png)."""
    rel = CATALOG_CARDS.get(num, {}).get("image") or f"{num:03d}.png"
    return os.path.join(CARDS, os.path.basename(rel))


def live_mask(num):
    """The mask beside the art (Name.png -> Name_Mask.png), as build_masks.py names it."""
    return os.path.splitext(art_path(num))[0] + "_Mask.png"


def review_mask(num):
    return os.path.join(REVIEW, f"{num:03d}_Mask.png")


def drift_path(num):
    return os.path.join(REVIEW, f"{num:03d}_drift.txt")


def gemini_cutout(client, art_bytes):
    from google.genai import types

    contents = [types.Content(role="user", parts=[
        types.Part.from_bytes(data=art_bytes, mime_type="image/png"),
        types.Part.from_text(text=PROMPT),
    ])]
    config = types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=types.ImageConfig(image_size="1K"))
    for chunk in client.models.generate_content_stream(model=MODEL, contents=contents, config=config):
        if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
            continue
        for part in chunk.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                return Image.open(io.BytesIO(part.inline_data.data)).convert("RGBA")
    return None


def drift(art, redraw):
    """How far Gemini's picture strays from the art, where its subject is (mean colour difference)."""
    a = np.asarray(art.convert("RGB").resize((128, 128))).astype(float)
    b = np.asarray(redraw.convert("RGB").resize((128, 128))).astype(float)
    keep = np.asarray(redraw.getchannel("A").resize((128, 128))) > 127
    if keep.sum() < 50:
        keep = np.ones_like(keep)
    return float(np.abs(a - b).mean(axis=2)[keep].mean())


def make(nums):
    from google import genai
    from rembg import new_session, remove

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set (make_mask/.env)")
    client = genai.Client(api_key=key)
    session = new_session("isnet-anime")
    os.makedirs(REVIEW, exist_ok=True)
    title = names()
    for i, num in enumerate(nums, 1):
        out = review_mask(num)
        label = f"[{i}/{len(nums)}] {num:03d} {title.get(num, '')}"
        if os.path.exists(out):
            print(label, "already made, skipped")
            continue
        if not os.path.exists(art_path(num)):
            print(label, "no art, skipped")
            continue
        try:
            art = Image.open(art_path(num)).convert("RGB")
            with open(art_path(num), "rb") as f:
                redraw = gemini_cutout(client, f.read())
            if redraw is None:
                print(label, "Gemini returned no image")
                continue
            cut = remove(redraw, session=session)
            mask = cut.getchannel("A").point(lambda p: 255 if p > 10 else 0).convert("L")
            mask = mask.resize(art.size, Image.NEAREST)
            d = drift(art, cut)
            mask.save(out)
            with open(drift_path(num), "w") as f:
                f.write(f"{d:.1f}\n")
            print(label, f"done, drift {d:.1f}" + ("  <- DRIFTED, check it" if d > DRIFT else ""))
        except Exception as e:  # one bad card should not stop the batch
            print(label, "failed:", e)


def read_drift(num):
    try:
        with open(drift_path(num)) as f:
            return float(f.read())
    except (OSError, ValueError):
        return None


def overlay(art, mask, size):
    a = np.asarray(art.convert("RGB").resize((size, size))).astype(float)
    m = mask.convert("L").resize((size, size))
    keep = (np.asarray(m) > 127)[..., None]
    a = np.where(keep, a, a * 0.3 + np.array([150, 0, 150]) * 0.45)
    img = Image.fromarray(a.clip(0, 255).astype("uint8"))
    edge = m.filter(ImageFilter.FIND_EDGES).point(lambda p: 255 if p > 60 else 0)
    img.paste((0, 255, 255), mask=edge)
    return img


def sheet():
    """review/sheet_NN.jpg: each card's live mask (left) and the new one (right) over its art."""
    if not os.path.isdir(REVIEW):
        return
    title = names()
    nums = sorted(int(f[:3]) for f in os.listdir(REVIEW) if f.endswith("_Mask.png"))
    T, cols, rows = 180, 4, 5
    per = cols * rows
    for s in range(0, len(nums), per):
        page = Image.new("RGB", (cols * (2 * T + 10), rows * (T + 16)), (35, 35, 35))
        for j, num in enumerate(nums[s:s + per]):
            art = Image.open(art_path(num))
            live = live_mask(num)
            old = Image.open(live) if os.path.exists(live) else Image.new("L", art.size, 0)
            new = Image.open(review_mask(num))
            x, y = (j % cols) * (2 * T + 10), (j // cols) * (T + 16)
            page.paste(overlay(art, old, T), (x, y))
            page.paste(overlay(art, new, T), (x + T, y))
            d = read_drift(num)
            flag = d is not None and d > DRIFT
            ImageDraw.Draw(page).text((x + 2, y + T + 2), f"{num} {title.get(num, '')[:24]}  drift {d if d is not None else '?'}{' !' if flag else ''}",
                                      fill=(255, 90, 90) if flag else (255, 255, 255))
        page.save(os.path.join(REVIEW, f"sheet_{s // per:02d}.jpg"), quality=85)
    print(f"review sheets for {len(nums)} cards in {REVIEW}")


def apply(nums, force):
    for num in nums:
        src = review_mask(num)
        if not os.path.exists(src):
            print(f"{num:03d}: no reviewed mask")
            continue
        d = read_drift(num)
        if d is not None and d > DRIFT and not force:
            print(f"{num:03d}: drifted ({d:.1f}), not applied (pass --force to apply anyway)")
            continue
        shutil.copyfile(src, live_mask(num))
        print(f"{num:03d}: applied")


def parse_list(path):
    nums = []
    with open(path) as f:
        for line in f:
            line = line.split("#")[0].strip()
            if line:
                nums.append(int(line))
    return nums


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("nums", nargs="*", type=int)
    p.add_argument("--list")
    p.add_argument("--sheet", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--force", action="store_true")
    a = p.parse_args()
    nums = a.nums + (parse_list(a.list) if a.list else [])
    if a.apply:
        apply(nums, a.force)
    elif not a.sheet:
        make(nums)
        sheet()
    else:
        sheet()


if __name__ == "__main__":
    main()
