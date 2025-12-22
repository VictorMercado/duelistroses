import { useUIStore } from '@/stores/uiStore';
import { useEffect, useState } from 'react';
import MusicToggle from "@/components/MusicToggle";
import { useGameStore } from '@/stores/gameStore';
import FPSCounter from './FPSCounter';

interface ControlPanelProps {
  controlsRef: React.RefObject<any>;
  isPlaying: boolean;
  volume: number;
  toggleMusic: () => void;
  setVolume: (vol: number) => void;
}

export default function ControlPanel({
  controlsRef,
  isPlaying,
  volume,
  toggleMusic,
  setVolume
}: ControlPanelProps) {
  const [cameraStats, setCameraStats] = useState({
    distance: 0,
    polarAngle: 0,
    azimuthAngle: 0,
    panOffset: { x: 0, y: 0, z: 0 },
  });
  const uiStore = useUIStore();
  const gameStore = useGameStore();
  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };
  useEffect(() => {
    const updateStats = () => {
      if (controlsRef.current) {
        const controls = controlsRef.current;
        const distance = controls.object.position.length();
        const polarAngle = controls.getPolarAngle();
        const azimuthAngle = controls.getAzimuthalAngle();
        
        setCameraStats({
          distance: Math.round(distance * 100) / 100,
          polarAngle: Math.round((polarAngle * 180 / Math.PI) * 10) / 10,
          azimuthAngle: Math.round((azimuthAngle * 180 / Math.PI) * 10) / 10,
          panOffset: {
            x: Math.round(controls.target.x * 100) / 100,
            y: Math.round(controls.target.y * 100) / 100,
            z: Math.round(controls.target.z * 100) / 100,
          },
        });
      }
    };

    // Update stats periodically
    const interval = setInterval(updateStats, 100);
    updateStats(); // Initial update

    return () => clearInterval(interval);
  }, [controlsRef]);

  return (
    <div className="bg-black/90 md:bg-black/80 text-white p-4 pt-16 md:pt-4 w-full h-full md:w-96 md:h-auto md:rounded-lg shadow-lg backdrop-blur-sm border-l md:border border-white/10 space-y-2 overflow-y-auto z-50">
      {/* Settings Modal */}
      <h3 className="text-lg font-bold border-b border-white/20 pb-2">
        Control Panel
      </h3>
      <div className="text-sm text-white p-2 bg-black bg-opacity-50 border-b border-white/20 pb-2">
        <p>Use W, A, S, D to move cards</p>
      </div>
      {uiStore.showFPS && <FPSCounter style="minimal"/>}
      <MusicToggle 
        isPlaying={isPlaying}
        volume={volume}
        toggleMusic={toggleMusic}
        setVolume={setVolume}
      />
      {/* Camera Stats */}
      <div className="p-3 bg-gray-900/50 rounded-lg border border-white/10">
        <p className="text-xs text-gray-400 mb-2">Camera Stats:</p>
        <div className="text-xs space-y-1">
          <p><span className="text-blue-400">Distance:</span> {cameraStats.distance}</p>
          <p><span className="text-blue-400">Polar Angle:</span> {cameraStats.polarAngle}°</p>
          <p><span className="text-blue-400">Azimuth:</span> {cameraStats.azimuthAngle}°</p>
          <p><span className="text-blue-400">Pan:</span> ({cameraStats.panOffset.x}, {cameraStats.panOffset.y}, {cameraStats.panOffset.z})</p>
        </div>
      </div>
      {/* GameBoard Stats */}
      <div className="p-3 bg-gray-900/50 rounded-lg border border-white/10">
        <p className="text-xs text-gray-400 mb-2">GameBoard Stats:</p>
        <div className="text-xs space-y-1">
          <p><span className="text-blue-400">Board Size:</span> {uiStore.boardSize} x {uiStore.boardSize}</p>
          <p><span className="text-blue-400">Tile Arrangement:</span> {uiStore.tileArrangement}</p>
          <p><span className="text-blue-400">Players Count:</span> {gameStore.currentPlayersCount}</p>
          <p><span className="text-blue-400">Cards Count:</span> {gameStore.currentCardsCount}</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="free-cam-toggle" className="cursor-pointer select-none">
            Free Camera
          </label>
          <input
            id="free-cam-toggle"
            type="checkbox"
            checked={uiStore.enableFreeCamera}
            onChange={(e) => uiStore.setEnableFreeCamera(e.target.checked)}
            className="w-4 h-4 accent-yellow-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="zoom-toggle" className="cursor-pointer select-none">
            Enable Zoom
          </label>
          <input
            id="zoom-toggle"
            type="checkbox"
            checked={uiStore.enableZoom}
            onChange={(e) => uiStore.setEnableZoom(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="rotate-toggle" className="cursor-pointer select-none">
            Enable Rotate
          </label>
          <input
            id="rotate-toggle"
            type="checkbox"
            checked={uiStore.enableRotate}
            onChange={(e) => uiStore.setEnableRotate(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="pan-toggle" className="cursor-pointer select-none">
            Enable Pan
          </label>
          <input
            id="pan-toggle"
            type="checkbox"
            checked={uiStore.enablePan}
            onChange={(e) => uiStore.setEnablePan(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="tile-toggle" className="cursor-pointer select-none">
            Show Tiles
          </label>
          <input
            id="tile-toggle"
            type="checkbox"
            checked={uiStore.showTiles}
            onChange={(e) => uiStore.setShowTiles(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="tile-positions-toggle" className="cursor-pointer select-none">
            Show Tile Coordinates
          </label>
          <input
            id="tile-positions-toggle"
            type="checkbox"
            checked={uiStore.showTilePositions}
            onChange={(e) => uiStore.setShowTilePositions(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="fps-toggle" className="cursor-pointer select-none">
            Show FPS
          </label>
          <input
            id="fps-toggle"
            type="checkbox"
            checked={uiStore.showFPS}
            onChange={(e) => uiStore.setShowFPS(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="cards-toggle" className="cursor-pointer select-none">
            Show Cards
          </label>
          <input
            id="cards-toggle"
            type="checkbox"
            checked={uiStore.showCards}
            onChange={(e) => uiStore.setShowCards(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="players-toggle" className="cursor-pointer select-none">
            Show Players
          </label>
          <input
            id="players-toggle"
            type="checkbox"
            checked={uiStore.showPlayers}
            onChange={(e) => uiStore.setShowPlayers(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="key-bindings-toggle" className="cursor-pointer select-none">
            Show Key Bindings
          </label>
          <input
            id="key-bindings-toggle"
            type="checkbox"
            checked={uiStore.showKeyBindings}
            onChange={(e) => uiStore.setShowKeyBindings(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
      </div>
       {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={() => uiStore.setShowSettings(true)}
          className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
        <button
          onClick={handleResetCamera}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors"
        >
          Reset Camera
        </button>
      </div>
    </div>
  );
}
