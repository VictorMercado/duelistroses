import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef } from 'react';
import StaticAxisHelper from "@/components/StaticAxisHelper";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import CardPreview from "@/components/CardPreview";
import TilePreview from "@/components/TilePreview";
import SettingsModal from "@/components/SettingsModal";
import FPSCounter from "@/components/FPSCounter";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { useKeyboardHandler } from "@/hooks/useKeyboardHandler";
import { isCard } from "@/types";

function App() {
  const controlsRef = useRef<any>(null);
  
  // Use stores instead of local state
  const turnState = useGameStore((state) => state.turnState);
  const stagingState = useGameStore((state) => state.stagingState);
  const commitAction = useGameStore((state) => state.commitAction);
  const cancelAction = useGameStore((state) => state.cancelAction);
  const getPieceKey = useGameStore((state) => state.getPieceKey);
  
  const enableZoom = useUIStore((state) => state.enableZoom);
  const setEnableZoom = useUIStore((state) => state.setEnableZoom);
  const enableRotate = useUIStore((state) => state.enableRotate);
  const setEnableRotate = useUIStore((state) => state.setEnableRotate);
  const enablePan = useUIStore((state) => state.enablePan);
  const setEnablePan = useUIStore((state) => state.setEnablePan);
  const showTilePositions = useUIStore((state) => state.showTilePositions);
  const setShowTilePositions = useUIStore((state) => state.setShowTilePositions);
  const showFPS = useUIStore((state) => state.showFPS);
  const setShowFPS = useUIStore((state) => state.setShowFPS);
  const showDetails = useUIStore((state) => state.showDetails);
  const setShowDetails = useUIStore((state) => state.setShowDetails);
  const showSettings = useUIStore((state) => state.showSettings);
  const setShowSettings = useUIStore((state) => state.setShowSettings);
  const hoveredTile = useUIStore((state) => state.hoveredTile);
  const selectedTile = useUIStore((state) => state.selectedTile);
  
  const selectedTilePiece = useInputStore((state) => state.selectedTilePiece);
  const keyBindings = useInputStore((state) => state.keyBindings);
  const updateKeyBindings = useInputStore((state) => state.updateKeyBindings);
  
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
    
    const updated = { ...selectedTilePiece, isFaceDown: !selectedTilePiece.isFaceDown };
    useGameStore.getState().updateTilePiece(updated);
    
    // Mark as flipped in staging
    if (stagingState) {
      useGameStore.setState((state) => ({
        stagingState: state.stagingState 
          ? { ...state.stagingState, hasFlipped: true }
          : null
      }));
    }
  };
  
  // Helper for position change action
  const handlePosition = () => {
    if (!selectedTilePiece || !isCard(selectedTilePiece) || !stagingState) return;
    
    // Can't change position if actually moved to a different position
    if (!selectedTilePiece.position.equals(stagingState.originalPosition)) return;
    
    const updated = { ...selectedTilePiece, isDefenseMode: !selectedTilePiece.isDefenseMode };
    useGameStore.getState().updateTilePiece(updated);
    
    // Mark as changed position in staging
    useGameStore.setState((state) => ({
      stagingState: state.stagingState 
        ? { ...state.stagingState, hasChangedPosition: true }
        : null
    }));
  };

  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 15, 10], fov: 30 }}>
        <ambientLight intensity={5} />
        <GameBoard />
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
        onUpdateKeyBindings={updateKeyBindings}
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
          onChangePosition={handlePosition}
          onFlip={handleFlip}
          onDetails={() => setShowDetails(true)}
          onCommit={commitAction}
          onCancel={cancelAction}
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
