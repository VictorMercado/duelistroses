import type { Card } from "@/types";
import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";

interface CardPreviewProps {
  card: Card;
  onViewDetails: () => void;
}

export default function CardPreview({ card, onViewDetails }: CardPreviewProps) {
  // Create a preview version of the card that is always face up and centered
  const previewCard: Card = {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: false, // Correct orientation for preview (Face Up)
    isDefenseMode: false,
  };

  return (
    <div className="absolute bottom-4 right-4 w-80 h-96 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl">
      <Canvas camera={{ position: [0, 0, 1.5], fov: 45 }}>
        <ambientLight intensity={1} />
        <pointLight position={[5, 5, 5]} intensity={2} />
        <YugiohCard 
            card={previewCard} 
            isSelected={false} 
            onSelect={() => {}} 
        />
      </Canvas>
      
      {
        card.owner === 'player' ? (
          //  View Details Button
          <button
            onClick={onViewDetails}
            className="absolute bottom-2 left-1/2 transform -translate-x-1/2 px-4 bg-yellow-700 hover:bg-yellow-600 text-white font-bold rounded-lg border-2 border-yellow-500 transition-colors shadow-lg"
          >
            View Details
          </button>
        ) : null
      }
    </div>
  );
}
