import { useEffect } from 'react';
import { TILE_TEXTURES } from '@/types';

// Module-level cache to keep images in memory
const textureCache = new Map<string, HTMLImageElement>();

// Preload a single texture
function preloadTexture(type: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      textureCache.set(type, img);
      console.log(`Loaded texture: ${type}`);
      resolve(img);
    };
    img.onerror = () => {
      console.error(`Failed to load texture: ${type}`);
      reject(new Error(`Failed to load ${type}`));
    };
    img.src = `/textures/${type}.png`;
  });
}

export function usePreloadTextures() {
  useEffect(() => {
    // Preload all tile textures
    const loadPromises = TILE_TEXTURES.map(type => preloadTexture(type));

    Promise.all(loadPromises)
      .then(() => {
        console.log('All tile textures preloaded and cached:', TILE_TEXTURES);
      })
      .catch(err => {
        console.error('Error preloading textures:', err);
      });
  }, []); // Only run once on mount
}

// Export getter for cached texture (optional, for future use)
export function getCachedTexture(type: string): HTMLImageElement | undefined {
  return textureCache.get(type);
}

