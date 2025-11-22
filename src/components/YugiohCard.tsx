import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, useTexture } from "@react-three/drei";
import { Vector3, Group } from "three";
import type { Card } from "@/types";

type CardPropType = {
  card: Card;
  isSelected: boolean;
  onSelect: () => void;
};

export default function YugiohCard({ card, isSelected, onSelect }: CardPropType) {
  const outerGroup = useRef<Group>(null);
  const innerGroup = useRef<Group>(null);
  
  const texture = useTexture(card.textureUrl);
  const attributeTexture = useTexture(card.attributeUrl);
  const yugiohCardTexture = useTexture(card.textureTemplateUrl);
  const levelStarTexture = useTexture("/textures/levelStar.png");

  useFrame(() => {
    if (outerGroup.current && innerGroup.current) {
      // Position Interpolation (Outer Group)
      // If selected, raise Z to 0.3 to ensure it's on top of other cards
      const targetZ = isSelected ? 0.3 : card.position.z;
      
      outerGroup.current.position.lerp(
        new Vector3(card.position.x, card.position.y, targetZ),
        0.1
      );

      // Rotation Logic
      // Outer Group: Handles "Spin" (Attack/Defense) - Rotation around Y axis (World Up)
      // Inner Group: Handles "Flip" (Face Up/Down) - Rotation around X axis
      
      const targetRotationZ = card.isDefenseMode ? Math.PI / 2 : 0;
      // const targetRotationX = card.isFaceDown ? 0 : -Math.PI / 2;

      // Smoothly interpolate rotations
      outerGroup.current.rotation.z += (targetRotationZ - outerGroup.current.rotation.z) * 0.1;
      // innerGroup.current.rotation.x += (0 - innerGroup.current.rotation.x) * 0.1;
    }
  });

  return (
    <group position={card.position} ref={outerGroup} onClick={(e) => {
      e.stopPropagation(); // Prevent tile click when clicking card
      onSelect();
    }}>        
      <group ref={innerGroup}>
        {
          card.isFaceDown ? (
            // Back Face (Classic Design)
            <group rotation={[0, 0, 0]}>
              {/* Border/Outline */}
              <mesh position={[0, 0, 0.001]}>
                <planeGeometry args={[0.68, 1.06]} />
                <meshStandardMaterial color="#7e6346" />
              </mesh>

              {/* Brown Background */}
              <mesh position={[0, 0, 0.002]}>
                <planeGeometry args={[0.61, 1]} />
                <meshStandardMaterial color="#513224" />
              </mesh>

              {/* Black Oval */}
              <mesh position={[0, 0, 0.003]} scale={[0.6, 1.3, 1]}>
                <circleGeometry args={[0.2, 32]} />
                <meshStandardMaterial color="black" />
              </mesh>
            </group>
          ) : (
            // Front Face (Details) 
            <group rotation={[0, 0, 0]}>
              {/* Background */}
              <mesh position={[0, 0, 0.001]}>
                <planeGeometry args={[0.68, 0.98]} />
                <meshBasicMaterial map={yugiohCardTexture} />
              </mesh>

              {/* Image Area */}
              <mesh position={[0, 0.122, 0.002]}>
                <planeGeometry args={[0.65, 0.7]} />
                <meshBasicMaterial map={texture} />
              </mesh>

              {/* Level */}
              {
                Array.from({ length: card.level }, (_, index) => {
                  const starSpacing = 0.043;
                  const totalWidth = (card.level - 1) * starSpacing;
                  const centerOffset = -(totalWidth / 2) - 0.05;
                  const xPosition = (index * starSpacing) + centerOffset;
                  
                  return (
                    <mesh key={index} position={[xPosition, -0.3, 0.002]}>
                      <planeGeometry args={[0.04, 0.040]} />
                      <meshBasicMaterial map={levelStarTexture} alphaTest={0.01}/>
                    </mesh>
                  );
                })
              }
              {
                card.attack !== -1 && (
                  <>
                  {/* Attribute */}
                  <mesh position={[0.249, -0.3, 0.002]}>
                    <planeGeometry args={[0.069, 0.069]} />
                    <meshBasicMaterial map={attributeTexture} alphaTest={0.01}/>
                  </mesh>
                  <mesh position={[-0.15, -0.4, 0.002]}>
                    <Text
                      fontSize={0.06}
                      color="black"
                      anchorX="center"
                      anchorY="middle"
                      font="/fonts/UtopiaStd-Subh.otf"
                    >
                      {card.attack}
                    </Text>
                  </mesh>

                  <mesh >
                    <Text
                      position={[0.15, -0.4, 0.003]}
                      fontSize={0.06}
                      color="black"
                      anchorX="center"
                      anchorY="middle"
                      font="/fonts/UtopiaStd-Subh.otf"
                    >
                      {card.defense}
                    </Text>
                  </mesh>
                  </>
                )
              }
            </group>
          )
        }
      </group>
      {/* Selection Highlight Overlay */}
      {isSelected && (
        <mesh position={[0, 0.003, 0.0001]}>
          <planeGeometry args={[0.8, 1.05]} />
          <meshBasicMaterial color="#00caff" transparent opacity={0.3} side={2} />
        </mesh>
      )}
    </group>
  );
}
