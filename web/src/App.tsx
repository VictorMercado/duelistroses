import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls, View } from "@react-three/drei";
import { useRef } from 'react';
import { useUIStore } from "@/stores/uiStore";
import GameBoard from "@/components/game/GameBoard";
import ControlPanel from "@/components/ui/ControlPanel";
import ActionMenu from "@/components/game/ActionMenu";
import CardDetailView from "@/components/game/CardDetailView";
import PlayerDetailView from "@/components/game/PlayerDetailView";
import CardPreview from "@/components/game/CardPreview";
import PlayerPreview from "@/components/game/PlayerPreview";
import TilePreview from "@/components/TilePreview";
import SummonCardPreview from "@/components/game/SummonCardPreview";
import HandView from "@/components/game/HandView";
import DevTools from "@/components/DevTools";
import PlayerStats from "@/components/ui/PlayerStats";
import { BaseHolographicMaterial } from "@/shaders/BaseHolographic";
import { GodRaysMaterial } from "@/shaders/GodRays";
import { BOARD_SIZE } from "@/const";
import { useKeyBindings } from "./hooks/useKeyBindings";
import { useIsMobileLandscape } from "./hooks/useIsMobile";
import { TOUCH } from "three";
import { Perf } from 'r3f-perf';
import { DevToolsConnection } from "./components/DevToolsConnection";
import MultiplayerPanel from "@/components/ui/MultiplayerPanel";
import { useMultiplayerBootstrap } from "@/hooks/useMultiplayer";

extend({ BaseHolographicMaterial, GodRaysMaterial });

import { useGameAudio } from "@/hooks/useGameAudio";
import MusicToggle from "./components/ui/MusicToggle";
import FPSCounter from "./components/ui/FPSCounter";
import StaticAxisHelper from "./components/game/StaticAxisHelper";

function App() {
  useKeyBindings();
  useMultiplayerBootstrap();
  const uiStore = useUIStore();
  const controlsRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mainViewRef = useRef<HTMLDivElement>(null);
  const isMobileLandscape = useIsMobileLandscape();
  const cameraFov = 20;
  const cameraMinDistance = 0.2;
  const cameraMaxDistance = 100;
  const minDistance = isMobileLandscape ? 10 : uiStore.enableFreeCamera ? cameraMinDistance : BOARD_SIZE + 12;
  const maxDistance = isMobileLandscape ? 10 : uiStore.enableFreeCamera ? cameraMaxDistance : BOARD_SIZE + 12;
  // Initialize audio at the top level
  const audioState = useGameAudio();
  console.log("app rereunnign");

  return (
    <div ref={containerRef} className="w-screen h-screen">
      <div ref={mainViewRef} className="absolute inset-0 w-full h-full" />
      <Canvas eventSource={containerRef as React.RefObject<HTMLElement>} className="canvas" camera={{ fov: cameraFov }}>
        {/* Render Views here */}
        <View.Port />
        <View track={mainViewRef as React.RefObject<HTMLDivElement>}>
          <color attach="background" args={['black']} />
          <StaticAxisHelper />
          <ambientLight intensity={5} />
          <GameBoard />
          <OrbitControls
            ref={controlsRef}
            enableDamping={false}
            enableZoom={uiStore.enableZoom}
            enableRotate={uiStore.enableRotate}
            enablePan={uiStore.enablePan}
            panSpeed={1}
            // makeDefault
            touches={{
              ONE: uiStore.enableFreeCamera ? TOUCH.ROTATE : TOUCH.PAN,
              TWO: uiStore.enableFreeCamera ? TOUCH.DOLLY_PAN : TOUCH.DOLLY_ROTATE
            }}
            screenSpacePanning={true}
            minPolarAngle={uiStore.enableFreeCamera ? 1 * (Math.PI / 180) : 140 * (Math.PI / 180)}
            maxPolarAngle={uiStore.enableFreeCamera ? 179 * (Math.PI / 180) : 140 * (Math.PI / 180)}
            minAzimuthAngle={uiStore.enableFreeCamera ? -89 * (Math.PI / 180) : 0}
            maxAzimuthAngle={uiStore.enableFreeCamera ? 89 * (Math.PI / 180) : 0}
            minDistance={minDistance}
            maxDistance={maxDistance}
            onChange={() => {
              if (controlsRef.current && !uiStore.enableFreeCamera) {
                const range = uiStore.boardSize / 3;
                const target = controlsRef.current.target;
                target.x = Math.max(-range, Math.min(range, target.x));
                target.y = Math.max(-range, Math.min(range, target.y));
                target.z = Math.max(-range, Math.min(range, target.z));
              }
            }}
          />
        </View>
        {uiStore.show3jsStats && <Perf style={{ position: 'absolute', top: 0, left: '30%', transform: 'translateX(-50%)', width: '20rem' }} />}
        <DevToolsConnection />
      </Canvas>
      <PlayerStats />
      <MultiplayerPanel />
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
          w-10 h-10 md:w-auto md:h-auto
        `}
      >
        {
          uiStore.showControlPanel ? "⚔️" : "⚙️"
        }
      </button>

      {/* Control Panel Container */}
      {uiStore.showControlPanel && (
        <div className="absolute top-0 h-full w-full z-60 flex justify-end md:pointer-events-none">
          <ControlPanel controlsRef={controlsRef} {...audioState} />
        </div>
      )}
      <div className="hidden xl:flex absolute top-2 left-1/2 -translate-x-1/2 z-70 md:flex flex-row gap-2">
        {uiStore.showFPS && <FPSCounter style="minimal" />}
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
      {uiStore.showCardDetails && <CardDetailView />}
      {uiStore.showPlayerDetails && <PlayerDetailView />}
      <CardPreview />
      <PlayerPreview />
      <TilePreview />
      <SummonCardPreview />
      <DevTools />
    </div>
  );
}

export default App;