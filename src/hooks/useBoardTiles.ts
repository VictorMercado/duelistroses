import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { Vector3 } from 'three';
import type { Tile } from '@/types';

const BOARD_SIZE = 11;
const SQUARE_SIZE = 1;

export function useBoardTiles() {
  // Load all textures
  const grassTexture = useTexture('/textures/grass.png');
  const darkTexture = useTexture('/textures/dark.png');
  const labyrinthTexture = useTexture('/textures/labyrinth.png');
  const normalTexture = useTexture('/textures/normal.png');
  const waterTexture = useTexture('/textures/water.png');

  const tilesAssets: Tile[] = [
    {
      type: 'grass',
      name: 'Grass',
      texture: grassTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      type: 'dark',
      name: 'Dark',
      texture: darkTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      type: 'labyrinth',
      name: 'Labyrinth',
      texture: labyrinthTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      type: 'normal',
      name: 'Normal',
      texture: normalTexture,
      position: new Vector3(0, 0, 0),
    },
    {
      type: 'water',
      name: 'Water',
      texture: waterTexture,
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
            (i - BOARD_SIZE / 2 + 0.5) * SQUARE_SIZE,
            (j - BOARD_SIZE / 2 + 0.5) * SQUARE_SIZE,
            0,
          ),
          texture: tilesAssets[textureIndex].texture,
          type: tilesAssets[textureIndex].type,
          name: tilesAssets[textureIndex].name,
        });
      }
    }
    return squares;
  }, [grassTexture, darkTexture, labyrinthTexture, normalTexture, waterTexture]);

  return tiles;
}
