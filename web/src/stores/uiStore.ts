import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  show3jsStats: boolean;
  showStaticAxisHelper: boolean;

  // Game state UI
  showCardDetails: boolean;
  showPlayerDetails: boolean;
  showDevTools: boolean;

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
  setShowCardDetails: (show: boolean) => void;
  setShowPlayerDetails: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowKeyBindings: (show: boolean) => void;
  setShowCards: (show: boolean) => void;
  setShowPlayers: (show: boolean) => void;
  setShow3jsStats: (show: boolean) => void;
  setShowStaticAxisHelper: (show: boolean) => void;

  setBoardSize: (size: number) => void;
  setTileArrangement: (arrangement: 'random' | 'player' | 'opponent') => void;
  setShowDevTools: (show: boolean) => void;
}

export const useUIStore = create<UIState>()(persist((set) => ({
  // Initial state
  enableFreeCamera: false,
  enableZoom: true,
  enableRotate: true,
  enablePan: true,
  showControlPanel: false,
  showTiles: true,
  showTilePositions: false,
  showFPS: true,
  showCardDetails: false,
  showPlayerDetails: false,
  showSettings: false,
  hoveredTile: null,
  showKeyBindings: true,
  showCards: true,
  showPlayers: true,
  show3jsStats: false,
  showStaticAxisHelper: false,
  boardSize: BOARD_SIZE,
  tileArrangement: 'random',
  showDevTools: false,

  // Actions
  setShowControlPanel: (show) => set({ showControlPanel: show }),
  setEnableZoom: (enable) => set({ enableZoom: enable }),
  setEnableRotate: (enable) => set({ enableRotate: enable }),
  setEnablePan: (enable) => set({ enablePan: enable }),
  setEnableFreeCamera: (enable) => set({ enableFreeCamera: enable }),
  setShowTiles: (show) => set({ showTiles: show }),
  setShowTilePositions: (show) => set({ showTilePositions: show }),
  setShowFPS: (show) => set({ showFPS: show }),
  setShowCardDetails: (show) => set({ showCardDetails: show }),
  setShowPlayerDetails: (show) => set({ showPlayerDetails: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowKeyBindings: (show) => set({ showKeyBindings: show }),
  setShowCards: (show) => set({ showCards: show }),
  setShowPlayers: (show) => set({ showPlayers: show }),
  setShow3jsStats: (show) => set({ show3jsStats: show }),
  setShowStaticAxisHelper: (show) => set({ showStaticAxisHelper: show }),
  setBoardSize: (size) => set({ boardSize: size }),
  setTileArrangement: (arrangement) => set({ tileArrangement: arrangement }),
  setShowDevTools: (show) => set({ showDevTools: show }),
}), {
  name: 'ui-storage',
}));
