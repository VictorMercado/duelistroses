import type { Card } from "@/types";
import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";

interface CardPreviewProps {
  card: Card;
}

export default function CardPreview({ card }: CardPreviewProps) {
  // Create a preview version of the card that is always face up and centered
  const previewCard: Card = {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: false, // Correct orientation for preview (Face Up)
    isDefenseMode: false,
  };

  return (
    <div className="absolute bottom-4 right-4 w-80 h-96 bg-black/80 rounded-xl border-2 border-yellow-700 overflow-hidden shadow-2xl pointer-events-none">
      <Canvas camera={{ position: [0, 0, 1.5], fov: 45 }}>
        <ambientLight intensity={1} />
        <pointLight position={[5, 5, 5]} intensity={2} />
        <YugiohCard 
            card={previewCard} 
            isSelected={false} 
            onSelect={() => {}} 
        />
      </Canvas>
    </div>
  );
}
