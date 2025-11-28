import { DoubleSide, Vector3 } from "three";
import { useEffect, useMemo } from "react";
import { useTexture, Text } from "@react-three/drei";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import BoardCursor from "./BoardCursor";
import type { Card, Tile, Player, TilePiece, TurnState, StagingState } from "@/types";
import { isCard, isPlayer } from "@/types";

const BOARD_SIZE = 11;
const SQUARE_SIZE = 1;

interface GameBoardProps {
  cards: Card[];
  players: Player[];
  selectedTilePiece: TilePiece | null;
  onTilePieceSelect: (tilePiece: TilePiece | null) => void;
  onTilePieceUpdate: (tilePiece: TilePiece) => void;
  onTileHover: (tile: Tile | null) => void;
  onTileClick: (tile: Tile | null) => void;
  onTilesReady: (tiles: Tile[]) => void;
  cursorPosition: { x: number; y: number };
  showTilePositions: boolean;
  turnState: TurnState;
  stagingState: StagingState | null;
}

export default function GameBoard({ cards, players, selectedTilePiece, onTilePieceSelect, onTilePieceUpdate, onTileHover, onTileClick, onTilesReady, cursorPosition, showTilePositions, turnState, stagingState }: GameBoardProps) {
  // Load grass texture
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

  // Notify parent when tiles are ready
  useEffect(() => {
    onTilesReady(tiles);
  }, [tiles, onTilesReady]);



  // Handle WASD movement for any selected TilePiece
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedTilePiece || !stagingState) return;

      // Check if it's an opponent piece
      if (isPlayer(selectedTilePiece)) {
        if (selectedTilePiece.type === 'opponent') {
          return;
        }
      }
      if (isCard(selectedTilePiece)) {
        if (selectedTilePiece.owner === 'opponent') {
          return;
        }
      }

      // Prevent movement if actually changed to a different defense mode
      if (isCard(selectedTilePiece) && 
          stagingState.originalIsDefenseMode !== undefined &&
          selectedTilePiece.isDefenseMode !== stagingState.originalIsDefenseMode) {
        return;
      }

      const newPosition = selectedTilePiece.position.clone();
      let moved = false;

      switch (event.key) {
        case "w":
          newPosition.y = Math.min(newPosition.y + 1, 5);
          moved = true;
          break;
        case "s":
          newPosition.y = Math.max(newPosition.y - 1, -5);
          moved = true;
          break;
        case "a":
          newPosition.x = Math.max(newPosition.x - 1, -5);
          moved = true;
          break;
        case "d":
          newPosition.x = Math.min(newPosition.x + 1, 5);
          moved = true;
          break;
      }

      if (moved) {
        // Check if new position is within 1 square of ORIGINAL position
        const originalPos = stagingState.originalPosition;
        const deltaX = Math.abs(newPosition.x - originalPos.x);
        const deltaY = Math.abs(newPosition.y - originalPos.y);
        
        // Only allow if within 1 square in both directions (8 surrounding squares)
        if (deltaX <= 1 && deltaY <= 1) {
          if (isCard(selectedTilePiece)) {
            onTilePieceUpdate({ ...selectedTilePiece, position: newPosition, isDefenseMode: false } as Card);
          } else {
            onTilePieceUpdate({ ...selectedTilePiece, position: newPosition });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTilePiece, onTilePieceUpdate, stagingState]);

  // Calculate guide line positions (horizontal and vertical lines)
  const guideLinePositions = useMemo(() => {
    if (!selectedTilePiece) return [];
    if (isPlayer(selectedTilePiece)) {
      if (selectedTilePiece.type === 'opponent') {
        return [];
      }
    }
    if (isCard(selectedTilePiece)) {
      if (selectedTilePiece.owner === 'opponent') {
        return [];
      }
    }
    const positions: [number, number, number][] = [];
    const pieceX = selectedTilePiece.position.x;
    const pieceY = selectedTilePiece.position.y;

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
  }, [selectedTilePiece]);

  // Calculate valid move positions (8 surrounding squares)
  const validMovePositions = useMemo(() => {
    if (!selectedTilePiece || !stagingState) return [];
    if (isPlayer(selectedTilePiece)) {
      if (selectedTilePiece.type === 'opponent') {
        return [];
      }
    }
    if (isCard(selectedTilePiece)) {
      if (selectedTilePiece.owner === 'opponent') {
        return [];
      }
    }

    const positions: [number, number, number][] = [];
    // Use ORIGINAL position, not current position
    const pieceX = stagingState.originalPosition.x;
    const pieceY = stagingState.originalPosition.y;

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
  }, [selectedTilePiece, stagingState]);

  return (
    <group position={[0, 0, -2]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Render board cursor */}
      <BoardCursor position={cursorPosition} visible={true} />
      
      {tiles.map((square: Tile, index: number) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        return(
          <group key={index}>
            {
              showTilePositions && (        
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
                onTilePieceSelect(null); // Deselect when clicking empty tile
                onTileClick({
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
      {cards.map((card) => {
        const isSelected = selectedTilePiece && isCard(selectedTilePiece) && selectedTilePiece.id === card.id;
        return (
          <YugiohCard
            key={card.id}
            card={card}
            isSelected={!!isSelected}
            isPreview={false}
            onSelect={() => onTilePieceSelect(card)}
          />
        );
      })}
      
      {/* Render player emblems */}
      {players.map((player) => {
        const isSelected = selectedTilePiece && isPlayer(selectedTilePiece) && selectedTilePiece.id === player.id;
        return (
          <PlayerEmblem 
            key={player.id} 
            player={player}
            isSelected={!!isSelected}
            onSelect={() => onTilePieceSelect(player)}
          />
        );
      })}
    </group>
  );
}
