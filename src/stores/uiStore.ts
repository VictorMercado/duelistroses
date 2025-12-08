import { create } from 'zustand';
import type { Tile } from '@/types';
import { BOARD_SIZE } from '@/const';

interface UIState {
  // Camera controls
  enableZoom: boolean;
  enableRotate: boolean;
  enablePan: boolean;
  enableFreeCamera: boolean;

  // Display settings
  showControlPanel: boolean;
  showTiles: boolean;
  showTilePositions: boolean;
  showFPS: boolean;
  showCards: boolean;
  showPlayers: boolean;
  showSettings: boolean;
  showKeyBindings: boolean;

  // Game state UI
  showDetails: boolean;
  showPlayerDetails: boolean;

  // Tile selection/hover
  selectedTile: Tile | null;
  boardSize: number;
  tileArrangement: 'random' | 'player' | 'opponent';
  // Actions
  setShowControlPanel: (show: boolean) => void;
  setEnableZoom: (enable: boolean) => void;
  setEnableRotate: (enable: boolean) => void;
  setEnablePan: (enable: boolean) => void;
  setEnableFreeCamera: (enable: boolean) => void;
  setShowTiles: (show: boolean) => void;
  setShowTilePositions: (show: boolean) => void;
  setShowFPS: (show: boolean) => void;
  setShowDetails: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowKeyBindings: (show: boolean) => void;
  setShowCards: (show: boolean) => void;
  setShowPlayers: (show: boolean) => void;
  setSelectedTile: (tile: Tile | null) => void;
  setBoardSize: (size: number) => void;
  setTileArrangement: (arrangement: 'random' | 'player' | 'opponent') => void;
  setShowPlayerDetails: (show: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Initial state
  enableFreeCamera: false,
  enableZoom: true,
  enableRotate: true,
  enablePan: true,
  showControlPanel: true,
  showTiles: true,
  showTilePositions: true,
  showFPS: true,
  showDetails: false,
  showPlayerDetails: false,
  showSettings: false,
  hoveredTile: null,
  selectedTile: null,
  showKeyBindings: true,
  showCards: true,
  showPlayers: true,
  boardSize: BOARD_SIZE,
  tileArrangement: 'random',

  // Actions
  setShowControlPanel: (show) => set({ showControlPanel: show }),
  setEnableZoom: (enable) => set({ enableZoom: enable }),
  setEnableRotate: (enable) => set({ enableRotate: enable }),
  setEnablePan: (enable) => set({ enablePan: enable }),
  setEnableFreeCamera: (enable) => set({ enableFreeCamera: enable }),
  setShowTiles: (show) => set({ showTiles: show }),
  setShowTilePositions: (show) => set({ showTilePositions: show }),
  setShowFPS: (show) => set({ showFPS: show }),
  setShowDetails: (show) => set({ showDetails: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  setShowKeyBindings: (show) => set({ showKeyBindings: show }),
  setShowCards: (show) => set({ showCards: show }),
  setShowPlayers: (show) => set({ showPlayers: show }),
  setBoardSize: (size) => set({ boardSize: size }),
  setTileArrangement: (arrangement) => set({ tileArrangement: arrangement }),
  setShowPlayerDetails: (show) => set({ showPlayerDetails: show }),
}));
