import { isCard, type Card } from "@/types";

import { useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Vector3, Group } from "three";
import YugiohCard from "@/components/YugiohCard";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { useGameStore } from "@/stores/gameStore";
import { gameManager } from "@/game/gameManager";

interface CardDetailViewProps {
}

function CardTilter({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);

  useFrame((state) => {
    if (group.current) {
      const { x, y } = state.pointer;
      // Tilt based on mouse position
      // X mouse moves rotates around Y axis
      // Y mouse moves rotates around X axis
      const targetRotationX = -y * 0.5; // Max tilt up/down
      const targetRotationY = x * 0.5;  // Max tilt left/right

      group.current.rotation.x += (targetRotationX - group.current.rotation.x) * 0.1;
      group.current.rotation.y += (targetRotationY - group.current.rotation.y) * 0.1;
    }
  });

  return <group ref={group}>{children}</group>;
}

export default function CardDetailView({ }: CardDetailViewProps) {
  const setShowDetails = useUIStore((state) => state.setShowDetails);
  const inputStore = useInputStore();
  const gameStore = useGameStore();
  

  const isHandOpen = gameStore.showHand || (gameStore.summoningState && gameStore.summoningState.phase === 'card');
  const handCard = isHandOpen && inputStore.handSelectedIndex >= 0 
    ? gameStore.handCards[inputStore.handSelectedIndex] 
    : null;

  const hasSelection = gameManager.selectedTilePiece && isCard(gameManager.selectedTilePiece);
  const card = handCard || (hasSelection ? (gameManager.selectedTilePiece as Card) : null);
  const isOpponentFaceDown = card && card.owner === 'opponent' && card.isFaceDown;

  // Create a preview version of the card that is always face up and centered
  const previewCard: Card | null = card ? {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: !!isOpponentFaceDown,
    isDefenseMode: false,
  } : null;

  const handleCloseDetailView = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setShowDetails(false);
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleCloseDetailView);
    return () => {
      document.removeEventListener('keydown', handleCloseDetailView);
    };
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 w-full">
      <div className="bg-gray-900 text-white w-full xl:w-[70%] h-[70%] rounded-2xl shadow-2xl border border-white/10 flex overflow-hidden relative">
        <button
          onClick={() => setShowDetails(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold z-10"
        >
          ✕
        </button>
        
        {/* Left Side: 3D Card Preview */}
        <div className={`w-1/2 lg:w-1/2 bg-gray-800 flex items-center justify-center border-r border-white/10 relative `}>
          <Canvas camera={{ position: [0, 0, 2], fov: 45 }}>
              <ambientLight intensity={1} />
              <pointLight position={[5, 5, 5]} intensity={2} />
              {previewCard && (
                <CardTilter>
                  <YugiohCard 
                      card={previewCard} 
                      isSelected={false} 
                      onSelect={() => {}} 
                      isPreview={true}
                  />
                </CardTilter>
              )}
          </Canvas>
        </div>

        {/* Right Side: Details */}
        <div className="w-1/2 p-8 flex flex-col">
          <h2 className="text-4xl font-bold mb-2">
            {isOpponentFaceDown ? '????' : card?.name}
          </h2>
          <div className="flex gap-2">
            <div className="text-sm text-gray-400 mb-6 uppercase tracking-wider">
              {card?.type}
            </div>
            <div className="text-sm text-gray-400 mb-6 uppercase tracking-wider font-bold" style={{ color: card?.rarity === 'common' ? 'inherit' : '#ffbb00' }}>
              {card?.rarity}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            {
              card?.attack !== -1 && (
                <>
                  <div className="bg-red-900/30 p-4 rounded-lg border border-red-500/20">
                    <div className="text-red-400 text-xs uppercase font-bold">Attack</div>
                    <div className="text-2xl font-mono">{isOpponentFaceDown ? '????' : card?.attack}</div>
                  </div>
                  <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500/20">
                    <div className="text-blue-400 text-xs uppercase font-bold">Defense</div>
                    <div className="text-2xl font-mono">{isOpponentFaceDown ? '????' : card?.defense}</div>
                  </div>
                </>
              )
            }
          </div>

          <div className="flex-grow">
            <h3 className="text-lg font-bold mb-2 border-b border-white/10 pb-1">Description</h3>
            <p className="text-gray-300 leading-relaxed">
              {isOpponentFaceDown ? '????' : card?.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
