import { DoubleSide, Vector3 } from "three";
import { useEffect, useMemo } from "react";
import { useTexture, Text } from "@react-three/drei";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import BoardCursor from "./BoardCursor";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { isCard, isPlayer } from "@/types";
import type { Tile } from "@/types";

const BOARD_SIZE = 11;
const SQUARE_SIZE = 1;

export default function GameBoard() {
  // Use stores instead of props
  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const inputStore = useInputStore();
  
  // Load textures
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

  // Generate tiles
  const tiles: Tile[] = useMemo(() => {
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

  // Notify store when tiles are ready
  useEffect(() => {
    gameStore.setTiles(tiles);
  }, [tiles, gameStore.setTiles]);

  // Calculate guide line positions (horizontal and vertical lines)
  const guideLinePositions = useMemo(() => {
    if (!inputStore.selectedTilePiece) return [];
    if (isPlayer(inputStore.selectedTilePiece)) {
      if (inputStore.selectedTilePiece.type === 'opponent') {
        return [];
      }
    }
    if (isCard(inputStore.selectedTilePiece)) {
      if (inputStore.selectedTilePiece.owner === 'opponent') {
        return [];
      }
    }
    const positions: [number, number, number][] = [];
    const pieceX = inputStore.selectedTilePiece.position.x;
    const pieceY = inputStore.selectedTilePiece.position.y;

    // Horizontal positions (same Y, different X)
    for (let x = -5; x <= 5; x++) {
      if (x !== pieceX) {
        positions.push([x, pieceY, 0.05]);
      }
    }

    // Vertical positions (same X, different Y)
    for (let y = -5; y <= 5; y++) {
      if (y !== pieceY) {
        positions.push([pieceX, y, 0.05]);
      }
    }

    return positions;
  }, [inputStore.selectedTilePiece]);

  // Calculate valid move positions (8 surrounding squares)
  const validMovePositions = useMemo(() => {
    if (!inputStore.selectedTilePiece || !gameStore.stagingState) return [];
    if (isPlayer(inputStore.selectedTilePiece)) {
      if (inputStore.selectedTilePiece.type === 'opponent') {
        return [];
      }
    }
    if (isCard(inputStore.selectedTilePiece)) {
      if (inputStore.selectedTilePiece.owner === 'opponent') {
        return [];
      }
    }

    const positions: [number, number, number][] = [];
    // Use ORIGINAL position, not current position
    const pieceX = gameStore.stagingState.originalPosition.x;
    const pieceY = gameStore.stagingState.originalPosition.y;

    // 8 surrounding positions (N, S, E, W, NE, NW, SE, SW)
    const offsets = [
      [0, 1],   // N
      [0, -1],  // S
      [1, 0],   // E
      [-1, 0],  // W
      [1, 1],   // NE
      [-1, 1],  // NW
      [1, -1],  // SE
      [-1, -1], // SW
    ];

    for (const [dx, dy] of offsets) {
      const newX = pieceX + dx;
      const newY = pieceY + dy;
      
      // Check bounds
      if (newX >= -5 && newX <= 5 && newY >= -5 && newY <= 5) {
        positions.push([newX, newY, 0.06]);
      }
    }

    return positions;
  }, [inputStore.selectedTilePiece, gameStore.stagingState]);

  return (
    <group position={[0, 0, -2]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Render board cursor */}
      <BoardCursor position={inputStore.cursorPosition} visible={true} />
      
      {tiles.map((square: Tile, index: number) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        return(
          <group key={index}>
            {
              uiStore.showTilePositions && (        
                <Text
                  key={`pos-${index}`}
                  position={[square.position.x, square.position.y, square.position.z + 0.1]}
                  rotation={[0, 0, 0]}
                  fontSize={0.15}
                  color="white"
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.02}
                  outlineColor="black"
                >
                  {`(${Math.round(square.position.x)}, ${Math.round(square.position.y)}, ${Math.round(square.position.z * 100) / 100})`}
                </Text>
              )
            }
            <mesh
              position={square.position}
              onClick={() => {
                inputStore.selectTilePiece(null); // Deselect when clicking empty tile
                uiStore.setSelectedTile({
                  type: square.type,
                  name: square.name,
                  position: square.position,
                  texture: square.texture,
                });
              }}
            >
              <planeGeometry args={[SQUARE_SIZE, SQUARE_SIZE]} />
              <meshStandardMaterial
                map={square.texture}
                transparent
                opacity={1}
                side={DoubleSide}
              />
            </mesh>
          </group>
        )})}
      
      {/* Render movement guide lines */}
      {guideLinePositions.map((pos, index) => (
        <mesh key={`guide-${index}`} position={pos} rotation={[0, 0, 0]}>
          <planeGeometry args={[SQUARE_SIZE, SQUARE_SIZE]} />
          <meshBasicMaterial color="#d2d2d2ff" transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      ))}

      {/* Render valid move positions (surrounding squares) */}
      {validMovePositions.map((pos, index) => (
        <mesh key={`valid-${index}`} position={pos} rotation={[0, 0, 0]}>
          <planeGeometry args={[SQUARE_SIZE, SQUARE_SIZE]} />
          <meshBasicMaterial color="#0099ff" transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      ))}
      
      {/* Render cards */}
      {uiStore.showCards && gameStore.cards.map((card) => {
        const isSelected = inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece) && inputStore.selectedTilePiece.id === card.id;
        return (
          <YugiohCard
            key={card.id}
            card={card}
            isSelected={!!isSelected}
            isPreview={false}
            onSelect={() => inputStore.selectTilePiece(card)}
          />
        );
      })}
      
      {/* Render player emblems */}
      {uiStore.showPlayers && gameStore.players.map((player) => {
        const isSelected = inputStore.selectedTilePiece && isPlayer(inputStore.selectedTilePiece) && inputStore.selectedTilePiece.id === player.id;
        return (
          <PlayerEmblem 
            key={player.id} 
            player={player}
            isSelected={!!isSelected}
            onSelect={() => inputStore.selectTilePiece(player)}
          />
        );
      })}
    </group>
  );
}
