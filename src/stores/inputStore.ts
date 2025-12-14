import { create } from 'zustand';
import { useGameStore } from './gameStore';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX,
} from "@/const";


interface InputState {
  cursorPosition: { x: number; y: number; };
  handSelectedIndex: number; // -1 if not navigating hand

  // Actions
  setCursorPosition: (position: { x: number; y: number; }) => void;
  moveCursor: (direction: 'up' | 'down' | 'left' | 'right') => void;
  setHandSelectedIndex: (index: number) => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  cursorPosition: { x: 0, y: Y_AXIS_NEGATIVE_MAX, },
  handSelectedIndex: -1,

  // Actions
  setCursorPosition: (position) => set({ cursorPosition: position }),
  setHandSelectedIndex: (i) => set({ handSelectedIndex: i }),
  moveCursor: (direction) => {
    const state = get();
    const gameStore = useGameStore.getState();
    const { cursorPosition } = state;
    const validPositions = gameStore.getValidMovePositions();
    const isInStagingMode = gameStore.selectedTilePiece && gameStore.stagingState;

    // HAND NAVIGATION
    if (gameStore.showHand) {
      if (direction === 'left' || direction === 'right') {
        const handSize = gameStore.handCards.length;
        if (handSize === 0) return;

        let newIndex = state.handSelectedIndex;
        if (newIndex === -1) newIndex = 0; // Initialize selection if none

        if (direction === 'left') {
          newIndex = Math.max(0, newIndex - 1);
        } else {
          newIndex = Math.min(handSize - 1, newIndex + 1);
        }
        set({ handSelectedIndex: newIndex });
      }
      return;
    }

    // SUMMONING MODE BOARD NAVIGATION
    if (gameStore.summoningState) {
      let newX = cursorPosition.x;
      let newY = cursorPosition.y;

      switch (direction) {
        case 'up': newY += 1; break;
        case 'down': newY -= 1; break;
        case 'left': newX -= 1; break;
        case 'right': newX += 1; break;
      }

      const validSummonPositions = gameStore.getValidSummonPositions();
      const isValid = validSummonPositions.some(([x, y]) => x === newX && y === newY);

      if (isValid) {
        set({ cursorPosition: { x: newX, y: newY } });
      }
      return;
    }

    let newX = cursorPosition.x;
    let newY = cursorPosition.y;

    switch (direction) {
      case 'up':
        newY = Math.min(Y_AXIS_POSITIVE_MAX, cursorPosition.y + 1);
        break;
      case 'down':
        newY = Math.max(Y_AXIS_NEGATIVE_MAX, cursorPosition.y - 1);
        break;
      case 'left':
        newX = Math.max(X_AXIS_NEGATIVE_MAX, cursorPosition.x - 1);
        break;
      case 'right':
        newX = Math.min(X_AXIS_POSITIVE_MAX, cursorPosition.x + 1);
        break;
    }

    // Only move if not in staging mode OR the position is valid
    const isValidPosition = validPositions.some(([x, y]) => x === newX && y === newY);
    if (!isInStagingMode || isValidPosition) {
      set({ cursorPosition: { x: newX, y: newY } });
    }
    const tileAtCursor = gameStore.tiles.find(t =>
      Math.round(t.position.x) === newX &&
      Math.round(t.position.y) === newY
    );
    tileAtCursor && gameStore.updateSelectedTile(tileAtCursor);
  },
}));
