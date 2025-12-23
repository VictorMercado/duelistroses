import { useUIStore } from '@/stores/uiStore';
import { useEffect, useState } from 'react';
import MusicToggle from "@/components/MusicToggle";
import { useGameStore } from '@/stores/gameStore';
import FPSCounter from './FPSCounter';
import { useKeyBindings } from "@/hooks/useKeyBindings";
import { DEFAULT_KEYBINDINGS } from "@/const";
import type { KeyBindings } from "@/types";

interface ControlPanelProps {
  controlsRef: React.RefObject<any>;
  isPlaying: boolean;
  volume: number;
  toggleMusic: () => void;
  setVolume: (vol: number) => void;
}

type Tab = 'controls' | 'settings';

export default function ControlPanel({
  controlsRef,
  isPlaying,
  volume,
  toggleMusic,
  setVolume
}: ControlPanelProps) {
  // UI State
  const [activeTab, setActiveTab] = useState<Tab>('controls');
  const [cameraStats, setCameraStats] = useState({
    distance: 0,
    polarAngle: 0,
    azimuthAngle: 0,
    panOffset: { x: 0, y: 0, z: 0 },
  });
  
  // Store Hooks
  const uiStore = useUIStore();
  const gameStore = useGameStore();

  // Settings State
  const { keyBindings, updateKeyBindings } = useKeyBindings();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tempBindings, setTempBindings] = useState<KeyBindings>(keyBindings);

  // --- Handlers: Camera ---
  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };
  
  // --- Handlers: Settings ---
  // Sync temp bindings when store changes (e.g. initial load)
  useEffect(() => {
    setTempBindings(keyBindings);
  }, [keyBindings]);

  const handleKeyPress = (e: React.KeyboardEvent, bindingKey: keyof KeyBindings) => {
    if (bindingKey === 'cancel') {
      const currentCancel = tempBindings.cancel;
      if (!currentCancel.includes(e.key)) {
        setTempBindings({ ...tempBindings, cancel: [...currentCancel, e.key] });
      }
    } else {
      setTempBindings({ ...tempBindings, [bindingKey]: e.key });
    }
    setEditingKey(null);
  };

  const handleRemoveCancel = (keyToRemove: string) => {
    setTempBindings({
      ...tempBindings,
      cancel: tempBindings.cancel.filter(k => k !== keyToRemove)
    });
  };

  const handleSaveSettings = () => {
    updateKeyBindings(tempBindings);
    // Optional: show feedback
  };

  const handleResetSettings = () => {
    setTempBindings(DEFAULT_KEYBINDINGS);
    updateKeyBindings(DEFAULT_KEYBINDINGS);
  };

  // --- Effects ---
  // Update stats
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

    const interval = setInterval(updateStats, 500);
    updateStats(); 

    return () => clearInterval(interval);
  }, [controlsRef]);


  // --- Render Content ---
  const renderControlsTab = () => (
    <div className="space-y-4">
      <div className="text-sm text-gray-400 p-2 bg-black/40 rounded border border-white/10">
        <p>Use W, A, S, D to move board cursor</p>
      </div>
      
      {uiStore.showFPS && <FPSCounter style="minimal"/>}
      
      <MusicToggle 
        isPlaying={isPlaying}
        volume={volume}
        toggleMusic={toggleMusic}
        setVolume={setVolume}
        style="full"
      />

      {/* Stats Section */}
      <div className="space-y-2">
        <div className="p-3 bg-gray-900/50 rounded-lg border border-white/10">
          <p className="text-xs text-gray-400 mb-2 font-bold uppercase">Camera</p>
          <div className="text-xs space-y-1">
            <p><span className="text-blue-400">Dist:</span> {cameraStats.distance}</p>
            <p><span className="text-blue-400">Angle:</span> {cameraStats.polarAngle}° / {cameraStats.azimuthAngle}°</p>
            <p><span className="text-blue-400">Pan:</span> {cameraStats.panOffset.x}, {cameraStats.panOffset.y}</p>
          </div>
        </div>
        <div className="p-3 bg-gray-900/50 rounded-lg border border-white/10">
          <p className="text-xs text-gray-400 mb-2 font-bold uppercase">Game</p>
          <div className="text-xs space-y-1">
            <p><span className="text-blue-400">Board:</span> {uiStore.boardSize}x{uiStore.boardSize}</p>
            <p><span className="text-blue-400">Players:</span> {gameStore.currentPlayersCount}</p>
            <p><span className="text-blue-400">Cards:</span> {gameStore.currentCardsCount}</p>
          </div>
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2 bg-gray-900/30 p-3 rounded-lg border border-white/5">
        {[
          { id: 'free-cam', label: 'Free Camera', checked: uiStore.enableFreeCamera, set: uiStore.setEnableFreeCamera, color: 'accent-yellow-500' },
          { id: 'zoom', label: 'Enable Zoom', checked: uiStore.enableZoom, set: uiStore.setEnableZoom },
          { id: 'rotate', label: 'Enable Rotate', checked: uiStore.enableRotate, set: uiStore.setEnableRotate },
          { id: 'pan', label: 'Enable Pan', checked: uiStore.enablePan, set: uiStore.setEnablePan },
          { id: 'tiles', label: 'Show Tiles', checked: uiStore.showTiles, set: uiStore.setShowTiles },
          { id: 'coords', label: 'Show Coordinates', checked: uiStore.showTilePositions, set: uiStore.setShowTilePositions },
          { id: 'fps', label: 'Show FPS', checked: uiStore.showFPS, set: uiStore.setShowFPS },
          { id: 'cards', label: 'Show Cards', checked: uiStore.showCards, set: uiStore.setShowCards },
          { id: 'players', label: 'Show Players', checked: uiStore.showPlayers, set: uiStore.setShowPlayers },
          // { id: 'keys', label: 'Show Bindings Overlay', checked: uiStore.showKeyBindings, set: uiStore.setShowKeyBindings },
        ].map(toggle => (
           <div key={toggle.id} className="flex items-center justify-between">
            <label htmlFor={toggle.id} className="cursor-pointer select-none text-sm text-gray-300 hover:text-white">
              {toggle.label}
            </label>
            <input
              id={toggle.id}
              type="checkbox"
              checked={toggle.checked}
              onChange={(e) => toggle.set(e.target.checked)}
              className={`w-4 h-4 cursor-pointer ${toggle.color || 'accent-blue-500'}`}
            />
          </div>
        ))}
      </div>

      <button
        onClick={handleResetCamera}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors text-sm"
      >
        Reset Camera Position
      </button>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-yellow-500 uppercase tracking-wider border-b border-white/10 pb-1">Key Bindings</h3>
        
        {/* Helper to render a binding row */}
        {([
          { key: 'select', label: 'Select Piece' },
          { key: 'viewDetails', label: 'View Details' },
          { key: 'playCard', label: 'Play Card' },
          { key: 'flipCard', label: 'Flip Card' },
          { key: 'changePosition', label: 'Change Position' },
        ] as const).map(({ key, label }) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-sm text-gray-300">{label}</span>
            <button
              onClick={(e) => {
                e.currentTarget.focus();
                setEditingKey(key)
              }}
              onKeyDown={(e) => editingKey === key && handleKeyPress(e, key)}
              className={`px-3 py-1 rounded text-xs min-w-[60px] border transition-colors ${
                editingKey === key 
                  ? 'bg-yellow-900 border-yellow-500 text-yellow-200 animate-pulse' 
                  : 'bg-gray-800 border-gray-600 text-gray-200 hover:border-gray-500'
              }`}
            >
              {editingKey === key ? 'Press key...' : (tempBindings[key] as string).toUpperCase()}
            </button>
          </div>
        ))}

        {/* Cancel Special Case (Array) */}
        <div className="flex justify-between items-start pt-2 border-t border-white/5">
          <span className="text-sm text-gray-300 mt-1">Cancel / Back</span>
          <div className="flex flex-col gap-2 items-end">
            <div className="flex flex-wrap justify-end gap-1 max-w-[150px]">
              {tempBindings.cancel.map((key, idx) => (
                <div key={idx} className="group flex items-center gap-1 bg-gray-800 border border-gray-600 rounded px-2 py-1">
                  <span className="text-xs text-gray-200">{key === 'Escape' ? 'ESC' : key.toUpperCase()}</span>
                  {tempBindings.cancel.length > 1 && (
                    <button
                      onClick={() => handleRemoveCancel(key)}
                      className="text-red-400 hover:text-red-300 ml-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  setEditingKey('cancel')
                }}
                onKeyDown={(e) => editingKey === 'cancel' && handleKeyPress(e, 'cancel')}
                className={`px-2 py-1 rounded text-xs border ${
                  editingKey === 'cancel'
                  ? 'bg-yellow-900 border-yellow-500 text-yellow-200' 
                  : 'bg-gray-800 border-dashed border-gray-600 text-gray-400 hover:text-gray-200'
                }`}
              >
                {editingKey === 'cancel' ? 'Press key...' : '+ Add Key'}
              </button>
          </div>
        </div>

        {/* Cursor Movement Group */}
        <div className="pt-4 border-t border-white/10">
          <h4 className="text-xs font-semibold text-gray-400 mb-3">Movement Keys</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              { key: 'cursorUp', label: 'Up' },
              { key: 'cursorDown', label: 'Down' },
              { key: 'cursorLeft', label: 'Left' },
              { key: 'cursorRight', label: 'Right' },
            ].map(({ key, label }) => (
               <div key={key} className="flex justify-between items-center">
                <span className="text-xs text-gray-400">{label}</span>
                <button
                  onClick={(e) => {
                    e.currentTarget.focus();
                    setEditingKey(key)
                  }}
                  onKeyDown={(e) => editingKey === key && handleKeyPress(e, key as any)}
                  className={`px-2 py-1 rounded text-xs min-w-[50px] border ${
                    editingKey === key 
                      ? 'bg-yellow-900 border-yellow-500 text-yellow-200' 
                      : 'bg-gray-800 border-gray-600 text-gray-300'
                  }`}
                >
                  {editingKey === key ? '...' : (tempBindings[key as keyof KeyBindings] as string).toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-4 border-t border-white/20">
        <button
          onClick={handleResetSettings}
          className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded font-semibold transition-colors"
        >
          Reset Defaults
        </button>
        <button
          onClick={handleSaveSettings}
          className="flex-1 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-xs rounded font-semibold transition-colors"
        >
          Save Changes
        </button>
      </div>
    </div>
  );

  return (
    <div className="
      flex flex-col bg-black/95 text-white backdrop-blur-md shadow-2xl
      fixed z-50 transition-all duration-300 ease-in-out border-l border-white/10 md:w-96 md:h-screen
      w-screen h-screen md:w-96">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40 shrink-0">
        <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold bg-gradient-to-r from-yellow-500 to-yellow-200 bg-clip-text text-transparent">
            Control Panel
            </h3>
        </div>
            <button 
                onClick={() => uiStore.setShowControlPanel(false)}
                className="md:hidden p-2 text-gray-400 hover:text-white"
            >
                ✕
            </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 shrink-0">
        <button
          onClick={() => setActiveTab('controls')}
          className={`flex-1 py-3 text-sm font-bold tracking-wide transition-colors relative ${
            activeTab === 'controls' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          CONTROLS
          {activeTab === 'controls' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-yellow-500" />}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-3 text-sm font-bold tracking-wide transition-colors relative ${
            activeTab === 'settings' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          SETTINGS
          {activeTab === 'settings' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-yellow-500" />}
        </button>
      </div>

      {/* Content Area - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'controls' ? renderControlsTab() : renderSettingsTab()}
      </div>

      {/* Footer (Version/Info) */}
      <div className="p-3 border-t border-white/10 bg-black/40 text-center shrink-0">
        <p className="text-[10px] text-gray-600 uppercase tracking-widest">Duelist City</p>
      </div>
    </div>
  );
}
