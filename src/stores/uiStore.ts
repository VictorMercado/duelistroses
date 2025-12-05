import { create } from 'zustand';
import type { Tile } from '@/types';
import { BOARD_SIZE } from '@/const';

interface UIState {
  // Camera controls
  enableZoom: boolean;
  enableRotate: boolean;
  enablePan: boolean;

  // Display settings
  showTilePositions: boolean;
  showFPS: boolean;
  showDetails: boolean;
  showSettings: boolean;
  showKeyBindings: boolean;
  showCards: boolean;
  showPlayers: boolean;
  // Tile selection/hover
  selectedTile: Tile | null;
  boardSize: number;
  tileArrangement: 'random' | 'player' | 'opponent';
  // Actions
  setEnableZoom: (enable: boolean) => void;
  setEnableRotate: (enable: boolean) => void;
  setEnablePan: (enable: boolean) => void;
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
}

export const useUIStore = create<UIState>((set) => ({
  // Initial state
  enableZoom: true,
  enableRotate: true,
  enablePan: true,
  showTilePositions: true,
  showFPS: true,
  showDetails: false,
  showSettings: false,
  hoveredTile: null,
  selectedTile: null,
  showKeyBindings: true,
  showCards: true,
  showPlayers: true,
  boardSize: BOARD_SIZE,
  tileArrangement: 'random',

  // Actions
  setEnableZoom: (enable) => set({ enableZoom: enable }),
  setEnableRotate: (enable) => set({ enableRotate: enable }),
  setEnablePan: (enable) => set({ enablePan: enable }),
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
}));
