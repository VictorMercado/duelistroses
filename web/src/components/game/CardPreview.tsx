import { isCard, type Card } from "@/types";
import { View, PerspectiveCamera } from "@react-three/drei";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { useGameStore } from "@/stores/gameStore";
import { gameManager } from "@/game/gameManager";
import { isCardAnonymous, useViewerOwner } from "@/game/visibility";

interface CardPreviewProps {
}

export default function CardPreview({ }: CardPreviewProps) {
  const selectedTilePiece = useGameStore(state => state.selectedTilePiece);
  const viewerSide = useViewerOwner();

  const hasSelection = selectedTilePiece && isCard(selectedTilePiece);
  const card = hasSelection ? (selectedTilePiece as Card) : null;
  // Somebody else's face-down card previews as the mystery card.
  const isAnonymous = !!card && isCardAnonymous(card, viewerSide);

  const previewCard: Card | null = card ? {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: isAnonymous,
    isDefenseMode: false,
  } : null;

  if (!card) return null;

  return (
    <div
      className="absolute bottom-26 md:bottom-2 right-6 w-24 h-32 lg:w-48 lg:h-64 3xl:w-64 3xl:h-80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl"
      onClick={() => {
        gameManager.toggleDetails();
      }}
    >
      <View className="w-full h-full">
        {/* Semi-transparent background plane */}
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial color="black" transparent opacity={0.8} />
        </mesh>
        <ambientLight intensity={0.5} />
        <pointLight position={[5, 5, 5]} intensity={0.2} />
        <PerspectiveCamera makeDefault position={[0, 0, 1.3]} fov={45} />
        {previewCard && (
          <YugiohCard
            card={previewCard}
            onSelect={() => { }}
            isPreview={true}
          />
        )}
      </View>
    </div>
  );
}
