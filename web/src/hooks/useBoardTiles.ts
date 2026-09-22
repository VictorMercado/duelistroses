import { useEffect, useMemo, useState } from 'react';
import { useTexture } from '@react-three/drei';
import { LinearMipmapLinearFilter, Vector3 } from 'three';
import type { Tile, TerrainType } from '@/types';
import { fetchRoomMap } from '@/net/mapApi';
import type { ServerGameMap } from '@/net/protocol';
import { useNetStore } from '@/stores/netStore';
import {
  BOARD_SIZE,
  TERRAINS,
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

// Prime useTexture's cache before the board mounts, so tiles resolve straight
// from it instead of popping in.
//
// This replaces a hand rolled preloader that built its own Map of
// HTMLImageElements: every terrain was then fetched and decoded twice (once for
// that Map, once by three.js for the tile material) and the Map held ~37MB of
// decoded bitmaps for the life of the page.
// Preload one url at a time: useLoader keys its cache by the whole argument,
// so preloading an array would prime a key that the per-terrain useTexture
// calls below never look up, and every texture would be fetched twice.
new Set(
  TERRAINS.flatMap(terrain =>
    terrain.displacementUrl
      ? [terrain.textureUrl, terrain.displacementUrl]
      : [terrain.textureUrl]
  )
).forEach(url => useTexture.preload(url));

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
  yogenTexture.minFilter = LinearMipmapLinearFilter;
  yamiTexture.minFilter = LinearMipmapLinearFilter;
  labyrinthTexture.minFilter = LinearMipmapLinearFilter;
  normalTexture.minFilter = LinearMipmapLinearFilter;
  umiTexture.minFilter = LinearMipmapLinearFilter;
  crushTexture.minFilter = LinearMipmapLinearFilter;
  mountainTexture.minFilter = LinearMipmapLinearFilter;
  wastelandTexture.minFilter = LinearMipmapLinearFilter;
  forestTexture.minFilter = LinearMipmapLinearFilter;
  toonTexture.minFilter = LinearMipmapLinearFilter;

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

  // While we are in (or joining) a room the board layout comes from the server,
  // so every client in that room renders the same map. Solo play keeps the old
  // client side random generation.
  const roomId = useNetStore((state) =>
    state.status === 'idle' || state.status === 'closed' ? null : state.roomId
  );
  const [serverMap, setServerMap] = useState<ServerGameMap | null>(null);

  useEffect(() => {
    if (!roomId) {
      setServerMap(null);
      return;
    }

    const controller = new AbortController();

    fetchRoomMap(roomId, controller.signal)
      .then((map) => setServerMap(map))
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        console.warn('[map] falling back to a local board:', error);
        useNetStore.getState().setLastError(error.message);
        setServerMap(null);
      });

    return () => controller.abort();
  }, [roomId]);

  const tiles = useMemo(() => {
    const assetsByTerrain = new Map<TerrainType, Tile>(
      tilesAssets.map((asset) => [asset.terrain.type, asset])
    );

    if (serverMap) {
      return serverMap.tiles.map((tile) => {
        const asset = assetsByTerrain.get(tile.terrain as TerrainType) ?? tilesAssets[0];
        return {
          position: new Vector3(tile.x * TILE_SIZE, tile.y * TILE_SIZE, 0),
          texture: asset.texture,
          terrain: asset.terrain,
          displacementTexture: asset.displacementTexture,
        };
      });
    }

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
  }, [serverMap, yogenTexture, yamiTexture, labyrinthTexture, normalTexture, umiTexture, crushTexture, mountainTexture, wastelandTexture, forestTexture, toonTexture]);

  return tiles;
}
