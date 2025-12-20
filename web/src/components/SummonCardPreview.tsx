import { useGameStore } from "@/stores/gameStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";

export default function SummonCardPreview() {
  const summoningState = useGameStore((state) => state.summoningState);
  const handCards = useGameStore((state) => state.handCards);

  if (!summoningState|| summoningState.phase !== 'confirm' || !summoningState.selectedCardId) {
    return null;
  }

  const card = handCards.find(c => c.id === summoningState.selectedCardId);
  if (!card) return null;

  // Create a preview version of the card
  const previewCard = {
    ...card,
    position: new Vector3(0, -0.3, 12), // Adjusted for rotated group (Y=Up)
    isFaceDown: false,
    isDefenseMode: false,
  };

  return (
    <group rotation={[-Math.PI/5, 0, 0]}>
        {/* Render the card */}
        <YugiohCard
            card={previewCard}

            isPreview={true}
            onSelect={() => {}}
        />
        
        {/* Render Instruction Text below? Or rely on SummonOptions overlay? 
            The user said "SummonOptions did not appear". 
            I'll rely on SummonOptions component to show the text, which sits at [0, -2, 2].
            This card is at [0, -1, 3] which is closer to camera.
            SummonOptions is at Z=2, Card at Z=3.
            If SummonOptions text is standard text, it might be occluded if behind?
            No, Z=3 is closer than Z=2. So Card is in front.
            SummonOptions text at [0, -2, 2] should be visible below the card.
         */}
    </group>
  );
}
