
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
      className={`absolute bottom-26 right-4 w-24 h-32 lg:w-80 lg:h-96 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl transition-opacity duration-200 ${hasSelection ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      {/* 3D Preview */}
      <Canvas style={{ pointerEvents: 'none' }} aria-label="Player Preview" camera={{ position: [0, 0, 2], fov: 45 }}>
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
        <div className="absolute bottom-25 w-full flex flex-col items-center space-y-2 pointer-events-auto">
           {/* Player Name */}
           <div className="text-white font-bold text-sm drop-shadow-md">
            {player.name}
          </div>
        </div>
      ) : null}
    </div>
  );
}
