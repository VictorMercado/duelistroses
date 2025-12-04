import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef, useEffect } from 'react';
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useInputStore } from "@/stores/inputStore";
import { usePreloadTextures } from "@/hooks/usePreloadTextures";
import StaticAxisHelper from "@/components/StaticAxisHelper";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import CardPreview from "@/components/CardPreview";
import TilePreview from "@/components/TilePreview";
import FPSCounter from "@/components/FPSCounter";
import SettingsModal from "@/components/SettingsModal";
import HandView from "@/components/HandView";
import { BaseHolographicMaterial } from "@/shaders/BaseHolographic";
import { GodRaysMaterial } from "@/shaders/GodRays";
import { BOARD_SIZE } from "@/const";

extend({ BaseHolographicMaterial, GodRaysMaterial });

function App() {
  // Preload all tile textures to prevent refetching
  usePreloadTextures();
  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const inputStore = useInputStore();
  const controlsRef = useRef<any>(null);

  // TODO: Maybe should live in gameStore or inputStore
  // Update hovered tile based on cursor position
  useEffect(() => {
    const tileAtCursor = gameStore.tiles.find(t => 
      Math.round(t.position.x) === inputStore.cursorPosition.x && 
      Math.round(t.position.y) === inputStore.cursorPosition.y
    );
    uiStore.setSelectedTile(tileAtCursor || null);
  }, [inputStore.cursorPosition, gameStore.tiles, uiStore.setSelectedTile]);
  
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
          // makeDefault
          minPolarAngle={50 * Math.PI / 180}
          maxPolarAngle={50 * Math.PI / 180}
          minAzimuthAngle={Math.PI * 0}
          maxAzimuthAngle={Math.PI * 0}
          minDistance={BOARD_SIZE + 3}
          maxDistance={BOARD_SIZE + 3}
        />
      </Canvas>
      <StaticAxisHelper />
      {uiStore.showFPS && <FPSCounter />}
      <ControlPanel
        controlsRef={controlsRef}
      />
      {uiStore.showSettings && <SettingsModal />}
      {inputStore.selectedTilePiece 
      && inputStore.selectedTilePiece.owner === 'player' 
      && !gameStore.turnState.actedPieceIds.includes(gameStore.getPieceKey(inputStore.selectedTilePiece)) 
      && (
        <ActionMenu />
      )}
      {uiStore.showDetails && <CardDetailView />}
      <CardPreview />
      <TilePreview />
    </div>
  );
}

export default App
