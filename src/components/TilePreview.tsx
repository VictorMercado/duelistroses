import { useUIStore } from "@/stores/uiStore";
import { getCachedTexture } from "@/hooks/usePreloadTextures";
import { useMemo } from "react";

interface TilePreviewProps {
}

export default function TilePreview({ }: TilePreviewProps) {
  const selectedTile = useUIStore((state) => state.selectedTile);
  
  // Get cached image or fall back to direct URL
  const imageUrl = useMemo(() => {
    if (!selectedTile) return '';
    
    const cachedImg = getCachedTexture(selectedTile.type);
    if (cachedImg && cachedImg.complete) {
      // Use the cached image's src (it's already loaded)
      return cachedImg.src;
    }
    
    // Fallback to direct URL if not cached yet
    return `/textures/${selectedTile.type}.png`;
  }, [selectedTile]);

  if (!selectedTile) return null;

  return (
    <div className="absolute bottom-4 left-4 w-64 h-80 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl">
      <div className="h-full flex flex-col">
        {/* 3D Texture Preview */}
        <div className="flex-1 bg-gray-900 flex items-center justify-center relative">
          <img 
            key={selectedTile.type}
            src={imageUrl}
            alt={selectedTile.name}
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
          />
        </div>
        
        {/* Tile Info */}
        <div className="p-4 bg-gradient-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700">
          <h3 className="text-xl font-bold text-yellow-500 mb-1">{selectedTile.name}</h3>
        </div>
      </div>
    </div>
  );
}
