import { create } from 'zustand';
import type { Tile } from '@/types';

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

  // Tile selection/hover
  hoveredTile: Tile | null;
  selectedTile: Tile | null;

  // Actions
  setEnableZoom: (enable: boolean) => void;
  setEnableRotate: (enable: boolean) => void;
  setEnablePan: (enable: boolean) => void;
  setShowTilePositions: (show: boolean) => void;
  setShowFPS: (show: boolean) => void;
  setShowDetails: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setHoveredTile: (tile: Tile | null) => void;
  setSelectedTile: (tile: Tile | null) => void;
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

  // Actions
  setEnableZoom: (enable) => set({ enableZoom: enable }),
  setEnableRotate: (enable) => set({ enableRotate: enable }),
  setEnablePan: (enable) => set({ enablePan: enable }),
  setShowTilePositions: (show) => set({ showTilePositions: show }),
  setShowFPS: (show) => set({ showFPS: show }),
  setShowDetails: (show) => set({ showDetails: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setHoveredTile: (tile) => set({ hoveredTile: tile }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
}));
