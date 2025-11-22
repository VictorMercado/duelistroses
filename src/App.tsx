import { Vector3 } from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import StaticAxisHelper from "@/components/StaticAxisHelper";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import CardPreview from "@/components/CardPreview";
import TilePreview from "@/components/TilePreview";
import PlayerEmblem from "@/components/PlayerEmblem";
import FPSCounter from "@/components/FPSCounter";
import type { Card, Tile, Player, TilePiece } from "@/types";
import { useState, useEffect, useRef } from 'react';

function App() {
  const [enableZoom, setEnableZoom] = useState(true);
  const [enableRotate, setEnableRotate] = useState(true);
  const [enablePan, setEnablePan] = useState(true);
  const [showTilePositions, setShowTilePositions] = useState(true);
  const [showFPS, setShowFPS] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedTilePiece, setSelectedTilePiece] = useState<TilePiece | null>(null);

  const controlsRef = useRef<any>(null);

  const [hoveredTile, setHoveredTile] = useState<Tile | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);

  const [cards, setCards] = useState<Card[]>([
    {
      id: 1,
      name: "Dark Magician",
      attack: 2500,
      defense: 2100,
      description: "The ultimate wizard in terms of attack and defense.",
      owner: "player",
      position: new Vector3(1, -5, 0.11),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Dark_Magician.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 2,
      name: "Blue-Eyes White Dragon",
      attack: 3000,
      defense: 2500,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "opponent",
      position: new Vector3(0, 4, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_White_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 3,
      name: "Dark Magician Girl",
      attack: 2000,
      defense: 1600,
      description: "The Dark Magician's younger sister. She wields the power of the Dark Magician.",
      owner: "player",
      position: new Vector3(-2, -5, 0.13),
      isFaceDown: true,
      isDefenseMode: false,
      level: 6,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Dark_Magician_Girl.png",
      textureTemplateUrl: "/textures/effectTemplate.png",
    },
    {
      id: 4,
      name: "Red-Eyes Black Dragon",
      attack: 2400,
      defense: 2000,
      description: "A ferocious dragon with a deadly attack.",
      owner: "opponent",
      position: new Vector3(2, 5, 0.14),
      isFaceDown: true,
      isDefenseMode: false,
      level: 7,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Red_Eyes_Black_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 5,
      name: "Blue-Eyes White Dragon",
      attack: 3000,
      defense: 2500,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "player",
      position: new Vector3(0, -2, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_White_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 6,
      name: "Blue-Eyes Ultimate Dragon",
      attack: 4500,
      defense: 3800,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "player",
      position: new Vector3(1, -2, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 12,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_Ultimate_Dragon.png",
      textureTemplateUrl: "/textures/fusionTemplate.png",
    },
    {
      id: 7,
      name: "Black Luster Soldier",
      attack: 3000,
      defense: 2500,
      description: "This monster can only be Ritual Summoned with the Ritual Spell Card, Black Luster Ritual.",
      owner: "player",
      position: new Vector3(-1, -5, 0.13),
      isFaceDown: false,
      isDefenseMode: false,
      level: 8,
      attribute: "Earth",
      attributeUrl: "/attributes/earthAttr.svg",
      textureUrl: "/cards/Black_Luster_Soldier.png",
      textureTemplateUrl: "/textures/ritualTemplate.png",
    },
    {
      id: 8,
      name: "Change of Heart",
      attack: -1,
      defense: -1,
      description: "Target 1 monster your opponent controls; change its ATK and DEF to 0.",
      owner: "player",
      position: new Vector3(0, -3, 0.11),
      isFaceDown: true,
      isDefenseMode: false,
      level: 0,
      attribute: "Spell",
      attributeUrl: "/attributes/spellAttr.png",
      textureUrl: "/cards/Change_of_Heart.png",
      textureTemplateUrl: "/textures/magicTemplate.png",
    }
  ]);

  // Players setup
  const [players, setPlayers] = useState<Player[]>([
    {
      id: 1,
      name: "Player 1",
      clan: "Yorkists",
      textureUrl: "/textures/Red_rose_emblem.png",
      position: new Vector3(0, -5, 0.2),
      allCards: cards.filter(c => c.id === 1 || c.id === 3 || c.id === 5),
      cardsInPlay: [1, 3],
      isHuman: true,
    },
    {
      id: 2,
      name: "Opponent",
      clan: "Lancastrians",
      textureUrl: "/textures/White_rose_emblem.png",
      position: new Vector3(0, 5, 0.2),
      allCards: cards.filter(c => c.id === 2 || c.id === 4 || c.id === 6),
      cardsInPlay: [2, 4],
      isHuman: false,
    },
  ]);

  const handleCardUpdate = (updatedCard: Card) => {
    setCards((prevCards) =>
      prevCards.map((card) => (card.id === updatedCard.id ? updatedCard : card))
    );
    if (selectedCard?.id === updatedCard.id) {
      setSelectedCard(updatedCard);
    }
  };

  const handlePlayerUpdate = (updatedPlayer: Player) => {
    setPlayers((prevPlayers) =>
      prevPlayers.map((player) => (player.id === updatedPlayer.id ? updatedPlayer : player))
    );
  };

  const handleFlip = (selectedCard: Card) => {
    // if (selectedCard.isFaceDown) {
      const updated = { ...selectedCard, isFaceDown: !selectedCard.isFaceDown };
      handleCardUpdate(updated);
    // }
  };
  const handlePosition = (selectedCard: Card) => {
    const updated = { ...selectedCard, isDefenseMode: !selectedCard.isDefenseMode };
    handleCardUpdate(updated);
  };

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCard(null);
        setSelectedPlayer(null);
        setShowDetails(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 15, 10], fov: 30 }}>
        <ambientLight intensity={5} />
        {/* <pointLight position={[10, 10, 10]} /> */}
        <GameBoard 
          cards={cards}
          onCardUpdate={handleCardUpdate}
          selectedCardId={selectedCard?.id ?? null} 
          onCardSelect={setSelectedCard}
          onTileHover={setHoveredTile}
          onTileClick={setSelectedTile}
          players={players}
          showTilePositions={showTilePositions}
          selectedPlayer={selectedPlayer}
          onPlayerSelect={setSelectedPlayer}
          onPlayerUpdate={handlePlayerUpdate}
          selectedTilePiece={selectedTilePiece}
          onTilePieceSelect={setSelectedTilePiece}
        />
        <OrbitControls
          ref={controlsRef}
          enableZoom={enableZoom}
          enableRotate={enableRotate}
          enablePan={enablePan}
          makeDefault
          minPolarAngle={50 * Math.PI / 180}
          maxPolarAngle={50 * Math.PI / 180}
          minDistance={14}
          maxDistance={14}
        />
      </Canvas>
      {showFPS && <FPSCounter />}
      <StaticAxisHelper />
      <div className="absolute top-0 right-0 text-white p-4 bg-black bg-opacity-50">
        <p>Use W, A, S, D keys to move the card</p>
        <p>Red: X-axis, Green: Y-axis, Blue: Z-axis</p>
      </div>
      <ControlPanel
        enableZoom={enableZoom}
        setEnableZoom={setEnableZoom}
        enableRotate={enableRotate}
        setEnableRotate={setEnableRotate}
        enablePan={enablePan}
        setEnablePan={setEnablePan}
        onResetCamera={handleResetCamera}
        controlsRef={controlsRef}
        showTilePositions={showTilePositions}
        setShowTilePositions={setShowTilePositions}
        showFPS={showFPS}
        setShowFPS={setShowFPS}
      />
      
      {selectedCard && selectedCard.owner === 'player' && !showDetails && (
        <ActionMenu
          onMove={() => console.log("Move clicked")}
          onAttack={() => console.log("Attack clicked")}
          onChangePosition={ () => handlePosition(selectedCard)}
          onFlip={() => handleFlip(selectedCard)}
          onDetails={() => setShowDetails(true)}
          isDefenseMode={selectedCard.isDefenseMode}
        />
      )}

      {showDetails && selectedCard && (
        <CardDetailView
          card={selectedCard}
          onClose={() => setShowDetails(false)}
        />
      )}

      {selectedCard && !showDetails && selectedCard.owner === 'player' && (
        <CardPreview card={selectedCard} />
      )}

      {(hoveredTile || selectedTile) && (
        <TilePreview tile={hoveredTile || selectedTile!} />
      )}
    </div>
  );
}

export default App


// import { createFileRoute } from "@tanstack/react-router";

// export const Route = createFileRoute("/yugioh")({
//   component: YugiohPage,
// })
