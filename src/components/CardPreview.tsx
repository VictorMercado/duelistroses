import { isCard, type Card } from "@/types";
import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { useInputStore } from "@/stores/inputStore";
import { useUIStore } from "@/stores/uiStore";
import { Key } from "./Key";

interface CardPreviewProps {
}

export default function CardPreview({ }: CardPreviewProps) {
  // Create a preview version of the card that is always face up and centered
  const uiStore = useUIStore();
  const inputStore = useInputStore();
  
  const hasSelection = inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece);
  const card = hasSelection ? (inputStore.selectedTilePiece as Card) : null;

  const isOpponentFaceDown = card && card.owner === 'opponent' && card.isFaceDown;
  
  const previewCard: Card | null = card ? {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: !!isOpponentFaceDown, 
    isDefenseMode: false,
  } : null;

  return (
    <div 
      className={`absolute bottom-4 right-4 w-80 h-96 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl transition-opacity duration-200 ${hasSelection ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      <Canvas style={{ pointerEvents: 'none' }} aria-label="Card Preview" camera={{ position: [0, 0, 1.5], fov: 45 }}>
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
      
      {card ? (
          //  View Details Button
          <button
            onClick={() => uiStore.setShowDetails(true)}
            className="w-[70%] absolute bottom-2 left-1/2 transform -translate-x-1/2 px-4 bg-yellow-700 hover:bg-yellow-600 text-white font-bold rounded-lg border-2 border-yellow-500 transition-colors shadow-lg space-x-4 flex items-center justify-center"
          >
            {uiStore.showKeyBindings && <Key size="sm">{inputStore.keyBindings.viewDetails}</Key>} <span>View Details</span>
          </button>
        ) : null
      }
    </div>
  );
}
