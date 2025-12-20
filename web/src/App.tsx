import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef } from 'react';
import { useUIStore } from "@/stores/uiStore";
import { usePreloadTextures } from "@/hooks/usePreloadTextures";
import StaticAxisHelper from "@/components/StaticAxisHelper";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import PlayerDetailView from "@/components/PlayerDetailView";
import CardPreview from "@/components/CardPreview";
import PlayerPreview from "@/components/PlayerPreview";
import TilePreview from "@/components/TilePreview";
import SettingsModal from "@/components/SettingsModal";
import HandView from "@/components/HandView";
import DevTools from "@/components/DevTools";
import { BaseHolographicMaterial } from "@/shaders/BaseHolographic";
import { GodRaysMaterial } from "@/shaders/GodRays";
import { BOARD_SIZE } from "@/const";
import { useKeyBindings } from "./hooks/useKeyBindings";

extend({ BaseHolographicMaterial, GodRaysMaterial });

function App() {
  // Preload all tile textures to prevent refetching
  usePreloadTextures();
  useKeyBindings();
  const uiStore = useUIStore();
  const controlsRef = useRef<any>(null);

  // // TODO: Maybe should live in gameStore or inputStore
  // // Update hovered tile based on cursor position
  // useEffect(() => {
  //   const tileAtCursor = gameStore.tiles.find(t => 
  //     Math.round(t.position.x) === inputStore.cursorPosition.x && 
  //     Math.round(t.position.y) === inputStore.cursorPosition.y
  //   );
  //   uiStore.setSelectedTile(tileAtCursor || null);
  // }, [inputStore.cursorPosition, gameStore.tiles, uiStore.setSelectedTile]);
  
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
          minPolarAngle={uiStore.enableFreeCamera ? 0 : 50 * Math.PI / 180}
          maxPolarAngle={uiStore.enableFreeCamera ? Math.PI : 50 * Math.PI / 180}
          minAzimuthAngle={uiStore.enableFreeCamera ? -Infinity : Math.PI * 0}
          maxAzimuthAngle={uiStore.enableFreeCamera ? Infinity : Math.PI * 0}
          minDistance={uiStore.enableFreeCamera ? 2 : BOARD_SIZE + 3}
          maxDistance={uiStore.enableFreeCamera ? 50 : BOARD_SIZE + 3}
        />
      </Canvas>
      <StaticAxisHelper />
      <div className="absolute top-40 right-4">
        <button
          onClick={() => uiStore.setShowControlPanel(!uiStore.showControlPanel)}
          className="bg-black/80 text-white px-4 py-2 rounded-lg border border-white/20 hover:border-yellow-500 hover:bg-black/90 transition-all font-mono text-sm flex items-center gap-2"
        >
          {uiStore.showControlPanel ? ">" : "<"}
        </button>
        {uiStore.showControlPanel && <ControlPanel
          controlsRef={controlsRef}
        />}
      </div>
      {uiStore.showSettings && <SettingsModal />}
      <ActionMenu />
      {uiStore.showDetails && <CardDetailView />}
      {uiStore.showPlayerDetails && <PlayerDetailView />}
      <CardPreview />
      <PlayerPreview />
      <TilePreview />
      <DevTools />
    </div>
  );
}

export default App