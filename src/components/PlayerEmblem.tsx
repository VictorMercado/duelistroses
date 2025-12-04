import { useTexture } from "@react-three/drei";
import type { Player } from "@/types";
import { DoubleSide, Group } from "three";
import { useRef } from "react";

interface PlayerEmblemProps {
  player: Player;
  isSelected: boolean;
  onSelect: () => void;
}

export default function PlayerEmblem({ player, isSelected, onSelect }: PlayerEmblemProps) {
  const emblemTexture = useTexture(player.textureUrl);
  const groupRef = useRef<Group>(null); 

  return (
    <group 
      ref={groupRef} 
      position={[player.position.x, player.position.y, player.position.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Emblem */}
      <mesh rotation={[0, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial 
          map={emblemTexture} 
          transparent 
          alphaTest={0.1}
          side={DoubleSide}
        />
      </mesh>
      
      {/* Glow */}
      <mesh position={[0, 0, -0.01]} rotation={[0, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial 
          color={player.owner === 'opponent' ? '#ff4343' : '#ffffff'}
          transparent
          opacity={0.6}
        />
      </mesh>
    </group>
  );
}
