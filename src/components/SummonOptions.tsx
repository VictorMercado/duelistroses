import { Text } from "@react-three/drei";
import { useGameStore } from "@/stores/gameStore";
import { useInputStore } from "@/stores/inputStore";

export const SUMMON_OPTIONS = [
  { label: "Face Up Attack", isFaceDown: false, isDefenseMode: false },
  { label: "Face Down Attack", isFaceDown: true, isDefenseMode: false },
  { label: "Face Up Defense", isFaceDown: false, isDefenseMode: true },
  { label: "Face Down Defense", isFaceDown: true, isDefenseMode: true },
];

export default function SummonOptions() {
  const summoningState = useGameStore((state) => state.summoningState);
  const summonOptionIndex = useInputStore((state) => state.summonOptionIndex);

  if (!summoningState.active || summoningState.phase !== 'position') return null;

  return (
    <group position={[0, 2, 5]} rotation={[-.5, 0, 0]}> 
      {/* Background Panel - Optional, maybe just floating text is cleaner? 
          Let's add a slight backing so it is readable. */}
      <mesh position={[0, -0.5, -0.1]}>
          <planeGeometry args={[4, 2]} />
          <meshBasicMaterial color="black" transparent opacity={0.8} />
      </mesh>
    
      <Text
        position={[0, 0, 0]}
        fontSize={0.2}
        color="white"
        anchorX="center"
        anchorY="middle"
        font="/fonts/UtopiaStd-Subh.otf"
      >
        Select Battle Position
      </Text>

      {SUMMON_OPTIONS.map((option, index) => {
        const isSelected = index === summonOptionIndex;
        const yPos = -0.4 - (index * 0.3);
        
        return (
          <group key={option.label} position={[0, yPos, 0]}>
             {/* Highlight Indicator */}
             {isSelected && (
                 <mesh position={[-0.8, 0, 0]}>
                     <planeGeometry args={[0.1, 0.1]} />
                     <meshBasicMaterial color="#00aaff" />
                 </mesh>
             )}
            <Text
              fontSize={0.15}
              color={isSelected ? "#00aaff" : "white"}
              anchorX="center"
              anchorY="middle"
              font="/fonts/UtopiaStd-Subh.otf"
            >
              {option.label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
