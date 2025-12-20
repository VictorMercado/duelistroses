import { useTexture } from "@react-three/drei";
export const MysteryCard = () => {
  const texture = useTexture('/cards/mysteryCard.png');
  const BASE_CARD_Z = 0.001;
  return (
    <group rotation={[0, 0, 0]}>
      <mesh position={[0, 0, BASE_CARD_Z]}>
        <planeGeometry args={[0.68, 0.98]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}