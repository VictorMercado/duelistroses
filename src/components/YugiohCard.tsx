import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, useTexture } from "@react-three/drei";
import { Vector3, Group } from "three";
import type { Card } from "@/types";

type CardPropType = {
  card: Card;
  isSelected: boolean;
  isPreview: boolean;
  onSelect: () => void;
};

export default function YugiohCard({ card, isSelected, isPreview, onSelect }: CardPropType) {
  const outerGroup = useRef<Group>(null);
  const innerGroup = useRef<Group>(null);
  
  const texture = useTexture(card.textureUrl);
  const attributeTexture = useTexture(card.attributeUrl);
  const yugiohCardTexture = useTexture(card.textureTemplateUrl);
  const levelStarTexture = useTexture("/textures/levelStar.png");
  const opponentCardTexture = useTexture("/cards/opponentCard.png");
  const defaultCardRotation = card.owner === 'opponent' 
  ? (isPreview ? 0 : Math.PI) : 0; 
  // Initialize rotation to match card state (prevents flash on load)
  useEffect(() => {
    if (innerGroup.current) {
      innerGroup.current.rotation.y = (card.isFaceDown && !isPreview) ? Math.PI : 0;
    }
    if (outerGroup.current) {
      if (card.owner === 'opponent') {
        outerGroup.current.rotation.z = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
      } else {
        outerGroup.current.rotation.z = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
      }
    }
  }, []); // Empty deps - only run once on mount

  useFrame(() => {
    if (isPreview) return;
    if (outerGroup.current && innerGroup.current) {
      // Position Interpolation (Outer Group)
      // If selected, raise Z to 0.3 to ensure it's on top of other cards
      const targetZ = isSelected ? 0.25 : card.position.z;
      
      outerGroup.current.position.lerp(
        new Vector3(card.position.x, card.position.y, targetZ),
        0.1
      );

      // Rotation Logic
      // Outer Group: Handles "Spin" (Attack/Defense) - Rotation around Z axis
      // Inner Group: Handles "Flip" (Face Up/Down) - Rotation around Y axis
      
      const targetRotationZ = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
      const targetRotationY = card.isFaceDown ? Math.PI : 0; // Flip animation
      // const targetRotationOpponentZ = card.owner === 'opponent' ? Math.PI / 2 : 0;

      // Smoothly interpolate rotations
      outerGroup.current.rotation.z += (targetRotationZ - outerGroup.current.rotation.z) * 0.1;
      innerGroup.current.rotation.y += (targetRotationY - innerGroup.current.rotation.y) * 0.1;
    }
  });

  return (
    <group position={card.position} ref={outerGroup} onClick={(e) => {
      e.stopPropagation(); // Prevent tile click when clicking card
      onSelect();
    }}>        
      <group ref={innerGroup}>
        {/* Back Face (Classic Design) - Visible when rotated 180° */}
        <group rotation={[0, Math.PI, 0]}>
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
        
        {/* Front Face - Simple for opponent, detailed for player */}
        {card.owner === 'opponent' && card.isFaceDown ? (
          // Simple opponent card - just the image
          <group rotation={[0, 0, 0]}>
            <mesh position={[0, 0, 0.001]}>
              <planeGeometry args={[0.68, 0.98]} />
              <meshBasicMaterial map={opponentCardTexture} />
            </mesh>
          </group>
        ) : (
          // Detailed player card - Full card details
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
                <mesh position={[0.249, -0.305, 0.002]}>
                  <planeGeometry args={[0.069, 0.069]} />
                  <meshBasicMaterial map={attributeTexture} alphaTest={0.01}/>
                </mesh>
                <mesh position={[-0.155, -0.405, 0.002]}>
                  <Text
                    fontSize={0.06}
                    color="black"
                    anchorX="center"
                    anchorY="middle"
                    // font="/fonts/UtopiaStd-Subh.otf"
                  >
                    {card.attack}
                  </Text>
                </mesh>

                <mesh position={[0.155, -0.405, 0.002]}>
                  <Text
                    fontSize={0.06}
                    color="black"
                    anchorX="center"
                    anchorY="middle"
                    // font="/fonts/UtopiaStd-Subh.otf"
                  >
                    {card.defense}
                  </Text>
                </mesh>
                </>
              )
            }
          </group>
        )}
      </group>
    </group>
  );
}
