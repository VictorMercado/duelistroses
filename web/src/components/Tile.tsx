import { TILE_SIZE } from "@/const";
import { useUIStore } from "@/stores/uiStore";
import { type Tile } from "@/types";
import { useMemo } from "react";
import { DoubleSide, PlaneGeometry } from "three";
import { Text } from "@react-three/drei";
import { ToonBook } from "./game/ToonBook";
import { InputManager } from "@/game/InputManager";
import React from "react";

const Tile = ({ tile }: { tile: Tile }) => {
  const uiStore = useUIStore();
  const flatGeometry = useMemo(() => new PlaneGeometry(TILE_SIZE, TILE_SIZE, 1, 1), []);
  // const highPolyGeometry = useMemo(() => new PlaneGeometry(TILE_SIZE, TILE_SIZE, 64, 64), []);
  return(
    <group>
      {
        uiStore.showTilePositions && (
          <Text
            position={[tile.position.x, tile.position.y, tile.position.z + 0.09]}
            rotation={[0, 0, 0]}
            fontSize={0.15}
            color="white"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="black"
            characters="0123456789(),. "
          >
            {`(${Math.round(tile.position.x)}, ${Math.round(tile.position.y)}, ${Math.round(tile.position.z * 100) / 100})`}
          </Text>
        )
      }
      {
        tile.terrain.type === 'toon' ? (
          <ToonBook 
            position={tile.position} 
            onClick={() => {
                InputManager.getInstance().handleInteraction('SELECT', { tile, pos: tile.position });
              }} 
          />
        ) : (
          <mesh
            position={tile.position}
            geometry={flatGeometry}
            // geometry={tile.displacementTexture ? highPolyGeometry : flatGeometry}
            onClick={() => {
              InputManager.getInstance().handleInteraction('SELECT', { tile, pos: tile.position });
            }}
          >
            <meshStandardMaterial
              map={tile.texture}
              // displacementMap={tile.displacementTexture}
              // displacementScale={tile.displacementTexture ? 0.05 : 0}
              // displacementBias={tile.displacementTexture ? 0 : 0} // Shift down to center the displacement
              // roughness={0.5} // Matte look for terrain
              opacity={1}
              side={DoubleSide}
            />
          </mesh>
        )
      }
    </group>
  )
}

export const MemoizedTile = React.memo(Tile);
