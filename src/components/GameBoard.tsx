import { DoubleSide, Group, Vector3 } from "three";
import { useEffect, useMemo, useRef } from "react";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import BoardCursor from "./BoardCursor";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import type { Tile } from "@/types";
import { useKeyboardHandler } from "@/hooks/useKeyboardHandler";
import { useBoardTiles } from "@/hooks/useBoardTiles";
import { 
  TILE_SIZE, 
  X_AXIS_NEGATIVE_MAX, 
  X_AXIS_POSITIVE_MAX, 
  Y_AXIS_NEGATIVE_MAX, 
  Y_AXIS_POSITIVE_MAX,
  NORTH_BOARD_START,
  SOUTH_BOARD_START,
  EAST_BOARD_START,
  WEST_BOARD_START,
 } from "@/const";
import { ToonBook } from "./ToonBook";
import HandView from "./HandView";
 import SummonCardPreview from "./SummonCardPreview";
import { gameManager } from "@/game/gameManager";

// const VALID_PLAY_COLOR = '#00ccff';
const GUIDE_LINE_COLOR = '#d2d2d2';
const VALID_MOVE_COLOR = '#fff700';

export default function GameBoard() {
  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const inputStore = useInputStore();
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
        let targetPosition = new Vector3(0, 0, 0);
        
        // Determine target position based on board side
        switch(player.boardSide) {
          case 'N':
            targetPosition = new Vector3(NORTH_BOARD_START.x, NORTH_BOARD_START.y, NORTH_BOARD_START.z);
            break;
          case 'S':
            targetPosition = new Vector3(SOUTH_BOARD_START.x, SOUTH_BOARD_START.y, SOUTH_BOARD_START.z);
            break;
          case 'E':
            targetPosition = new Vector3(EAST_BOARD_START.x, EAST_BOARD_START.y, EAST_BOARD_START.z);
            break;
          case 'W':
            targetPosition = new Vector3(WEST_BOARD_START.x, WEST_BOARD_START.y, WEST_BOARD_START.z);
            break;
        }

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
    if (selectedTilePiece.owner === 'opponent') {
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

  return (
    <group position={[0, 0, -2]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* <ToonBook position={[0, 0, 0]} /> */}
      <BoardCursor position={inputStore.cursorPosition} visible={true} />
      {uiStore.showTiles && tiles.map((tile: Tile, index: number) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        return(
          <group key={index}>
            {
              uiStore.showTilePositions && (        
                <Text
                  key={`pos-${index}`}
                  position={[tile.position.x, tile.position.y, tile.position.z + 0.09]}
                  rotation={[0, 0, 0]}
                  fontSize={0.15}
                  color="white"
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.02}
                  outlineColor="black"
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
                      gameManager.select(undefined, tile.position, tile);
                    }} 
                />
              ) : (
                <mesh
                  position={tile.position}
                  onClick={() => {
                    gameManager.select(undefined, tile.position, tile);
                  }}
                >
                  <planeGeometry args={[TILE_SIZE, TILE_SIZE, 64, 64]} />
                  <meshStandardMaterial
                    map={tile.texture}
                    displacementMap={tile.displacementTexture}
                    displacementScale={tile.displacementTexture ? 0.05 : 0}
                    displacementBias={tile.displacementTexture ? 0 : 0} // Shift down to center the displacement
                    roughness={0.5} // Matte look for terrain
                    opacity={1}
                    side={DoubleSide}
                  />
                </mesh>
              )
            }
          </group>
        )})
      }
      
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
              console.log('Selected valid move position:', pos);
              gameManager.select(undefined,pos);
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
            console.log('Selected valid summon position:', pos);
            gameManager.select(undefined, pos);
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
            isSelected={false} // Disable selection border on board as requested
            isPreview={false}
            onSelect={() => {
              console.log('Selected card:');
              console.log(card);
              gameManager.select(card, new Vector3(card.position.x, card.position.y, card.position.z));
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
            onSelect={() => gameManager.select(player, new Vector3(player.position.x, player.position.y, player.position.z))}
          />
        );
      })}

      {gameStore.showHand && <HandView />}
      
      <group rotation={[Math.PI / 2, 0, 0]}>
         <SummonCardPreview />
      </group>
    </group>
  );
}
