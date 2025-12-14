import { isCard, type Card } from "@/types";
import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { useGameStore } from "@/stores/gameStore";

interface CardPreviewProps {
}

export default function CardPreview({ }: CardPreviewProps) {
  const selectedTilePiece = useGameStore(state => state.selectedTilePiece);
  
  const hasSelection = selectedTilePiece && isCard(selectedTilePiece);
  const card = hasSelection ? (selectedTilePiece as Card) : null;
  const isOpponentFaceDown = card && card.owner === 'opponent' && card.isFaceDown;
  
  const previewCard: Card | null = card ? {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: !!isOpponentFaceDown, 
    isDefenseMode: false,
  } : null;

  return (
    <div 
      className={`absolute bottom-4 right-4 w-24 h-32 lg:w-80 lg:h-96 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl transition-opacity duration-200 ${hasSelection ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      <Canvas style={{ pointerEvents: 'none' }} aria-label="Card Preview" camera={{ position: [0, 0, 1.3], fov: 45 }}>
        <ambientLight intensity={1} />
        <pointLight position={[5, 5, 5]} intensity={2} />
        {previewCard && (
          <YugiohCard 
              card={previewCard}
              isSelected={false}
              onSelect={() => {}}
              isPreview={true}
          />
        )}
      </Canvas>
    </div>
  );
}
