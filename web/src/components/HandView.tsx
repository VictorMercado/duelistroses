import { useGameStore } from "@/stores/gameStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";

export default function HandView() {
  const gameStore = useGameStore();
  const handSelectedIndex = useGameStore((state) => state.handSelectedIndex);
  
  if (!gameStore.showHand) return null;
  // Position cards in a horizontal arc
  const cardSpacing = .8;
  const totalWidth = (gameStore.handCards.length - 1) * cardSpacing;
  const startX = -(totalWidth / 2);
  const baseY = .5;  // Below the board
  const baseZ = 2;   // Raised toward camera

  return (
    <group rotation={[-.5, 0, 0]} scale={2}>
      {gameStore.handCards.map((card, index) => {
        const xPosition = startX + (index * cardSpacing);
        const isSelected = handSelectedIndex === index;
        
        // Create a hand version of the card with custom position
        const handCard = {
          ...card,
          position: new Vector3(xPosition, baseY, baseZ), // Keep flat z-index
          isFaceDown: false,  // Always show face up in hand
          isDefenseMode: false,
        };

        return (
          <YugiohCard
            key={`hand-${card.id}`}
            card={handCard}
            isHandSelected={isSelected}
            isPreview={true}  // Use preview mode to prevent rotation/movement
            onSelect={() => {
              // Mouse selection support
              useGameStore.getState().setHandSelectedIndex(index);
            }}
          />
        );
      })}
    </group>
  );
}
