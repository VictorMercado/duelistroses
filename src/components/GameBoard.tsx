import { DoubleSide } from "three";
import { useEffect, useMemo } from "react";
import { Text } from "@react-three/drei";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import BoardCursor from "./BoardCursor";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { isCard } from "@/types";
import type { Tile } from "@/types";
import { useKeyboardHandler } from "@/hooks/useKeyboardHandler";
import { useBoardTiles } from "@/hooks/useBoardTiles";
import { SQUARE_SIZE, X_AXIS_NEGATIVE_MAX, X_AXIS_POSITIVE_MAX, Y_AXIS_NEGATIVE_MAX, Y_AXIS_POSITIVE_MAX } from "@/const";

// const VALID_PLAY_COLOR = '#00ccff';
const GUIDE_LINE_COLOR = '#d2d2d2';
const VALID_MOVE_COLOR = '#fff700';

export default function GameBoard() {
  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const inputStore = useInputStore();
  const tiles = useBoardTiles();
  useKeyboardHandler();

  // Notify store when tiles are ready
  useEffect(() => {
    gameStore.setTiles(tiles);
  }, [tiles, gameStore.setTiles]);

  // Calculate guide line positions (horizontal and vertical lines)
  // move to game store
  const guideLinePositions = useMemo(() => {
    if (!inputStore.selectedTilePiece) return [];
    if (inputStore.selectedTilePiece.owner === 'opponent') {
      return [];
    }

    const positions: [number, number, number][] = [];
    const pieceX = inputStore.selectedTilePiece.position.x;
    const pieceY = inputStore.selectedTilePiece.position.y;

    // Horizontal positions (same Y, different X)
    for (let x = X_AXIS_NEGATIVE_MAX; x <= X_AXIS_POSITIVE_MAX; x++) {
      if (x !== pieceX) {
        positions.push([x, pieceY, 0.05]);
      }
    }

    // Vertical positions (same X, different Y)
    for (let y = Y_AXIS_NEGATIVE_MAX; y <= Y_AXIS_POSITIVE_MAX; y++) {
      if (y !== pieceY) {
        positions.push([pieceX, y, 0.05]);
      }
    }

    return positions;
  }, [inputStore.selectedTilePiece]);

  // Get valid move positions from gameStore (cardinal directions only)
  const validMovePositions = gameStore.getValidMovePositions();

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
          <meshBasicMaterial color={GUIDE_LINE_COLOR} transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      ))}

      {/* Render valid move positions (surrounding squares) */}
      {validMovePositions.map((pos, index) => (
        <mesh key={`valid-${index}`} position={pos} rotation={[0, 0, 0]}>
          <planeGeometry args={[SQUARE_SIZE, SQUARE_SIZE]} />
          <meshBasicMaterial color={VALID_MOVE_COLOR} transparent opacity={0.6} side={DoubleSide} />
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
        return (
          <PlayerEmblem 
            key={player.id} 
            player={player}
            onSelect={() => inputStore.selectTilePiece(player)}
          />
        );
      })}
    </group>
  );
}
