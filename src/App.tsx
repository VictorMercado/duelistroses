import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useEffect } from 'react';
import StaticAxisHelper from "@/components/StaticAxisHelper";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import CardPreview from "@/components/CardPreview";
import TilePreview from "@/components/TilePreview";
import FPSCounter from "@/components/FPSCounter";
import HandView from "@/components/HandView";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { useKeyboardHandler } from "@/hooks/useKeyboardHandler";
import { isCard } from "@/types";
import { SettingsModal } from "@/components/SettingsModal";

function App() {
  const controlsRef = useRef<any>(null);
  
  // Use stores instead of local state
  const turnState = useGameStore((state) => state.turnState);
  const stagingState = useGameStore((state) => state.stagingState);  
  const getPieceKey = useGameStore((state) => state.getPieceKey);
  const tiles = useGameStore((state) => state.tiles);
  const uiStore = useUIStore();
  
  const selectedTilePiece = useInputStore((state) => state.selectedTilePiece);
  const cursorPosition = useInputStore((state) => state.cursorPosition);

  // Update hovered tile based on cursor position
  useEffect(() => {
    const tileAtCursor = tiles.find(t => 
      Math.round(t.position.x) === cursorPosition.x && 
      Math.round(t.position.y) === cursorPosition.y
    );
    uiStore.setSelectedTile(tileAtCursor || null);
  }, [cursorPosition, tiles, uiStore.setSelectedTile]);
  
  // Consolidated keyboard handler
  useKeyboardHandler();
  
  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };
  
  // Helper for flip action
  const handleFlip = () => {
    if (!selectedTilePiece || !isCard(selectedTilePiece)) return;
    
    // Get fresh piece data
    const freshCards = useGameStore.getState().cards;
    const currentPiece = freshCards.find(p => p.id === selectedTilePiece.id);
    
    if (!currentPiece) return;

    // Yu-Gi-Oh rule: Can't flip a card back down if it was originally face-up
    if (stagingState && stagingState.originalIsFaceDown === false) {
      return;
    }
    
    const updated = { ...currentPiece, isFaceDown: !currentPiece.isFaceDown };
    useGameStore.getState().updateTilePiece(updated);
    
    // Update selected piece in input store to keep it fresh
    useInputStore.getState().updateSelectedPiece(updated);
    
    // Mark as flipped in staging
    if (stagingState) {
      const isDifferentFromOriginal = stagingState.originalIsFaceDown !== undefined &&
        updated.isFaceDown !== stagingState.originalIsFaceDown;

      useGameStore.setState((state) => ({
        stagingState: state.stagingState 
          ? { ...state.stagingState, hasFlipped: isDifferentFromOriginal }
          : null
      }));
    }
  };
  
  // Helper for position change action
  const handlePosition = () => {
    if (!selectedTilePiece || !isCard(selectedTilePiece) || !stagingState) return;
    
    // Get fresh piece data
    const freshCards = useGameStore.getState().cards;
    const currentPiece = freshCards.find(p => p.id === selectedTilePiece.id);
    
    if (!currentPiece) return;

    // Can't change position if actually moved to a different position
    if (!currentPiece.position.equals(stagingState.originalPosition)) return;
    
    const updated = { ...currentPiece, isDefenseMode: !currentPiece.isDefenseMode };
    useGameStore.getState().updateTilePiece(updated);
    
    // Update selected piece in input store to keep it fresh
    useInputStore.getState().updateSelectedPiece(updated);
    
    // Check if the new mode is different from original
    const isDifferentFromOriginal = stagingState.originalIsDefenseMode !== undefined &&
      updated.isDefenseMode !== stagingState.originalIsDefenseMode;
    
    // Mark as changed position in staging only if different from original
    useGameStore.setState((state) => ({
      stagingState: state.stagingState 
        ? { ...state.stagingState, hasChangedPosition: isDifferentFromOriginal }
        : null
    }));
  };
  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 15, 10], fov: 30 }}>
        <color attach="background" args={['black']} /> 
        <ambientLight intensity={5} />
        <GameBoard />
        <HandView />
        <OrbitControls
          ref={controlsRef}
          enableZoom={uiStore.enableZoom}
          enableRotate={uiStore.enableRotate}
          enablePan={uiStore.enablePan}
          makeDefault
          minPolarAngle={50 * Math.PI / 180}
          maxPolarAngle={50 * Math.PI / 180}
          minAzimuthAngle={0}
          maxAzimuthAngle={0}
          minDistance={14}
          maxDistance={14}
        />
      </Canvas>
      {uiStore.showFPS && <FPSCounter />}
      <StaticAxisHelper />
      <div className="absolute top-0 right-0 text-white p-4 bg-black bg-opacity-50">
        <p>Use W, A, S, D keys to move the card</p>
      </div>

      {/* Control Panel */}
      <ControlPanel
        onResetCamera={handleResetCamera}
        controlsRef={controlsRef}
      />
      {uiStore.showSettings && <SettingsModal />}
      {selectedTilePiece && isCard(selectedTilePiece) && selectedTilePiece.owner === 'player' && !uiStore.showDetails && !turnState.actedPieceIds.includes(getPieceKey(selectedTilePiece)) && (
        <ActionMenu 
          onChangePosition={handlePosition}
          onFlip={handleFlip}
        />
      )}
      
      <CardDetailView />
      <CardPreview />
      <TilePreview />
    </div>
  );
}

export default App
