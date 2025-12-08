import { useGameStore } from "@/stores/gameStore";
import { useInputStore } from "@/stores/inputStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";
import { SUMMON_OPTIONS } from "./SummonOptions";

export default function SummonCardPreview() {
  const summoningState = useGameStore((state) => state.summoningState);
  const handCards = useGameStore((state) => state.handCards);
  const summonOptionIndex = useInputStore((state) => state.summonOptionIndex);

  if (!summoningState.active || summoningState.phase !== 'position' || !summoningState.selectedCardId) {
    return null;
  }

  const card = handCards.find(c => c.id === summoningState.selectedCardId);
  if (!card) return null;

  // Determine Visual State based on Option Index
  const option = SUMMON_OPTIONS[summonOptionIndex];
  
  // Create a preview version of the card
  const previewCard = {
    ...card,
    position: new Vector3(0, 5, 8), // Adjusted for rotated group (Y=Up)
    isFaceDown: option.isFaceDown,
    isDefenseMode: option.isDefenseMode,
  };

  return (
    <group rotation={[-0.05, 0,0]}>
        {/* Render the card */}
        <YugiohCard
            card={previewCard}
            isSelected={false} // No border needed here as it's the only thing focused? Or maybe yes? User asked for "middle position... switch its position".
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
