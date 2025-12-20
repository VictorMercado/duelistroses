import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { Vector3 } from 'three';
import type { Tile } from '@/types';
import {
  BOARD_SIZE,
  TILE_SIZE,
  SOGEN_TERRAIN,
  YAMI_TERRAIN,
  LABYRINTH_TERRAIN,
  NORMAL_TERRAIN,
  UMI_TERRAIN,
  CRUSH_TERRAIN,
  MOUNTAIN_TERRAIN,
  WASTELAND_TERRAIN,
  FOREST_TERRAIN,
  TOON_TERRAIN,
} from '@/const';

export function useBoardTiles() {
  // Load all textures
  const yogenTexture = useTexture(SOGEN_TERRAIN.textureUrl);
  const yamiTexture = useTexture(YAMI_TERRAIN.textureUrl);
  const labyrinthTexture = useTexture(LABYRINTH_TERRAIN.textureUrl);
  const normalTexture = useTexture(NORMAL_TERRAIN.textureUrl);
  const umiTexture = useTexture(UMI_TERRAIN.textureUrl);
  const crushTexture = useTexture(CRUSH_TERRAIN.textureUrl);
  const mountainTexture = useTexture(MOUNTAIN_TERRAIN.textureUrl);
  const wastelandTexture = useTexture(WASTELAND_TERRAIN.textureUrl);
  const forestTexture = useTexture(FOREST_TERRAIN.textureUrl);
  const toonTexture = useTexture(TOON_TERRAIN.textureUrl);

  const tilesAssets: Tile[] = [
    {
      terrain: SOGEN_TERRAIN,
      texture: yogenTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: YAMI_TERRAIN,
      texture: yamiTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: LABYRINTH_TERRAIN,
      texture: labyrinthTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: NORMAL_TERRAIN,
      texture: normalTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: UMI_TERRAIN,
      texture: umiTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: CRUSH_TERRAIN,
      texture: crushTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: MOUNTAIN_TERRAIN,
      texture: mountainTexture,
      displacementTexture: mountainTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: WASTELAND_TERRAIN,
      texture: wastelandTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: FOREST_TERRAIN,
      texture: forestTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      terrain: TOON_TERRAIN,
      texture: toonTexture,
      position: new Vector3(0, 0, 0),
    },
  ];

  const tiles = useMemo(() => {
    const squares: Tile[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        const textureIndex = Math.floor(Math.random() * tilesAssets.length);
        squares.push({
          position: new Vector3(
            (i - BOARD_SIZE / 2 + 0.5) * TILE_SIZE,
            (j - BOARD_SIZE / 2 + 0.5) * TILE_SIZE,
            0,
          ),
          texture: tilesAssets[textureIndex].texture,
          terrain: tilesAssets[textureIndex].terrain,
          displacementTexture: tilesAssets[textureIndex].displacementTexture,
        });
      }
    }
    return squares;
  }, [yogenTexture, yamiTexture, labyrinthTexture, normalTexture, umiTexture, crushTexture, mountainTexture, wastelandTexture, forestTexture, toonTexture]);

  return tiles;
}
