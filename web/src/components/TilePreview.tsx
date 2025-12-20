import { getCachedTexture } from "@/hooks/usePreloadTextures";
import { useMemo } from "react";
import { useGameStore } from "@/stores/gameStore";

interface TilePreviewProps {
}

export default function TilePreview({ }: TilePreviewProps) {
  const selectedTile = useGameStore(state => state.selectedTile);
  const cursorPosition = useGameStore(state => state.cursorPosition);
  const tiles = useGameStore(state => state.tiles);
  
  const displayTile = useMemo(() => {
    const tileAtCursor = tiles.find(
      t => Math.round(t.position.x) === cursorPosition.x && 
           Math.round(t.position.y) === cursorPosition.y
    );
    return tileAtCursor || selectedTile;
  }, [cursorPosition, tiles, selectedTile]);

  // Get cached image or fall back to direct URL
  const imageUrl = useMemo(() => {
    if (!displayTile) return '';
    
    const cachedImg = getCachedTexture(displayTile.terrain.type);
    if (cachedImg && cachedImg.complete) {
      // Use the cached image's src (it's already loaded)
      return cachedImg.src;
    }
    
    // Fallback to direct URL if not cached yet
    return `/textures/${displayTile.terrain.type}.png`;
  }, [displayTile]);

  if (!displayTile) return null;

  return (
    <div className="absolute bottom-4 left-4 w-24 h-32 lg:w-64 lg:h-80 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl">
        <div className="h-full flex flex-col">
          {/* 3D Texture Preview */}
          <div className="flex-1 bg-gray-900 flex items-center justify-center relative">
            <img 
              key={displayTile.terrain.type}
              src={imageUrl}
              alt={displayTile.terrain.name}
              className="w-full h-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
          
          {/* Tile Info */}
          <div className="p-1 lg:p-4 bg-gradient-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700">
            <h3 className="text-sm lg:text-xl font-bold text-yellow-500 mb-1">{displayTile.terrain.name}</h3>
          </div>
        </div>
      </div>
  );
}
