import { useEffect } from 'react';
import { TERRAINS } from '@/const';
import type { TerrainType, Terrain } from '@/types';

// Module-level cache to keep images in memory
const textureCache = new Map<TerrainType, HTMLImageElement>();

// Preload a single texture
function preloadTexture(terrain: Terrain): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      textureCache.set(terrain.type, img);
      console.log(`Loaded texture: ${terrain.type}`);
      resolve(img);
    };
    img.onerror = () => {
      console.error(`Failed to load texture: ${terrain.type}`);
      reject(new Error(`Failed to load ${terrain.type}`));
    };
    img.src = terrain.textureUrl;
  });
}

export function usePreloadTextures() {
  useEffect(() => {
    // Preload all tile textures
    const loadPromises = TERRAINS.map(terrain => preloadTexture(terrain));

    Promise.all(loadPromises)
      .then(() => {
        console.log('All tile textures preloaded and cached:', TERRAINS);
      })
      .catch(err => {
        console.error('Error preloading textures:', err);
      });
  }, []); // Only run once on mount
}

// Export getter for cached texture (optional, for future use)
export function getCachedTexture(type: TerrainType): HTMLImageElement | undefined {
  return textureCache.get(type);
}

