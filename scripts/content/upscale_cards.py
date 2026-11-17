# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "torch>=2.2",
#   "spandrel>=0.4",
#   "pillow>=10",
#   "numpy>=1.26",
# ]
# ///
"""Upscales the card art sprites with Real-ESRGAN.

    uv run scripts/content/upscale_cards.py                  # every sprite in content/assets/cards
    uv run scripts/content/upscale_cards.py --size 256       # smaller files, still 2x sharper
    uv run scripts/content/upscale_cards.py --model general  # photo-style model instead of the illustration one
    uv run scripts/content/upscale_cards.py --force          # redo all of them from the backups

The sprites are 128x128. Each one is upscaled 4x with a model trained on
illustrations, then resized to --size (default 512) and written back over the
original, so the server and catalog keep the same paths. The original is kept
in content/assets/cards/original/ first, and upscaling always starts from that
copy, so running this again never upscales an upscale.

Only sprites smaller than --size are touched unless --force is given; a sprite
that import_assets.sh copied in again is picked up as a fresh original.
Runs on the GPU (Apple MPS or CUDA) when there is one. The first run downloads
the model (~18 MB anime, ~64 MB general) into ~/.cache/duelist-upscale.
"""
import argparse
import os
import shutil
import sys
import urllib.request

import numpy as np
import torch
from PIL import Image
from spandrel import ImageModelDescriptor, ModelLoader

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEFAULT_DIR = os.path.join(ROOT, "content", "assets", "cards")
BACKUP = "original"
CACHE = os.path.expanduser("~/.cache/duelist-upscale")
MODELS = {
    # Illustrated and anime art: clean lines, flat shading. Suits card art best.
    "anime": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
    # General purpose: keeps more texture, can look noisier on line art.
    "general": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
}


def is_sprite(name):
    base, ext = os.path.splitext(name)
    return ext.lower() == ".png" and base.isdigit()


def load_model(name, device):
    os.makedirs(CACHE, exist_ok=True)
    url = MODELS[name]
    path = os.path.join(CACHE, os.path.basename(url))
    if not os.path.exists(path):
        print(f"downloading {os.path.basename(url)}...")
        urllib.request.urlretrieve(url, path + ".part")
        os.replace(path + ".part", path)
    model = ModelLoader().load_from_file(path)
    assert isinstance(model, ImageModelDescriptor), "not an image to image model"
    return model.to(device).eval()


def pick_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


@torch.inference_mode()
def upscale(model, device, image):
    array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(device)
    out = model(tensor).clamp(0, 1).squeeze(0).permute(1, 2, 0).cpu().numpy()
    return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGB")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", default=DEFAULT_DIR, help="folder of NNN.png sprites (default: content/assets/cards)")
    parser.add_argument("--size", type=int, default=512, help="output width and height in pixels (default 512)")
    parser.add_argument("--model", choices=sorted(MODELS), default="anime", help="Real-ESRGAN model (default anime)")
    parser.add_argument("--force", action="store_true", help="redo sprites that are already upscaled, from their backups")
    parser.add_argument("--only", help="comma separated card numbers to do, e.g. --only 7,20,300")
    args = parser.parse_args()

    folder = os.path.abspath(args.folder)
    backup_dir = os.path.join(folder, BACKUP)
    os.makedirs(backup_dir, exist_ok=True)
    only = {int(n) for n in args.only.split(",") if n.strip()} if args.only else None

    todo = []
    for name in sorted(os.listdir(folder)):
        if not is_sprite(name) or (only is not None and int(name[:-4]) not in only):
            continue
        path, backup = os.path.join(folder, name), os.path.join(backup_dir, name)
        with Image.open(path) as image:
            small = image.width < args.size
        if small:
            # A sprite below the target size is an original (new, or re-imported): back it up.
            shutil.copy2(path, backup)
            todo.append(name)
        elif args.force and os.path.exists(backup):
            todo.append(name)

    print(f"{len(todo)} sprites to upscale to {args.size}px with the {args.model} model")
    if not todo:
        return

    device = pick_device()
    model = load_model(args.model, device)
    print(f"running on {device}")
    failed = 0
    for i, name in enumerate(todo, 1):
        try:
            with Image.open(os.path.join(backup_dir, name)) as original:
                big = upscale(model, device, original)
            if big.width != args.size:
                big = big.resize((args.size, args.size), Image.LANCZOS)
            tmp = os.path.join(folder, name + ".tmp")
            big.save(tmp, "PNG", optimize=True)
            os.replace(tmp, os.path.join(folder, name))
            if i % 25 == 0 or i == len(todo):
                print(f"[{i}/{len(todo)}] {name}")
        except Exception as error:
            failed += 1
            print(f"[{i}/{len(todo)}] {name}: FAILED {error}", file=sys.stderr)

    print(f"done: {len(todo) - failed} upscaled" + (f", {failed} failed" if failed else "") + f"; originals in {backup_dir}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
