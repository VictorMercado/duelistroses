import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef } from 'react';
import { useUIStore } from "@/stores/uiStore";
import { usePreloadTextures } from "@/hooks/usePreloadTextures";
import GameBoard from "@/components/GameBoard";
import ControlPanel from "@/components/ControlPanel";
import ActionMenu from "@/components/ActionMenu";
import CardDetailView from "@/components/CardDetailView";
import PlayerDetailView from "@/components/PlayerDetailView";
import CardPreview from "@/components/CardPreview";
import PlayerPreview from "@/components/PlayerPreview";
import TilePreview from "@/components/TilePreview";
import HandView from "@/components/HandView";
import DevTools from "@/components/DevTools";
import PlayerStats from "@/components/PlayerStats";
import { BaseHolographicMaterial } from "@/shaders/BaseHolographic";
import { GodRaysMaterial } from "@/shaders/GodRays";
import { BOARD_SIZE } from "@/const";
import { useKeyBindings } from "./hooks/useKeyBindings";
import { useIsMobileLandscape } from "./hooks/useIsMobile";

extend({ BaseHolographicMaterial, GodRaysMaterial });

import { useGameAudio } from "@/hooks/useGameAudio";
import MusicToggle from "./components/MusicToggle";
import FPSCounter from "./components/FPSCounter";
import { useGameStore } from "./stores/gameStore";

function App() {
  // Preload all tile textures to prevent refetching
  usePreloadTextures();
  useKeyBindings();
  const uiStore = useUIStore();
  const gameStore = useGameStore();
  const controlsRef = useRef<any>(null);
  const isMobileLandscape = useIsMobileLandscape();
  
  // Initialize audio at the top level
  const audioState = useGameAudio();    
  
  return (
    <div className="w-screen h-screen">
      <Canvas camera={{ position: [0, 15, 10], fov: 30 }}>
        <color attach="background" args={['black']} />
        <ambientLight intensity={5} />
        <GameBoard />
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
          minDistance={isMobileLandscape ? 10 : uiStore.enableFreeCamera ? 2 : BOARD_SIZE + 3}
          maxDistance={isMobileLandscape ? 10 : uiStore.enableFreeCamera ? 50 : BOARD_SIZE + 3}
        />
      </Canvas>
      <PlayerStats />
      {/* Toggle Button - Fixed on mobile, Absolute on desktop */}
      <button
        onClick={() => uiStore.setShowControlPanel(!uiStore.showControlPanel)}
        className={`
          fixed md:absolute z-70 
          top-4 right-4
          bg-black/80 text-white 
          p-2 md:px-4 md:py-2 
          rounded-full md:rounded-lg 
          border border-white/20 hover:border-yellow-500 hover:bg-black/90 
          transition-all font-mono text-sm flex items-center justify-center gap-2
          w-10 h-10 md:w-auto md:h-auto z-70
        `}
      >
        <span className="">⚙️</span>
      </button>

      {/* Control Panel Container */}
      {uiStore.showControlPanel && (
        <div className="absolute top-0 h-full w-full z-60 flex justify-end">
          <ControlPanel controlsRef={controlsRef} {...audioState} />
        </div>
      )}
      <div className="hidden xl:flex absolute top-2 left-1/2 -translate-x-1/2 z-70 flex flex-row gap-2">
        {uiStore.showFPS && <FPSCounter style="minimal"/>}
        <MusicToggle
          isPlaying={audioState.isPlaying}
          volume={audioState.volume}
          toggleMusic={audioState.toggleMusic}
          setVolume={audioState.setVolume}
          style="minimal"
        />
      </div>
      <HandView />
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