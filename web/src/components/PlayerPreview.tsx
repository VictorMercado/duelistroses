
import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import PlayerEmblem from "./PlayerEmblem";
import { isPlayer, type Player } from "@/types";
import { useGameStore } from "@/stores/gameStore";

export default function PlayerPreview() {
  const selectedTilePiece = useGameStore(state => state.selectedTilePiece);
  
  const hasSelection = selectedTilePiece && isPlayer(selectedTilePiece);
  const player = hasSelection ? (selectedTilePiece as Player) : null;

  // Create a preview version of the player that is centered
  const previewPlayer: Player | null = player ? {
    ...player,
    position: new Vector3(0, 0, 0),
  } : null;

  return (
    <div 
      className={`absolute bottom-26 md:bottom-2 right-6 w-24 h-32 lg:w-48 lg:h-64 2xl:w-64 2xl:h-80 bg-black/80 flex flex-col rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl transition-opacity duration-200 ${hasSelection ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      {/* 3D Preview */}
      <Canvas style={{ pointerEvents: 'none' }} aria-label="Player Preview" camera={{ position: [0, 0, 1.3], fov: 45 }}>
        <ambientLight intensity={1} />
        <pointLight position={[5, 5, 5]} intensity={2} />
        {previewPlayer && (
          <PlayerEmblem 
              player={previewPlayer}
              onSelect={() => {}}
              preview
          />
        )}
      </Canvas>
      
      {/* Name and Details */}
      {player ? (
        <div className="p-1 lg:p-4 bg-gradient-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700">
          <h3 className="text-sm lg:text-xl font-bold text-yellow-500 mb-1">
            {player.name}
          </h3>
        </div>
      ) : null}
    </div>
  );
}
