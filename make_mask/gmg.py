import sys
import os
import io
import mimetypes
from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv  # <--- IMPORT THIS
from rembg import remove, new_session

# Load environment variables from .env file
load_dotenv()
# --- CONFIGURATION ---
# You can change this to "gemini-2.0-flash-exp" if the preview model is unavailable
MODEL_NAME = "gemini-3-pro-image-preview" 

def create_mask_with_gemini(input_path, output_path):
    print(f"🔮 Processing: {input_path}...")

    # 1. Check for API Key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("❌ Error: GEMINI_API_KEY environment variable not set.")
        return

    try:
        # 2. Load the local image data to send to Google
        with open(input_path, "rb") as f:
            image_bytes = f.read()

        # 3. Initialize Google Client
        client = genai.Client(api_key=api_key)

        print(f"   - 🚀 Sending to Google ({MODEL_NAME}) to remove background...")

        # 4. Prepare the Request
        # We send the image bytes AND a text prompt instructing the model
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(
                        data=image_bytes, 
                        mime_type="image/jpeg" if input_path.lower().endswith(('.jpg', '.jpeg')) else "image/png"
                    ),
                    types.Part.from_text(text="Generate a copy of this image but remove the background. The background must be transparent."),
                ],
            ),
        ]

        generate_content_config = types.GenerateContentConfig(
            response_modalities=["IMAGE"], # Force image output
            image_config=types.ImageConfig(
                image_size="1K", 
            ),
        )

        # 5. Stream/Fetch Response
        generated_image_data = None
        
        # We loop through the stream to find the image bytes
        for chunk in client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=contents,
            config=generate_content_config,
        ):
            # Safety checks for empty chunks
            if (chunk.candidates is None or 
                chunk.candidates[0].content is None or 
                chunk.candidates[0].content.parts is None):
                continue

            # Check if this part contains inline image data
            part = chunk.candidates[0].content.parts[0]
            if part.inline_data and part.inline_data.data:
                generated_image_data = part.inline_data.data
                break # We found the image, stop the loop

        if not generated_image_data:
            print("❌ Error: Google did not return an image.")
            return

        # 6. Process the result with Pillow (Make the Mask)
        print("   - 🎭 Converting Google's response to shine mask...")
        
        # Open the image from Google
        img_from_google = Image.open(io.BytesIO(generated_image_data)).convert("RGBA")

        # --- ADDED: Run Rembg on the Google Output ---
        # We use a session optimized for anime/drawings since it's a card
        # If you don't want to download the model, you can remove `session=...`
        session = new_session("isnet-anime") 
        img_transparent = remove(img_from_google, session=session)
        # ---------------------------------------------

        print("   - 🎭 Converting transparency to shine mask...")

        # 7. Extract Alpha Channel from the Rembg result
        alpha_channel = img_transparent.getchannel("A")
        
        # Create Mask: White = Subject, Black = Background
        mask = alpha_channel.point(lambda p: 255 if p > 10 else 0)
        mask = mask.convert("L")
        mask.save(output_path)
        
        print(f"✅ Success! Mask saved to: {output_path}")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    # Command Line Arguments
    if len(sys.argv) < 3:
        print("Usage: python generate_mask_gemini.py <input_image> <output_mask_name>")
        print("Example: python generate_mask_gemini.py blue_eyes.jpg blue_eyes_mask.png")
    else:
        input_file = sys.argv[1]
        output_file = sys.argv[2]
        
        if os.path.exists(input_file):
            create_mask_with_gemini(input_file, output_file)
        else:
            print("Error: Input file not found.")