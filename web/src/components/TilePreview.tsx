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

  // The terrain carries the only correct URL: it is ASSET_URL aware, so it
  // points at public/ in dev and at the asset bucket in production.
  const imageUrl = displayTile?.terrain.textureUrl ?? '';

  if (!displayTile) return null;

  return (
    <div className="absolute bottom-26 md:bottom-2 left-6 w-24 h-32 lg:w-48 lg:h-64 3xl:w-64 3xl:h-80 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl">
        <div className="h-full flex flex-col">
          {/* 3D Texture Preview */}
          <div className="flex-1 bg-gray-900 flex items-center justify-center relative">
            <img
              src={imageUrl}
              alt={displayTile.terrain.name}
              /* Same CORS mode as the three.js loader, otherwise the browser
                 keeps a second cache entry and re-downloads every texture. */
              crossOrigin="anonymous"
              className="w-full h-full object-cover"
              decoding="async"
            />
          </div>
          
          {/* Tile Info */}
          <div className="p-1 lg:p-4 bg-linear-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700">
            <h3 className="text-sm lg:text-xl font-bold text-yellow-500 mb-1">{displayTile.terrain.name}</h3>
          </div>
        </div>
      </div>
  );
}
