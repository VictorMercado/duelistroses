import { useGameStore } from "@/stores/gameStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";
import { useInputStore } from "@/stores/inputStore";

export default function HandView() {
  const handCards = useGameStore((state) => state.handCards);
  const showHand = useGameStore((state) => state.showHand);
  const selectTilePiece = useInputStore((state) => state.selectTilePiece);

  if (!showHand) return null;

  // Position cards in a horizontal arc
  const cardSpacing = .8;
  const totalWidth = (handCards.length - 1) * cardSpacing;
  const startX = -(totalWidth / 2);
  const baseY = .5;  // Below the board
  const baseZ = 2;   // Raised toward camera

  return (
    <group rotation={[-.5, 0, 0]} scale={2}>
      {handCards.map((card, index) => {
        const xPosition = startX + (index * cardSpacing);
        
        // Create a hand version of the card with custom position
        const handCard = {
          ...card,
          position: new Vector3(xPosition, baseY, baseZ),
          isFaceDown: false,  // Always show face up in hand
          isDefenseMode: false,
        };

        return (
          <YugiohCard
            key={`hand-${card.id}`}
            card={handCard}
            isSelected={false}
            isPreview={true}  // Use preview mode to prevent rotation/movement
            onSelect={() => {
              // trigger card details view
              selectTilePiece(handCard);
            }}
          />
        );
      })}
    </group>
  );
}
