import { useGameStore } from "@/stores/gameStore";
import YugiohCard from "./YugiohCard";
import { Vector3 } from "three";
import { View, PerspectiveCamera } from "@react-three/drei";

export default function SummonCardPreview() {
  const summoningState = useGameStore((state) => state.summoningState);
  const handCards = useGameStore((state) => state.handCards);

  if (!summoningState || summoningState.phase !== 'confirm' || !summoningState.selectedCardId) {
    return null;
  }

  const card = handCards.find(c => c.id === summoningState.selectedCardId);
  if (!card) return null;

  // Create a preview version of the card
  const previewCard = {
    ...card,
    position: new Vector3(0, 0, 0),
    isFaceDown: false,
    isDefenseMode: false,
  };

  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none w-[32rem] h-[40rem]">
      <View className="w-full h-full">
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial color="black" transparent opacity={0.8} />
        </mesh>
        <ambientLight intensity={2} />
        <pointLight position={[5, 5, 5]} intensity={3} />
        <PerspectiveCamera makeDefault position={[0, 0, 3.5]} fov={45} />

        <group rotation={[0, 0, 0]} scale={2}>
          {/* Render the card */}
          <YugiohCard
            card={previewCard}
            isPreview={true}
            onSelect={() => { }}
          />
        </group>
      </View>
    </div>
  );
}
