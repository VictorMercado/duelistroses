import { useTexture } from "@react-three/drei";
import type { Player } from "@/types";
import { DoubleSide, Group } from "three";
import { forwardRef } from "react";

interface PlayerEmblemProps {
  preview?: boolean;
  player: Player;
  onSelect: () => void;
}

const PlayerEmblem = forwardRef<Group, PlayerEmblemProps>(({ player, onSelect, preview }, ref) => {
  const emblemTexture = useTexture(player.textureUrl);
  let orientation = 0;
  if (!preview) {
    switch (player.boardSide) {
      case 'N':
        orientation = Math.PI;
        break;
      case 'S':
        orientation = 0;
        break;
      case 'E':
        orientation = Math.PI / 2;
        break;
      case 'W':
        orientation = -Math.PI / 2;
        break;
    }
  }
  return (
    <group 
      ref={ref} 
      position={[player.position.x, player.position.y, player.position.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Emblem */}
      <mesh rotation={[0, 0, orientation]}>
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
});

export default PlayerEmblem;
