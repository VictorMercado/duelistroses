import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, useTexture } from "@react-three/drei";
import { Vector3, Group, DoubleSide, Mesh } from "three";
import type { Card, Rarity } from "@/types";

type CardPropType = {
  card: Card;
  isSelected: boolean;
  isPreview: boolean;
  onSelect: () => void;
};

const getGlowColor = (rarity: Rarity) => {
  switch (rarity) {
    case 'rare': return '#c0c0c0'; // Silver
    case 'super': return '#da70d6'; // Orchid
    case 'ultra': return '#ffd700'; // Gold
    case 'secret': return '#e0ffff'; // Light Cyan
    case 'ghost': return '#f0f8ff'; // Alice Blue
    case 'ultimate': return '#ff4500'; // Orange Red
    default: return '#ffd700'; // Default Gold
  }
};

export default function YugiohCard({ card, isSelected, isPreview, onSelect }: CardPropType) {
  const outerGroup = useRef<Group>(null);
  const innerGroup = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);
  const holoMeshRef = useRef<Mesh>(null);
  
  const texture = useTexture(card.textureUrl);
  // --- Load the shine mask here ---
  const shineTexture = useTexture("/textures/shine_mask_2.png"); 
  
  const maskTexture = useTexture(card.maskUrl || "/textures/blank_mask.png");
  const attributeTexture = useTexture(card.attributeUrl);
  const yugiohCardTexture = useTexture(card.textureTemplateUrl);
  const levelStarTexture = useTexture("/textures/levelStar.png");
  const opponentCardTexture = useTexture("/cards/opponentCard.png");

  // Setting textures to repeat/wrap is usually good for holo patterns, 
  // though 512x512 fits the card well by default.
  // shineTexture.wrapS = shineTexture.wrapT = THREE.RepeatWrapping;

  const defaultCardRotation = card.owner === 'opponent' 
  ? (isPreview ? 0 : Math.PI) : 0; 
  
  const BASE_CARD_Z = 0.001;
  const MID_CARD_Z = 0.002;
  const TOP_CARD_Z = 0.003;
  const OPP_CARD_Z = -0.001;

  useEffect(() => {
    if (innerGroup.current) {
      innerGroup.current.rotation.y = (card.isFaceDown && !isPreview) ? Math.PI : 0;
    }
    if (outerGroup.current) {
      outerGroup.current.rotation.z = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
    }
  }, []);

  useFrame((state) => {
    if (isPreview) {
        // Still animate glow in preview
        if (glowRef.current && card.rarity !== 'common') {
            const material = glowRef.current.material as any;
            if (material.uniforms) {
                material.uniforms.time.value = state.clock.getElapsedTime();
            }
        }
        // Animate Holographic Sweep in preview
        if (holoMeshRef.current && card.rarity !== 'common') {
            const material = holoMeshRef.current.material as any;
            if (material.uniforms && material.uniforms.time) {
                material.uniforms.time.value = state.clock.getElapsedTime();
            }
        }
        return;
    }

    if (outerGroup.current && innerGroup.current) {
      const targetZ = isSelected ? 0.25 : card.position.z;
      
      outerGroup.current.position.lerp(
        new Vector3(card.position.x, card.position.y, targetZ),
        0.1
      );
      
      const targetRotationZ = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
      const targetRotationY = card.isFaceDown ? Math.PI : 0; 

      outerGroup.current.rotation.z += (targetRotationZ - outerGroup.current.rotation.z) * 0.1;
      innerGroup.current.rotation.y += (targetRotationY - innerGroup.current.rotation.y) * 0.1;

      // Animate glow
      if (glowRef.current && card.rarity !== 'common') {
        const material = glowRef.current.material as any;
        if (material.uniforms) {
            material.uniforms.time.value = state.clock.getElapsedTime();
        }
      }

      // Animate Holographic Sweep
      if (holoMeshRef.current && card.rarity !== 'common') {
         const material = holoMeshRef.current.material as any;
         if (material.uniforms && material.uniforms.time) {
             material.uniforms.time.value = state.clock.getElapsedTime();
         }
      }
    }
  });

  return (
    <group position={card.position} ref={outerGroup} onClick={(e) => {
      e.stopPropagation();
      onSelect();
    }}>
      {card.owner === 'opponent' && !isPreview && (
        <mesh position={[0, 0, OPP_CARD_Z]}>
          <planeGeometry args={[0.85, 1.25]} />
          <meshStandardMaterial transparent opacity={0.6} color="#b45672" />
        </mesh>
      )}
      <group ref={innerGroup}>
        {/* Rarity Glow - God Rays Effect */}
        {card.rarity !== 'common' && (
             <mesh ref={glowRef} position={[0, 0, -0.01]}>
               {/* Larger plane for rays to extend */}
               <planeGeometry args={[1.5, 1.8]} />
               <godRaysMaterial 
                color={getGlowColor(card.rarity)} 
                time={0} // Will be updated by useFrame if we pass a ref, or we can just let R3F handle it?
                         // Better to use a ref to the material and update time in useFrame for performance
                         // OR just pass state.clock.elapsedTime as a prop, but that causes re-renders.
                         // Let's use the ref approach.
                alpha={1.0}
                transparent
                depthWrite={false} // Don't write to depth buffer to avoid occlusion issues
                side={DoubleSide}
               />
             </mesh>
        )}

        {/* Back Face (Classic Design) */}
        <group rotation={[0, Math.PI, 0]}>
          <mesh position={[0, 0, BASE_CARD_Z]}>
            <planeGeometry args={[0.68, 1.06]} />
            <meshStandardMaterial color="#7e6346" />
          </mesh>
          <mesh position={[0, 0, MID_CARD_Z]}>
            <planeGeometry args={[0.61, 1]} />
            <meshStandardMaterial color="#513224" />
          </mesh>
          <mesh position={[0, 0, TOP_CARD_Z]} scale={[0.6, 1.3, 1]}>
            <circleGeometry args={[0.2, 32]} />
            <meshStandardMaterial color="black" />
          </mesh>
        </group>
        
        {/* Front Face Logic */}
        {card.owner === 'opponent' && card.isFaceDown ? (
          // Simple opponent card (NO HOLO HERE)
          <group rotation={[0, 0, 0]}>
            <mesh position={[0, 0, BASE_CARD_Z]}>
              <planeGeometry args={[0.68, 0.98]} />
              <meshBasicMaterial map={opponentCardTexture} />
            </mesh>
          </group>
        ) : (
          // Detailed player/opponent face-up card (HOLO ADDED HERE)
          <group rotation={[0, 0, 0]}>
            {/* Card Template */}
            <mesh position={[0, 0, BASE_CARD_Z]}>
              <planeGeometry args={[0.68, 0.98]} />
              <meshBasicMaterial map={yugiohCardTexture} />
            </mesh>

            {/* --- ARTWORK IMAGE WITH HOLO EFFECT --- */}
            <mesh ref={holoMeshRef} position={[0, 0.1244, MID_CARD_Z]}>
              <planeGeometry args={[0.65, 0.7]} />
              {/* Replaced meshBasicMaterial with custom shader */}
              {
                card.rarity === "common" ? (
                  <meshBasicMaterial map={texture} />
                ) : (
                  <baseHolographicMaterial
                    baseTexture={texture}
                    shineTexture={shineTexture}
                    maskTexture={maskTexture}
                    useMask={card.maskUrl ? 1.0 : 0.0}
                    time={0}
                  />
                )
              }
            </mesh>

            {/* Level */}
            {
              Array.from({ length: card.level }, (_, index) => {
                const starSpacing = 0.043;
                const totalWidth = (card.level - 1) * starSpacing;
                const centerOffset = -(totalWidth / 2) - 0.05;
                const xPosition = (index * starSpacing) + centerOffset;
                
                return (
                  <mesh key={index} position={[xPosition, -0.3, MID_CARD_Z]}>
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
                <mesh position={[0.249, -0.305, MID_CARD_Z]}>
                  <planeGeometry args={[0.069, 0.069]} />
                  <meshBasicMaterial map={attributeTexture} alphaTest={0.01}/>
                </mesh>
                <mesh position={[-0.155, -0.405, MID_CARD_Z]}>
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

                <mesh position={[0.155, -0.405, MID_CARD_Z]}>
                  <Text
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
        )}
      </group>
    </group>
  );
}

// export default function YugiohCard({ card, isSelected, isPreview, onSelect }: CardPropType) {
//   const outerGroup = useRef<Group>(null);
//   const innerGroup = useRef<Group>(null);
  
//   const texture = useTexture(card.textureUrl);
//   const attributeTexture = useTexture(card.attributeUrl);
//   const yugiohCardTexture = useTexture(card.textureTemplateUrl);
//   const levelStarTexture = useTexture("/textures/levelStar.png");
//   const opponentCardTexture = useTexture("/cards/opponentCard.png");
//   const defaultCardRotation = card.owner === 'opponent' 
//   ? (isPreview ? 0 : Math.PI) : 0; 
//   const BASE_CARD_Z = 0.001;
//   const MID_CARD_Z = 0.002;
//   const TOP_CARD_Z = 0.003;
//   const OPP_CARD_Z = 0.004;
//   // Initialize rotation to match card state (prevents flash on load)
//   useEffect(() => {
//     if (innerGroup.current) {
//       innerGroup.current.rotation.y = (card.isFaceDown && !isPreview) ? Math.PI : 0;
//     }
//     if (outerGroup.current) {
//       if (card.owner === 'opponent') {
//         outerGroup.current.rotation.z = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
//       } else {
//         outerGroup.current.rotation.z = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
//       }
//     }
//   }, []); // Empty deps - only run once on mount

//   useFrame(() => {
//     if (isPreview) return;
//     if (outerGroup.current && innerGroup.current) {
//       // Position Interpolation (Outer Group)
//       // If selected, raise Z to 0.3 to ensure it's on top of other cards
//       const targetZ = isSelected ? 0.25 : card.position.z;
      
//       outerGroup.current.position.lerp(
//         new Vector3(card.position.x, card.position.y, targetZ),
//         0.1
//       );

//       // Rotation Logic
//       // Outer Group: Handles "Spin" (Attack/Defense) - Rotation around Z axis
//       // Inner Group: Handles "Flip" (Face Up/Down) - Rotation around Y axis
      
//       const targetRotationZ = card.isDefenseMode ? Math.PI / 2 : defaultCardRotation;
//       const targetRotationY = card.isFaceDown ? Math.PI : 0; // Flip animation
//       // const targetRotationOpponentZ = card.owner === 'opponent' ? Math.PI / 2 : 0;

//       // Smoothly interpolate rotations
//       outerGroup.current.rotation.z += (targetRotationZ - outerGroup.current.rotation.z) * 0.1;
//       innerGroup.current.rotation.y += (targetRotationY - innerGroup.current.rotation.y) * 0.1;
//     }
//   });

//   return (
//     <group position={card.position} ref={outerGroup} onClick={(e) => {
//       e.stopPropagation(); // Prevent tile click when clicking card
//       onSelect();
//     }}>
//       {card.owner === 'opponent' && !isPreview && (
//         <mesh position={[0, 0, OPP_CARD_Z]}>
//           <planeGeometry args={[0.75, 1.06]} />
//           <meshStandardMaterial transparent opacity={0.4} color="#b45672" />
//         </mesh>
//       )}
//       <group ref={innerGroup}>

//         {/* Back Face (Classic Design) - Visible when rotated 180° */}
//         <group rotation={[0, Math.PI, 0]}>
//           {/* Border/Outline */}
//           <mesh position={[0, 0, BASE_CARD_Z]}>
//             <planeGeometry args={[0.68, 1.06]} />
//             <meshStandardMaterial color="#7e6346" />
//           </mesh>

//           {/* Brown Background */}
//           <mesh position={[0, 0, MID_CARD_Z]}>
//             <planeGeometry args={[0.61, 1]} />
//             <meshStandardMaterial color="#513224" />
//           </mesh>

//           {/* Black Oval */}
//           <mesh position={[0, 0, TOP_CARD_Z]} scale={[0.6, 1.3, 1]}>
//             <circleGeometry args={[0.2, 32]} />
//             <meshStandardMaterial color="black" />
//           </mesh>
//         </group>
        
//         {/* Front Face - Simple for opponent, detailed for player */}
//         {card.owner === 'opponent' && card.isFaceDown ? (
//           // Simple opponent card - just the image
//           <group rotation={[0, 0, 0]}>
//             <mesh position={[0, 0, BASE_CARD_Z]}>
//               <planeGeometry args={[0.68, 0.98]} />
//               <meshBasicMaterial map={opponentCardTexture} />
//             </mesh>
//           </group>
//         ) : (
//           // Detailed player card - Full card details
//           <group rotation={[0, 0, 0]}>
//             {/* Card Template */}
//             <mesh position={[0, 0, BASE_CARD_Z]}>
//               <planeGeometry args={[0.68, 0.98]} />
//               <meshBasicMaterial map={yugiohCardTexture} />
//             </mesh>

//             {/* Image Area */}
//             <mesh position={[0, 0.122, MID_CARD_Z]}>
//               <planeGeometry args={[0.65, 0.7]} />
//               <meshBasicMaterial map={texture} />
//             </mesh>

//             {/* Level */}
//             {
//               Array.from({ length: card.level }, (_, index) => {
//                 const starSpacing = 0.043;
//                 const totalWidth = (card.level - 1) * starSpacing;
//                 const centerOffset = -(totalWidth / 2) - 0.05;
//                 const xPosition = (index * starSpacing) + centerOffset;
                
//                 return (
//                   <mesh key={index} position={[xPosition, -0.3, MID_CARD_Z]}>
//                     <planeGeometry args={[0.04, 0.040]} />
//                     <meshBasicMaterial map={levelStarTexture} alphaTest={0.01}/>
//                   </mesh>
//                 );
//               })
//             }
//             {
//               card.attack !== -1 && (
//                 <>
//                 {/* Attribute */}
//                 <mesh position={[0.249, -0.305, MID_CARD_Z]}>
//                   <planeGeometry args={[0.069, 0.069]} />
//                   <meshBasicMaterial map={attributeTexture} alphaTest={0.01}/>
//                 </mesh>
//                 <mesh position={[-0.155, -0.405, MID_CARD_Z]}>
//                   <Text
//                     fontSize={0.06}
//                     color="black"
//                     anchorX="center"
//                     anchorY="middle"
//                     font="/fonts/UtopiaStd-Subh.otf"
//                   >
//                     {card.attack}
//                   </Text>
//                 </mesh>

//                 <mesh position={[0.155, -0.405, MID_CARD_Z]}>
//                   <Text
//                     fontSize={0.06}
//                     color="black"
//                     anchorX="center"
//                     anchorY="middle"
//                     font="/fonts/UtopiaStd-Subh.otf"
//                   >
//                     {card.defense}
//                   </Text>
//                 </mesh>
//                 </>
//               )
//             }
//           </group>
//         )}
//       </group>
//     </group>
//   );
// }
