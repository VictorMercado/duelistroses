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
import SettingsModal from "@/components/SettingsModal";
import FPSCounter from "@/components/FPSCounter";
import type { Card, Tile, Player, TilePiece, TurnState, StagingState } from "@/types";
import { isCard, isPlayer } from "@/types";
import type { KeyBindings } from "@/types/KeyBindings";
import { DEFAULT_KEYBINDINGS } from "@/types/KeyBindings";
import { useState, useEffect, useRef } from 'react';

function App() {
  const [enableZoom, setEnableZoom] = useState(true);
  const [enableRotate, setEnableRotate] = useState(true);
  const [enablePan, setEnablePan] = useState(true);
  const [showTilePositions, setShowTilePositions] = useState(true);
  const [showFPS, setShowFPS] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const [selectedTilePiece, setSelectedTilePiece] = useState<TilePiece | null>(null);

  // Turn system state
  const [turnState, setTurnState] = useState<TurnState>({
    currentTurn: 'player',
    actedPieceIds: []
  });
  const [stagingState, setStagingState] = useState<StagingState | null>(null);

  // Helper to create composite key for tracking acted pieces
  const getPieceKey = (piece: TilePiece): string => {
    const type = isCard(piece) ? 'card' : 'player';
    return `${type}-${piece.id}`;
  };

  const controlsRef = useRef<any>(null);

  const [hoveredTile, setHoveredTile] = useState<Tile | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  
  // Cursor and keyboard navigation
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: -5 });
  const [keyBindings, setKeyBindings] = useState<KeyBindings>(() => {
    const saved = localStorage.getItem('keyBindings');
    return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS;
  });
  const [showSettings, setShowSettings] = useState(false);
  
  const handleUpdateKeyBindings = (bindings: KeyBindings) => {
    setKeyBindings(bindings);
    localStorage.setItem('keyBindings', JSON.stringify(bindings));
  };
  
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
      isFaceDown: false,
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
      type: "player",
    },
    {
      id: 2,
      name: "Opponent",
      clan: "Lancastrians",
      textureUrl: "/textures/White_rose_emblem.png",
      position: new Vector3(0, 5, 0.2),
      allCards: cards.filter(c => c.id === 2 || c.id === 4 || c.id === 6),
      cardsInPlay: [2, 4],
      type: "opponent",
    },
  ]);

  const handleTilePieceUpdate = (updatedTilePiece: TilePiece) => {
    if (isCard(updatedTilePiece)) {
      setCards((prevCards) =>
        prevCards.map((card) => (card.id === updatedTilePiece.id ? updatedTilePiece : card))
      );
    } else if (isPlayer(updatedTilePiece)) {
      setPlayers((prevPlayers) =>
        prevPlayers.map((player) => (player.id === updatedTilePiece.id ? updatedTilePiece : player))
      );
    }
    
    // Update selectedTilePiece if it's the one being updated
    if (selectedTilePiece && selectedTilePiece.id === updatedTilePiece.id) {
      setSelectedTilePiece(updatedTilePiece);
      
      // Update selectedTile to the tile at the piece's new position
      const tileX = Math.round(updatedTilePiece.position.x);
      const tileY = Math.round(updatedTilePiece.position.y);
      const tileAtPosition = tiles.find(tile => 
        Math.round(tile.position.x) === tileX && 
        Math.round(tile.position.y) === tileY
      );      if (tileAtPosition) {
        setSelectedTile(tileAtPosition);
      }
    }

    // Track if piece moved during staging
    if (stagingState && updatedTilePiece.id === stagingState.pieceId) {
      const moved = !updatedTilePiece.position.equals(stagingState.originalPosition);
      if (moved && !stagingState.hasMoved) {
        setStagingState({ ...stagingState, hasMoved: true });
      }
    }
  };

  const handleFlip = (selectedCard: Card) => {
    // If the card is not face-down, do nothing
    if (turnState.actedPieceIds.includes(selectedCard.id.toString())) {
      return;
    }
    // if (!selectedCard.isFaceDown) {
    //   return;
    // }
    // During staging, allow toggling between face-up and face-down freely
    // The "can't flip face-down once face-up" rule only applies after committing
    
    // Flipping is allowed even after moving - no position check needed
    
    const updated = { ...selectedCard, isFaceDown: !selectedCard.isFaceDown };
    handleTilePieceUpdate(updated);
    
    // Mark as flipped in staging
    if (stagingState && selectedCard.id === stagingState.pieceId) {
      setStagingState({ ...stagingState, hasFlipped: true });
    }
  };
  
  const handlePosition = (selectedCard: Card) => {
    // Can't change position if actually moved to a different position
    if (stagingState && !selectedCard.position.equals(stagingState.originalPosition)) return;
    
    const updated = { ...selectedCard, isDefenseMode: !selectedCard.isDefenseMode };
    handleTilePieceUpdate(updated);
    
    // Mark as changed position in staging
    if (stagingState && selectedCard.id === stagingState.pieceId) {
      setStagingState({ ...stagingState, hasChangedPosition: true });
    }
  };

  const handleCommitAction = () => {
    if (!selectedTilePiece || !stagingState) return;
    
    // Check if any action was taken (moved, flipped, or changed position)
    const actuallyMoved = !selectedTilePiece.position.equals(stagingState.originalPosition);
    if (!actuallyMoved && !stagingState.hasFlipped && !stagingState.hasChangedPosition) {
      // No action taken, just deselect
      setSelectedTilePiece(null);
      setStagingState(null);
      return;
    }
    
    // Mark piece as having acted
    setTurnState(prev => ({
      ...prev,
      actedPieceIds: [...prev.actedPieceIds, getPieceKey(selectedTilePiece)]
    }));
    
    // Clear staging and selection
    setStagingState(null);
    setSelectedTilePiece(null);
  };

  const handleCancelAction = () => {
    if (!stagingState || !selectedTilePiece) return;
    
    // Revert to original state (position, flip, defense mode)
    let reverted = { ...selectedTilePiece, position: stagingState.originalPosition };
    
    // Revert card-specific states if it's a card
    if (isCard(reverted) && stagingState.originalIsFaceDown !== undefined) {
      reverted.isFaceDown = stagingState.originalIsFaceDown;
    }
    if (isCard(reverted) && stagingState.originalIsDefenseMode !== undefined) {
      reverted.isDefenseMode = stagingState.originalIsDefenseMode;
    }
    
    handleTilePieceUpdate(reverted);
    
    // Clear staging and selection
    setStagingState(null);
    setSelectedTilePiece(null);
  };


  const handleTilePieceSelect = (tilePiece: TilePiece | null) => {
    if (tilePiece === selectedTilePiece) {
      // setSelectedTilePiece(null);
      return;
    }
    if (!tilePiece) {
      // Deselecting - cancel any staging
      handleCancelAction();
      return;
    }
    
    // If there's an active staging session for a different piece, cancel it first
    if (stagingState && selectedTilePiece) {
      // Check if it's truly a different piece (not just same ID but different type)
      const isDifferentPiece = 
        selectedTilePiece.id !== tilePiece.id || 
        (isCard(selectedTilePiece) !== isCard(tilePiece));
      
      if (isDifferentPiece) {
        // Revert the previous piece to its original position
        const reverted = { ...selectedTilePiece, position: stagingState.originalPosition };
        handleTilePieceUpdate(reverted);
      }
    }
    
    // Check if piece has already acted this turn
    if (turnState.actedPieceIds.includes(getPieceKey(tilePiece))) {
      // Allow selection for viewing only, don't enter staging mode
      setSelectedTilePiece(tilePiece);
      setStagingState(null);
      
      // Update selectedTile to show tile at piece's position
      const tileX = Math.round(tilePiece.position.x);
      const tileY = Math.round(tilePiece.position.y);
      const tileAtPosition = tiles.find(tile => 
        Math.round(tile.position.x) === tileX && 
        Math.round(tile.position.y) === tileY
      );
      if (tileAtPosition) {
        setSelectedTile(tileAtPosition);
      }
      
      // Move cursor to piece position
      setCursorPosition({ x: tileX, y: tileY });
      return;
    }
    
    // Check if it's the correct player's turn
    const isPlayerPiece = (isCard(tilePiece) && tilePiece.owner === 'player') || 
                         (isPlayer(tilePiece) && tilePiece.type === 'player');
    
    if ((turnState.currentTurn === 'player' && !isPlayerPiece) ||
        (turnState.currentTurn === 'opponent' && isPlayerPiece)) {
      // Allow selection for viewing only, don't enter staging mode
      setSelectedTilePiece(tilePiece);
      setStagingState(null);
      
      // Update selectedTile to show tile at piece's position
      const tileX = Math.round(tilePiece.position.x);
      const tileY = Math.round(tilePiece.position.y);
      const tileAtPosition = tiles.find(tile => 
        Math.round(tile.position.x) === tileX && 
        Math.round(tile.position.y) === tileY
      );
      if (tileAtPosition) {
        setSelectedTile(tileAtPosition);
      }
      
      // Move cursor to piece position
      setCursorPosition({ x: tileX, y: tileY });
      return;
    }
    
    // Initialize staging state for pieces that can act
    const newStagingState: StagingState = {
      pieceId: tilePiece.id,
      originalPosition: tilePiece.position.clone(),
      hasMoved: false,
      hasFlipped: false,
      hasChangedPosition: false
    };
    
    // Save original card states if it's a card
    if (isCard(tilePiece)) {
      newStagingState.originalIsFaceDown = tilePiece.isFaceDown;
      newStagingState.originalIsDefenseMode = tilePiece.isDefenseMode;
    }
    
    setStagingState(newStagingState);
    
    setSelectedTilePiece(tilePiece);
    
    // Update selectedTile to show tile at piece's position
    const tileX = Math.round(tilePiece.position.x);
    const tileY = Math.round(tilePiece.position.y);
    const tileAtPosition = tiles.find(tile => 
      Math.round(tile.position.x) === tileX && 
      Math.round(tile.position.y) === tileY
    );
    if (tileAtPosition) {
      setSelectedTile(tileAtPosition);
    }
    
    // Move cursor to piece position
    setCursorPosition({ x: tileX, y: tileY });
  };

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  // Calculate valid move positions for cursor constraint
  const getValidMovePositions = (): Set<string> => {
    if (!selectedTilePiece || !stagingState) return new Set();
    
    const validPositions = new Set<string>();
    const originalPos = stagingState.originalPosition;
    
    // Add the 8 surrounding squares
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip center
        const x = Math.round(originalPos.x) + dx;
        const y = Math.round(originalPos.y) + dy;
        if (x >= -5 && x <= 5 && y >= -5 && y <= 5) {
          validPositions.add(`${x},${y}`);
        }
      }
    }
    
    // Also add the original position
    validPositions.add(`${Math.round(originalPos.x)},${Math.round(originalPos.y)}`);
    
    return validPositions;
  };

  // Keyboard handler for cursor movement and actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const validPositions = getValidMovePositions();
      const isInStagingMode = selectedTilePiece && stagingState;
      
      // Cursor movement
      if (e.key.toLowerCase() === keyBindings.cursorUp.toLowerCase()) {
        const newY = Math.min(5, cursorPosition.y + 1);
        const newPosKey = `${cursorPosition.x},${newY}`;
        if (!isInStagingMode || validPositions.has(newPosKey)) {
          setCursorPosition(prev => ({ ...prev, y: newY }));
        }
        return;
      }
      if (e.key.toLowerCase() === keyBindings.cursorDown.toLowerCase()) {
        const newY = Math.max(-5, cursorPosition.y - 1);
        const newPosKey = `${cursorPosition.x},${newY}`;
        if (!isInStagingMode || validPositions.has(newPosKey)) {
          setCursorPosition(prev => ({ ...prev, y: newY }));
        }
        return;
      }
      if (e.key.toLowerCase() === keyBindings.cursorLeft.toLowerCase()) {
        const newX = Math.max(-5, cursorPosition.x - 1);
        const newPosKey = `${newX},${cursorPosition.y}`;
        if (!isInStagingMode || validPositions.has(newPosKey)) {
          setCursorPosition(prev => ({ ...prev, x: newX }));
        }
        return;
      }
      if (e.key.toLowerCase() === keyBindings.cursorRight.toLowerCase()) {
        const newX = Math.min(5, cursorPosition.x + 1);
        const newPosKey = `${newX},${cursorPosition.y}`;
        if (!isInStagingMode || validPositions.has(newPosKey)) {
          setCursorPosition(prev => ({ ...prev, x: newX }));
        }
        return;
      }
      
      // Action keys
      if (e.key === "Enter") {
        handleCommitAction();
        return;
      }
      
      // Cancel keys
      if (keyBindings.cancel.includes(e.key)) {
        handleCancelAction();
        setShowDetails(false);
        return;
      }
      
      // Select key
      if (e.key.toLowerCase() === keyBindings.select.toLowerCase()) {
        // If already in staging mode, commit the action
        if (selectedTilePiece && stagingState) {
          handleCommitAction();
          return;
        }
        
        // Otherwise, find and select piece at cursor position
        const pieceAtCursor = [...cards, ...players].find(piece => 
          Math.round(piece.position.x) === cursorPosition.x &&
          Math.round(piece.position.y) === cursorPosition.y
        );
        
        if (pieceAtCursor) {
          handleTilePieceSelect(pieceAtCursor);
        }
        return;
      }
      
      // View details key
      if (e.key.toLowerCase() === keyBindings.viewDetails.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece)) {
          setShowDetails(true);
        }
        return;
      }
      
      // Flip card key
      if (e.key.toLowerCase() === keyBindings.flipCard.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece)) {
          handleFlip(selectedTilePiece);
        }
        return;
      }
      
      // Change position key
      if (e.key.toLowerCase() === keyBindings.changePosition.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece)) {
          handlePosition(selectedTilePiece);
        }
        return;
      }
      
      // Play card key (placeholder)
      if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) {
        console.log('Play card action - not yet implemented');
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyBindings, cursorPosition, cards, players, selectedTilePiece, stagingState, handleCancelAction, handleCommitAction]);

  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 15, 10], fov: 30 }}>
        <ambientLight intensity={5} />
        {/* <pointLight position={[10, 10, 10]} /> */}
        <GameBoard 
          cards={cards}
          players={players}
          selectedTilePiece={selectedTilePiece}
          onTilePieceSelect={handleTilePieceSelect}
          onTilePieceUpdate={handleTilePieceUpdate}
          onTileHover={setHoveredTile}
          onTileClick={setSelectedTile}
          onTilesReady={setTiles}
          cursorPosition={cursorPosition}
          showTilePositions={showTilePositions}
          turnState={turnState}
          stagingState={stagingState}
        />
        <OrbitControls
          ref={controlsRef}
          enableZoom={enableZoom}
          enableRotate={enableRotate}
          enablePan={enablePan}
          makeDefault
          minPolarAngle={50 * Math.PI / 180}
          maxPolarAngle={50 * Math.PI / 180}
          minAzimuthAngle={0}
          maxAzimuthAngle={0}
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

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        keyBindings={keyBindings}
        onUpdateKeyBindings={handleUpdateKeyBindings}
      />

      {/* Control Panel */}
      <ControlPanel
        enableZoom={enableZoom}
        setEnableZoom={setEnableZoom}
        enableRotate={enableRotate}
        setEnableRotate={setEnableRotate}
        enablePan={enablePan}
        setEnablePan={setEnablePan}
        onResetCamera={handleResetCamera}
        onOpenSettings={() => setShowSettings(true)}
        controlsRef={controlsRef}
        showTilePositions={showTilePositions}
      setShowTilePositions={setShowTilePositions}
        showFPS={showFPS}
        setShowFPS={setShowFPS}
      />
      
      {selectedTilePiece && isCard(selectedTilePiece) && selectedTilePiece.owner === 'player' && !showDetails && !turnState.actedPieceIds.includes(getPieceKey(selectedTilePiece)) && (
        <ActionMenu 
          onMove={() => {}} 
          onAttack={() => {}}
          onChangePosition={() => handlePosition(selectedTilePiece)}
          onFlip={() => handleFlip(selectedTilePiece)}
          onDetails={() => setShowDetails(true)}
          onCommit={handleCommitAction}
          onCancel={handleCancelAction}
          isDefenseMode={selectedTilePiece.isDefenseMode}
          isFaceDown={selectedTilePiece.isFaceDown}
          hasMoved={
            stagingState 
              ? !selectedTilePiece.position.equals(stagingState.originalPosition)
              : false
          }
          hasChangedMode={stagingState?.hasChangedPosition || false}
        />
      )}
      
      {selectedTilePiece && isCard(selectedTilePiece) && showDetails && (
        <CardDetailView 
          card={selectedTilePiece} 
          onClose={() => setShowDetails(false)} 
        />
      )}

      {selectedTilePiece && isCard(selectedTilePiece) && (
        <CardPreview 
          card={selectedTilePiece} 
          onViewDetails={() => setShowDetails(true)}
        />
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
