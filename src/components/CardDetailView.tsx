import type { Card } from "@/types";

import { Canvas } from "@react-three/fiber";
import { Vector3 } from "three";
import YugiohCard from "./YugiohCard";

interface CardDetailViewProps {
  card: Card;
  onClose: () => void;
}

export default function CardDetailView({ card, onClose }: CardDetailViewProps) {
  // Create a preview version of the card that is always face up and centered
  const previewCard: Card = {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: false,
    isDefenseMode: false,
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
      <div className="bg-gray-900 text-white w-[60%] h-[70%] rounded-2xl shadow-2xl border border-white/10 flex overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold z-10"
        >
          ✕
        </button>
        
        {/* Left Side: 3D Card Preview */}
        <div className="w-1/2 bg-gray-800 flex items-center justify-center border-r border-white/10 relative">
            <Canvas camera={{ position: [0, 0, 2], fov: 45 }}>
                <ambientLight intensity={1} />
                <pointLight position={[5, 5, 5]} intensity={2} />
                <YugiohCard 
                    card={previewCard} 
                    isSelected={false} 
                    onSelect={() => {}} 
                />
            </Canvas>
        </div>

        {/* Right Side: Details */}
        <div className="w-1/2 p-8 flex flex-col">
          <h2 className="text-4xl font-bold mb-2 text-yellow-500">{card.name}</h2>
          <div className="text-sm text-gray-400 mb-6 uppercase tracking-wider">
            {card.owner === 'player' ? 'Your Card' : 'Opponent Card'}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            {
              card.attack !== -1 && (
                <>
                  <div className="bg-red-900/30 p-4 rounded-lg border border-red-500/20">
                    <div className="text-red-400 text-xs uppercase font-bold">Attack</div>
                    <div className="text-2xl font-mono">{card.attack}</div>
                  </div>
                  <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500/20">
                    <div className="text-blue-400 text-xs uppercase font-bold">Defense</div>
                    <div className="text-2xl font-mono">{card.defense}</div>
                  </div>
                </>
              )
            }
          </div>

          <div className="flex-grow">
            <h3 className="text-lg font-bold mb-2 border-b border-white/10 pb-1">Description</h3>
            <p className="text-gray-300 leading-relaxed">
              {card.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
