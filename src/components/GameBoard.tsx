import { DoubleSide, Vector3 } from "three";
import { useEffect, useMemo } from "react";
import { useTexture, Text } from "@react-three/drei";
import YugiohCard from "./YugiohCard";
import PlayerEmblem from "./PlayerEmblem";
import type { Card, Tile, Player, TilePiece } from "@/types";

const BOARD_SIZE = 11;
const SQUARE_SIZE = 1;

interface GameBoardProps {
  cards: Card[];
  onCardUpdate: (card: Card) => void;
  selectedCardId: number | null;
  onCardSelect: (card: Card | null) => void;
  onTileHover: (tile: Tile | null) => void;
  onTileClick: (tile: Tile | null) => void;
  players: Player[];
  showTilePositions: boolean;
  selectedPlayer: Player | null;
  onPlayerSelect: (player: Player | null) => void;
  onPlayerUpdate: (player: Player) => void;
  selectedTilePiece: TilePiece | null;
  onTilePieceSelect: (tilePiece: TilePiece | null) => void;
}

export default function GameBoard({ cards, onCardUpdate, selectedCardId, onCardSelect, onTileHover, onTileClick, players, showTilePositions, selectedPlayer, onPlayerSelect, onPlayerUpdate, selectedTilePiece, onTilePieceSelect }: GameBoardProps) {
  // Load grass texture
  const grassTexture = useTexture('/textures/grass.png');
  const darkTexture = useTexture('/textures/dark.png');
  const labyrinthTexture = useTexture('/textures/labyrinth.png');
  const normalTexture = useTexture('/textures/normal.png');
  const waterTexture = useTexture('/textures/water.png');
  

  const tilesAssets : Tile[] = [
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
  ]

  const squares: Tile[] = useMemo(() => {
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
  }, []);

  const handleCardSelect = (card: Card) => {
    onCardSelect(card.id === selectedCardId ? null : card);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle card movement
      if (selectedCardId !== null) {
        const card = cards.find((c) => c.id === selectedCardId);
        if (card && card.owner === 'player') {
            const newPosition = card.position.clone();
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
              onCardUpdate({ ...card, position: newPosition, isDefenseMode: false });
            }
        }
      }
      
      // Handle player movement
      if (selectedPlayer !== null) {
        const newPosition = selectedPlayer.position.clone();
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
          onPlayerUpdate({ ...selectedPlayer, position: newPosition });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cards, selectedCardId, onCardUpdate, selectedPlayer, onPlayerUpdate]);


  // Calculate valid move positions for the selected card
  const validMovePositions = useMemo(() => {
    if (!selectedCardId && !selectedPlayer) return [];
    
    if (selectedPlayer) {
      const positions: [number, number, number][] = [];
      const playerX = selectedPlayer.position.x;
      const playerY = selectedPlayer.position.y;
      
      // Horizontal positions (same Y, different X)
      for (let x = -5; x <= 5; x++) {
        if (x !== playerX) {
          positions.push([x, playerY, 0.05]);
        }
      }
      
      // Vertical positions (same X, different Y)
      for (let y = -5; y <= 5; y++) {
        if (y !== playerY) {
          positions.push([playerX, y, 0.05]);
        }
      }
      return positions;
    }

    const selectedCard = cards.find(c => c.id === selectedCardId);
    if (!selectedCard || selectedCard.owner !== 'player') return [];
    
    const positions: [number, number, number][] = [];
    const cardX = selectedCard.position.x;
    const cardY = selectedCard.position.y;
    
    // Horizontal positions (same Y, different X)
    for (let x = -5; x <= 5; x++) {
      if (x !== cardX) {
        positions.push([x, cardY, 0.05]);
      }
    }
    
    // Vertical positions (same X, different Y)
    for (let y = -5; y <= 5; y++) {
      if (y !== cardY) {
        positions.push([cardX, y, 0.05]);
      }
    }
    
    return positions;
  }, [selectedCardId, cards, selectedPlayer]);

  return (
    <group position={[0, 0, -2]} rotation={[-Math.PI / 2, 0, 0]}>
      {squares.map((square, index) => {
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
                onCardSelect(null); // Deselect card when clicking a tile
                onPlayerSelect(null);
                onTileClick({
                  type: square.type,
                  name: square.name,
                  position: square.position,
                  texture: square.texture,
                });
              }}
              // onPointerOver={() => {
              //   onTileHover({
              //     type: square.type,
              //     name: square.name,
              //     position: square.position,
              //     texture: square.texture,
              //   });
              // }}
              // onPointerOut={() => {
              //   onTileHover(null);
              // }}
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
      
      {/* Movement indicators */}
      {validMovePositions.map((pos, index) => (
        <mesh key={`indicator-${index}`} position={pos}>
          <planeGeometry args={[SQUARE_SIZE * 0.9, SQUARE_SIZE * 0.9]} />
          <meshStandardMaterial
            color="white"
            transparent
            opacity={0.3}
            side={DoubleSide}
          />
        </mesh>
      ))}
      
      {cards.map((card) => {
        return (
          <YugiohCard
            key={card.id}
            card={card}
            isSelected={card.id === selectedCardId}
            onSelect={() => handleCardSelect(card)}
          />
        );
      })}
      
      {/* Render player emblems */}
      {players.map((player) => (
        <PlayerEmblem 
          key={player.id} 
          player={player}
          isSelected={player.id === selectedPlayer?.id}
          onSelect={() => {
            onCardSelect(null); // Deselect any card when selecting player
            onPlayerSelect(player);
          }}
        />
      ))}
    </group>
  );
}
