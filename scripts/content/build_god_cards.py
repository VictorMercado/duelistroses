# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "torch>=2.2",
#   "spandrel>=0.4",
#   "pillow>=10",
#   "numpy>=1.26",
#   "opencv-python-headless>=4.9",
# ]
# ///
"""Takes the three Egyptian God card scans apart into the pieces the game draws.

    uv run scripts/content/build_god_cards.py

Each scan (content/assets/cards/original/902.jpg, 903.jpg, 904.jpg) is a whole
card face: frame, art, level stars, attribute and ATK/DEF all in one picture.
The game draws a card from separate layers, so this writes, per god:

    content/assets/cards/<num>.png                 the art alone, 512x512
    content/assets/textures/god<Name>Template.png  the frame with the art window
                                                   cut out and the stars, attribute
                                                   and numbers painted out

and once, from the first scan:

    content/assets/attributes/divine_attribute.png  the DIVINE attribute orb

The templates are laid out like the other templates (813x1185, same art
window, same stat boxes), so the card components need no special case.
Afterwards build the holo masks:

    uv run scripts/content/build_masks.py --force --only 902,903,904 --model birefnet-dis --keep-holes

The scans are 570x831 JPEGs, so everything is first upscaled 4x with
Real-ESRGAN (which also cleans up the JPEG blocks) and cut from that.
"""
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter

from upscale_cards import load_model, pick_device

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "content", "assets")
CARDS = os.path.join(ASSETS, "cards")
SOURCES = os.path.join(CARDS, "original")

# Card number -> the name its template is filed under (textures/god<Name>Template.png).
GODS = {902: "Obelisk", 903: "Slifer", 904: "Ra"}

# --- where things are in a scan, in scan pixels (570x831) ---------------------
SCAN = (570, 831)
ART = (14, 15, 556, 594)            # left, top, right, bottom of the picture
WINDOW_BOTTOM = 595                 # first row of the bevel under the picture
STARS = (56, 636, 456, 695)         # the row of level stars, glow included
ORB = (491.5, 665.0)                # centre of the attribute orb
ORB_RADIUS = 28.0                   # the orb itself
ORB_GLOW = 43.0                     # the orb and the glow around it
ORB_FLOOR = 702                     # the glow stops here: the DEF box frame starts just below
BOXES = ((60, 719, 250, 780), (320, 719, 510, 780))  # where the numbers are, clear of the box frames

# --- the layout every template shares (see normalTemplate.png) ----------------
TEMPLATE = (813, 1185)
TEMPLATE_WINDOW = (19, 19, 794, 865)  # where the game lays the art over the template
ART_SIZE = 512
ICON_SIZE = 256


@torch.inference_mode()
def upscale(model, device, image, tile=256, pad=16):
    """4x upscale, in overlapping tiles so a whole card fits in GPU memory."""
    src = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = src.shape
    out = np.zeros((h * 4, w * 4, 3), dtype=np.float32)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0 = max(0, y - pad), max(0, x - pad)
            y1, x1 = min(h, y + tile + pad), min(w, x + tile + pad)
            piece = torch.from_numpy(src[y0:y1, x0:x1]).permute(2, 0, 1).unsqueeze(0).to(device)
            big = model(piece).clamp(0, 1).squeeze(0).permute(1, 2, 0).cpu().numpy()
            ty, tx = min(h, y + tile), min(w, x + tile)
            out[y * 4:ty * 4, x * 4:tx * 4] = big[(y - y0) * 4:(ty - y0) * 4, (x - x0) * 4:(tx - x0) * 4]
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGB")


def scaled(box, factor):
    return tuple(int(round(v * factor)) for v in box)


def build_art(big):
    return big.crop(scaled(ART, 4)).resize((ART_SIZE, ART_SIZE), Image.LANCZOS)


def build_icon(big):
    """The attribute orb on a transparent background."""
    cx, cy = ORB[0] * 4, ORB[1] * 4
    r = (ORB_RADIUS + 1.5) * 4
    orb = big.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))).convert("RGBA")
    alpha = Image.new("L", orb.size, 0)
    inset = (r - ORB_RADIUS * 4)
    ImageDraw.Draw(alpha).ellipse((inset, inset, orb.width - inset, orb.height - inset), fill=255)
    orb.putalpha(alpha.filter(ImageFilter.GaussianBlur(2)))
    return orb.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)


def membrane_fill(image, hole):
    """Fills `hole` (bool mask) from its surroundings with a smooth surface, so
    nothing streaks: each filled pixel settles to the average of its neighbours."""
    ys, xs = np.where(hole)
    y0, y1 = max(0, ys.min() - 3), min(image.shape[0], ys.max() + 4)
    x0, x1 = max(0, xs.min() - 3), min(image.shape[1], xs.max() + 4)
    patch = image[y0:y1, x0:x1].astype(np.float32)
    mask = hole[y0:y1, x0:x1]
    # Start from a blurred guess, which the averaging then relaxes into place.
    known = (~mask).astype(np.float32)[..., None]
    guess = cv2.GaussianBlur(patch * known, (0, 0), 12) / np.maximum(cv2.GaussianBlur(known, (0, 0), 12)[..., None], 1e-4)
    patch[mask] = guess[mask]
    for _ in range(1500):
        around = (np.roll(patch, 1, 0) + np.roll(patch, -1, 0) + np.roll(patch, 1, 1) + np.roll(patch, -1, 1)) / 4
        patch[mask] = around[mask]
    image[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)


def build_template(big, debug=None):
    """The scan as an empty template: nothing in the window, on the panel or in the boxes."""
    width, height = TEMPLATE
    k = width / SCAN[0]  # scan pixel -> template pixel
    flat = np.asarray(big.resize((width, int(round(SCAN[1] * k))), Image.LANCZOS)).copy()

    # What to paint out: the stars, the orb, and the number strokes in each box.
    paint = np.zeros(flat.shape[:2], dtype=np.uint8)
    x0, y0, x1, y1 = scaled(STARS, k)
    paint[y0:y1, x0:x1] = 255
    cv2.circle(paint, (int(round(ORB[0] * k)), int(round(ORB[1] * k))), int(round(ORB_GLOW * k)), 255, -1)
    paint[int(round(ORB_FLOOR * k)):] = 0
    grey = cv2.cvtColor(flat, cv2.COLOR_RGB2GRAY).astype(np.int16)
    for box in BOXES:
        x0, y0, x1, y1 = scaled(box, k)
        inside = grey[y0:y1, x0:x1]
        # Numbers are near black on a pale box: a stroke is anything far darker than the box.
        strokes = (inside < np.median(inside) - 50).astype(np.uint8) * 255
        # Take the soft edge of each stroke with it.
        paint[y0:y1, x0:x1] = cv2.dilate(strokes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    if debug:
        Image.fromarray(np.where(paint[..., None] > 0, (255, 0, 255), flat).astype(np.uint8)).save(debug)
    membrane_fill(flat, paint > 0)

    # Line the window up with the shared layout: everything down to the window's
    # bottom edge is stretched to end where the other templates' windows end,
    # and the panel below takes the rest.
    split = int(round(WINDOW_BOTTOM * k))
    image = Image.fromarray(flat, "RGB")
    top = image.crop((0, 0, width, split)).resize((width, TEMPLATE_WINDOW[3]), Image.LANCZOS)
    bottom = image.crop((0, split, width, image.height)).resize((width, height - TEMPLATE_WINDOW[3]), Image.LANCZOS)
    template = Image.new("RGB", TEMPLATE)
    template.paste(top, (0, 0))
    template.paste(bottom, (0, TEMPLATE_WINDOW[3]))
    # The art covers the window; white under it, as in the other templates.
    ImageDraw.Draw(template).rectangle(
        (TEMPLATE_WINDOW[0], TEMPLATE_WINDOW[1], TEMPLATE_WINDOW[2] - 1, TEMPLATE_WINDOW[3] - 1), fill="white")
    return template


def find_source(num):
    for folder in (SOURCES, CARDS):
        path = os.path.join(folder, f"{num}.jpg")
        if os.path.isfile(path):
            return path
    return None


def main():
    missing = [num for num in GODS if not find_source(num)]
    if missing:
        sys.exit(f"missing card scans for {missing}: expected {SOURCES}/<num>.jpg")

    device = pick_device()
    # The illustration model draws the art cleanest; the general one keeps the frames' texture.
    art_model, frame_model = load_model("anime", device), load_model("general", device)
    print(f"running on {device}")
    os.makedirs(os.path.join(ASSETS, "attributes"), exist_ok=True)
    icon_done = False
    for num, name in GODS.items():
        with Image.open(find_source(num)) as scan:
            if scan.size != SCAN:
                sys.exit(f"{num}.jpg is {scan.size}, expected {SCAN}: the cut positions would be wrong")
            art, big = upscale(art_model, device, scan), upscale(frame_model, device, scan)
        build_art(art).save(os.path.join(CARDS, f"{num}.png"), optimize=True)
        template = os.path.join(ASSETS, "textures", f"god{name}Template.png")
        build_template(big, debug=os.environ.get("GOD_DEBUG") and f"{os.environ['GOD_DEBUG']}/paint{num}.png").save(template, optimize=True)
        print(f"{num}: cards/{num}.png, textures/{os.path.basename(template)}")
        if not icon_done:
            build_icon(big).save(os.path.join(ASSETS, "attributes", "divine_attribute.png"), optimize=True)
            print("attributes/divine_attribute.png")
            icon_done = True
    print("now build the masks: uv run scripts/content/build_masks.py --force --model birefnet-dis --keep-holes --only "
          + ",".join(str(n) for n in GODS))


if __name__ == "__main__":
    main()
