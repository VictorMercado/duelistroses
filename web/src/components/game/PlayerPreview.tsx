
import { View, PerspectiveCamera } from "@react-three/drei";
import { Vector3 } from "three";
import PlayerEmblem from "@/components/game/PlayerEmblem";
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

  if (!player) return null;

  return (
    <div
      className="absolute bottom-26 md:bottom-2 right-6 w-24 h-32 lg:w-48 lg:h-64 3xl:w-64 3xl:h-80 flex flex-col rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl"
    >
      {/* 3D Preview */}
      <View className="grow w-full">
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial color="black" transparent opacity={0.8} />
        </mesh>
        <ambientLight intensity={1} />
        <pointLight position={[5, 5, 5]} intensity={2} />
        <PerspectiveCamera makeDefault position={[0, 0, 1.3]} fov={45} />
        {previewPlayer && (
          <PlayerEmblem
            player={previewPlayer}
            onSelect={() => { }}
            preview
          />
        )}
      </View>

      {/* Name and Details */}
      <div className="p-1 lg:p-4 bg-linear-to-b from-gray-800 to-gray-900 border-t-2 border-yellow-700 z-10 relative">
        <h3 className="text-sm lg:text-xl font-bold text-yellow-500 mb-1">
          {player.name}
        </h3>
      </div>
    </div>
  );
}
