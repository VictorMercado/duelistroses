import { Canvas } from "@react-three/fiber";
import { useGameStore } from "@/stores/gameStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function HandView() {
  const isMobile = useIsMobile();
  const gameStore = useGameStore();
  const handSelectedIndex = useGameStore((state) => state.handSelectedIndex);
  
  // if (!gameStore.showHand) return null;
  // Position cards in a horizontal arc
  const cardSpacing = .8;
  const totalWidth = (gameStore.handCards.length - 1) * cardSpacing;
  const startX = -(totalWidth / 2);
  const baseY = 0;  // Centered vertically in the new view
  const baseZ = 0;   
  const scale = isMobile ? 1.2 : 2.3; // Adjusted scale for new view

  return (
    <div className={`fixed bottom-1/2 translate-y-1/2 left-0 w-full h-1/3 z-40 bg-black/90 border-t border-white/20 transition-opacity duration-200 ${gameStore.showHand ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} style={{ pointerEvents: gameStore.showHand ? 'auto' : 'none' }}>
        <ambientLight intensity={2} />
        <pointLight position={[5, 5, 5]} intensity={3} />
        
        <group rotation={[0, 0, 0]} scale={scale} position={[0, 0, 0]}>
          {gameStore.handCards.map((card, index) => {
            const xPosition = startX + (index * cardSpacing);
            const isSelected = handSelectedIndex === index;
            
            // Create a hand version of the card with custom position
            const handCard = {
              ...card,
              position: new Vector3(xPosition, baseY, baseZ),
              isFaceDown: false,
              isDefenseMode: false,
            };

            return (
              <YugiohCard
                key={`hand-${card.id}`}
                card={handCard}
                isHandSelected={isSelected}
                isPreview={true}
                onSelect={() => {
                  useGameStore.getState().setHandSelectedIndex(index);
                }}
              />
            );
          })}
        </group>
      </Canvas>
    </div>
  );
}
