import { useEffect, useState } from 'react';

interface ControlPanelProps {
  enableZoom: boolean;
  setEnableZoom: (value: boolean) => void;
  enableRotate: boolean;
  setEnableRotate: (value: boolean) => void;
  enablePan: boolean;
  setEnablePan: (value: boolean) => void;
  onResetCamera: () => void;
  controlsRef: React.RefObject<any>;
  showTilePositions: boolean;
  setShowTilePositions: (value: boolean) => void;
  showFPS: boolean;
  setShowFPS: (value: boolean) => void;
}

export default function ControlPanel({
  enableZoom,
  setEnableZoom,
  enableRotate,
  setEnableRotate,
  enablePan,
  setEnablePan,
  onResetCamera,
  controlsRef,
  showTilePositions,
  setShowTilePositions,
  showFPS,
  setShowFPS,
}: ControlPanelProps) {
  const [cameraStats, setCameraStats] = useState({
    distance: 0,
    polarAngle: 0,
    azimuthAngle: 0,
    panOffset: { x: 0, y: 0, z: 0 },
  });

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
    <div className="absolute top-20 right-4 bg-black/80 text-white p-4 rounded-lg shadow-lg backdrop-blur-sm border border-white/10 w-64">
      <h3 className="text-lg font-bold mb-4 border-b border-white/20 pb-2">
        Camera Controls
      </h3>
      
      {/* Camera Stats */}
      <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-white/10">
        <p className="text-xs text-gray-400 mb-2">Camera Stats:</p>
        <div className="text-xs space-y-1">
          <p><span className="text-blue-400">Distance:</span> {cameraStats.distance}</p>
          <p><span className="text-blue-400">Polar Angle:</span> {cameraStats.polarAngle}°</p>
          <p><span className="text-blue-400">Azimuth:</span> {cameraStats.azimuthAngle}°</p>
          <p><span className="text-blue-400">Pan:</span> ({cameraStats.panOffset.x}, {cameraStats.panOffset.y}, {cameraStats.panOffset.z})</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="zoom-toggle" className="cursor-pointer select-none">
            Enable Zoom
          </label>
          <input
            id="zoom-toggle"
            type="checkbox"
            checked={enableZoom}
            onChange={(e) => setEnableZoom(e.target.checked)}
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
            checked={enableRotate}
            onChange={(e) => setEnableRotate(e.target.checked)}
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
            checked={enablePan}
            onChange={(e) => setEnablePan(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor="tile-positions-toggle" className="cursor-pointer select-none">
            Show Tile Positions
          </label>
          <input
            id="tile-positions-toggle"
            type="checkbox"
            checked={showTilePositions}
            onChange={(e) => setShowTilePositions(e.target.checked)}
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
            checked={showFPS}
            onChange={(e) => setShowFPS(e.target.checked)}
            className="w-4 h-4 accent-blue-500 cursor-pointer"
          />
        </div>
        <button
          onClick={onResetCamera}
          className="w-full mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
        >
          Reset Camera
        </button>
      </div>
    </div>
  );
}
