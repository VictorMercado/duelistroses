import sys
import os
from PIL import Image

def create_mask_from_transparent(input_path, output_path):
    print(f"Processing: {input_path}...")

    try:
        # 1. Open the image and ensure it has an Alpha channel (RGBA)
        img = Image.open(input_path).convert("RGBA")

        # 2. Extract just the Alpha (Transparency) layer
        # In a transparent PNG: 0 = Transparent, 255 = Opaque (The Subject)
        alpha_channel = img.getchannel("A")

        # 3. Create the Mask
        # Logic: If pixel is visible (Alpha > 0), make it WHITE (255).
        #        If pixel is transparent (Alpha == 0), make it BLACK (0).
        # We use a small threshold (10) just in case there are semi-transparent ghost pixels.
        mask = alpha_channel.point(lambda p: 255 if p > 10 else 0)

        # 4. Convert to Grayscale (L) to save space and save
        mask = mask.convert("L")
        mask.save(output_path)
        
        print(f"✅ Success! Mask saved to: {output_path}")

    except Exception as e:
        print(f"❌ Error processing {input_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python make_mask_simple.py <input_png> <output_mask_name>")
        print("Example: python make_mask_simple.py blue_eyes_transparent.png blue_eyes_mask.png")
    else:
        input_file = sys.argv[1]
        output_file = sys.argv[2]
        
        if os.path.exists(input_file):
            create_mask_from_transparent(input_file, output_file)
        else:
            print("Error: Input file not found.")