import type { Tile } from "@/types";

interface TilePreviewProps {
  tile: Tile;
}

export default function TilePreview({ tile }: TilePreviewProps) {
  return (
    <div className="absolute bottom-4 left-4 w-64 h-80 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl">
      <div className="h-full flex flex-col">
        {/* 3D Texture Preview */}
        <div className="flex-1 bg-gray-900 flex items-center justify-center relative">
          <img 
            src={`/textures/${tile.type}.png`}
            alt={tile.name}
            className="w-full h-full object-cover"
          />
        </div>
        
        {/* Tile Info */}
        <div className="p-4 bg-gradient-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700">
          <h3 className="text-xl font-bold text-yellow-500 mb-1">{tile.name}</h3>
        </div>
      </div>
    </div>
  );
}
