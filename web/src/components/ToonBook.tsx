import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { LinearFilter, MeshStandardMaterial, NearestFilter, Vector3, DoubleSide } from 'three';
import { ASSET_URL, TILE_SIZE } from '@/const';

interface ToonBookProps {
  position: Vector3;
  onClick?: () => void;
}

export const ToonBook = ({ position, onClick }: ToonBookProps) => {
  // 1. Load the texture
  const texture = useTexture(ASSET_URL + '/textures/toon_world_sprite.png');
  
  // Optional: Set filtering to Nearest for that crisp "pixel art" look
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;

  // 2. Create the materials for each face using useMemo to optimize
  const materials = useMemo(() => {
    // Helper function to crop the texture
    const cropTexture = (x: number, y: number, w: number, h: number, rotation?: number) => {
      const t = texture.clone(); // Clone so we can change offset individually
      t.needsUpdate = true;
      if (!rotation) {
        t.repeat.set(w, h);
        t.offset.set(x, y);
      } else if (Math.abs(rotation - Math.PI) < 0.01) {
          t.repeat.set(-w, -h);
          t.offset.set(x + w, y + h);
      } else {
          t.repeat.set(w, h);
          t.offset.set(x, y);
          if (rotation) {
            t.center.set(0.5, 0.5);
            t.rotation = rotation;
          }
      }

      // Create a material with this cropped texture
      return new MeshStandardMaterial({ map: t });
    };
    
    // The image seems to be split: Left Half = Pages, Right Top = Edges, Right Bottom = Cover
    const topBook = cropTexture(0.0, 0.0, 0.5, 1.0);
    const frontBook = cropTexture(0.5, 0.75, 0.5, 0.25, Math.PI);
    const sideBook = cropTexture(.5, 0.13, 1.0, .25, Math.PI/2);
    const backBook = cropTexture(0.5, 0.75, 0.5, 0.25);
    const bottomBook = cropTexture(0.5, 0.0, 0.24, 0.5);
    const tile =  cropTexture(0.75, 0.0, 0.25, 0.5, Math.PI);
    // Order for BoxGeometry: Right, Left, Top, Bottom, Front, Back
    return {topBook, frontBook, sideBook, backBook, bottomBook, tile};
  }, [texture]);

  return (
    <group position={position} onClick={onClick}>
      {/* Right, Left, Front, Back, Top, Bottom */}
      <mesh material={[materials.sideBook, materials.sideBook, materials.frontBook, materials.backBook, materials.topBook, materials.bottomBook]} position={[0, 0, 0.027]}>
        {/* Width, Height, Depth of the book */}
        <boxGeometry args={[TILE_SIZE/2, TILE_SIZE/2, 0.05]} />
      </mesh>
      <mesh>
        <meshStandardMaterial map={materials.tile.map} opacity={1} side={DoubleSide}/>
        <planeGeometry args={[TILE_SIZE, TILE_SIZE, 64, 64]} />
      </mesh>
    </group>
  );
};