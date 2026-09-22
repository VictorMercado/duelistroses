import { DoubleSide, Group } from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import BoardCursor from "./BoardCursor";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import type { Tile } from "@/types";
import { useKeyboardHandler } from "@/hooks/useKeyboardHandler";
import { useBoardTiles } from "@/hooks/useBoardTiles";
import {
  TILE_SIZE,
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX,
} from "@/const";
import { InputManager } from "@/game/InputManager";
import { gameManager } from "@/game/gameManager";
import { MemoizedTile } from "../Tile";

// const VALID_PLAY_COLOR = '#00ccff';
const GUIDE_LINE_COLOR = '#d2d2d2';
const VALID_MOVE_COLOR = '#fff700';

export default function GameBoard() {
  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const tiles = useBoardTiles();
  useKeyboardHandler();

  const playerRefs = useRef<Record<string, Group | null>>({});
  const timeElapsed = useRef(0);
  const finishedPlayers = useRef<Set<string>>(new Set());

  // Notify store when tiles are ready
  useEffect(() => {
    gameStore.setTiles(tiles);
  }, [tiles, gameStore.setTiles]);

  // Animation loop for players
  useFrame((_, delta) => {
    timeElapsed.current += delta;

    if (timeElapsed.current < 2) return;

    gameStore.players.forEach((player) => {
      // Skip if already finished animating
      if (finishedPlayers.current.has(String(player.id))) return;

      const ref = playerRefs.current[String(player.id)];
      if (ref) {
        // The server decides where each leader stands.
        const targetPosition = player.position.clone();

        // Smoothly interpolate towards target
        ref.position.lerp(targetPosition, delta * 5);

        // Check if close enough to snap and update store
        if (ref.position.distanceTo(targetPosition) < 0.01) {
          ref.position.copy(targetPosition);
          finishedPlayers.current.add(String(player.id));

          // Update store with final position
          // We need to be careful not to trigger re-renders that reset the animation loop unnecessarily
          // But since we check finishedPlayers, it should be fine.
          gameStore.updatePlayer({ ...player, position: targetPosition });
        }
      }
    });
  });

  // Calculate guide line positions (horizontal and vertical lines)
  // move to game store
  const guideLinePositions = useMemo(() => {
    const selectedTilePiece = gameManager.selectedTilePiece;
    if (!selectedTilePiece) return [];
    if (!gameManager.isUsersPiece(selectedTilePiece)) {
      return [];
    }

    const positions: [number, number, number][] = [];
    const pieceX = selectedTilePiece.position.x;
    const pieceY = selectedTilePiece.position.y;

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
  }, [gameManager.selectedTilePiece]);

  // Get valid move positions from gameStore (cardinal directions only)
  const validMovePositions = gameManager.selectedTilePiece && gameManager.isUsersPiece(gameManager.selectedTilePiece) ? gameStore.getValidMovePositions() : [];

  // Get valid summon positions if in summoning mode OR hand is open
  const isSummoning = gameStore.summoningState;
  const validSummonPositions = isSummoning ? gameStore.getValidSummonPositions() : [];
  const zBoardPosition = 1;

  // The server tells each seat which edge it looks from; north seats see the
  // board turned around so their own side is nearest to them.
  const boardRotation = gameManager.boardFacing === 'N' ? Math.PI : 0;

  return (
    <group position={[0, 0, zBoardPosition]} rotation={[0, 0, boardRotation]}>
      {/* <ToonBook position={[0, 0, 0]} /> */}
      <BoardCursor position={gameStore.cursorPosition} visible={true} />
      {uiStore.showTiles && tiles.map((tile: Tile, index: number) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        return (
          <MemoizedTile key={index} tile={tile} />
        );
      })}

      {/* Render movement guide lines */}
      {guideLinePositions.map((pos, index) => (
        <mesh key={`guide-${index}`} position={pos} rotation={[0, 0, 0]}>
          <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
          <meshBasicMaterial color={GUIDE_LINE_COLOR} transparent opacity={0.4} side={DoubleSide} />
        </mesh>
      ))}

      {/* Render valid move positions (surrounding squares) */}
      {validMovePositions.map((pos, index) => (
        <mesh key={`valid-move-${index}`}
          position={pos}
          rotation={[0, 0, 0]}
          onClick={(e) => {
            // Stop propagation so we don't click the tile underneath
            e.stopPropagation();
            InputManager.getInstance().handleInteraction('SELECT', { pos });
            // Check if we have a card selected from hand (via inputStore)
            // if (inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece)) {
            //   const cardInHand = gameStore.handCards.find(c => c.id === inputStore.selectedTilePiece?.id);
            //   if (cardInHand) {
            //     gameStore.summonCard(cardInHand, pos);
            //     // Clear selection after summoning
            //     inputStore.selectTilePiece(null);
            //   }
            // }
          }}>
          <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
          <meshBasicMaterial color={VALID_MOVE_COLOR} transparent opacity={0.6} side={DoubleSide} />
        </mesh>
      ))}

      {validSummonPositions.map((pos, index) => (
        <mesh
          key={`valid-summon-${index}`}
          position={pos}
          rotation={[0, 0, 0]}
          onClick={(e) => {
            // Stop propagation so we don't click the tile underneath
            e.stopPropagation();
            InputManager.getInstance().handleInteraction('SELECT', { pos });
            // Check if we have a card selected from hand (via inputStore)
            // if (inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece)) {
            //   const cardInHand = gameStore.handCards.find(c => c.id === inputStore.selectedTilePiece?.id);
            //   if (cardInHand) {
            //     gameStore.summonCard(cardInHand, pos);
            //     // Clear selection after summoning
            //     inputStore.selectTilePiece(null);
            //   }
            // }
          }}
        >
          <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
          <meshBasicMaterial color="#0055ff" transparent opacity={0.5} side={DoubleSide} />
        </mesh>
      ))}

      {/* Render cards */}
      {uiStore.showCards && gameStore.cards.map((card) => {
        return (
          <YugiohCard
            key={card.id}
            card={card}
            isPreview={false}
            onSelect={() => {
              InputManager.getInstance().handleInteraction('SELECT', { piece: card, pos: card.position });
            }}
          />
        );
      })}

      {/* Render player emblems */}
      {uiStore.showPlayers && gameStore.players.map((player) => {
        return (
          <PlayerEmblem
            key={player.id}
            ref={(el) => { playerRefs.current[String(player.id)] = el; }}
            player={player}
            onSelect={() => InputManager.getInstance().handleInteraction('SELECT', { piece: player, pos: player.position })}
          />
        );
      })}
    </group>
  );
}
