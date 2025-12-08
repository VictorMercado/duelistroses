import { create } from 'zustand';
import { type TilePiece, type KeyBindings, isCard } from '@/types';
import { useGameStore } from './gameStore';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX,
  DEFAULT_KEYBINDINGS
} from "@/const";

interface InputState {
  cursorPosition: { x: number; y: number; };
  keyBindings: KeyBindings;
  selectedTilePiece: TilePiece | null;
  handSelectedIndex: number; // -1 if not navigating hand
  summonOptionIndex: number;

  // Actions
  setCursorPosition: (position: { x: number; y: number; }) => void;
  moveCursor: (direction: 'up' | 'down' | 'left' | 'right') => void;
  updateKeyBindings: (bindings: KeyBindings) => void;
  selectTilePiece: (piece: TilePiece | null) => void;
  updateSelectedPiece: (p: TilePiece | null) => void;
  setHandSelectedIndex: (index: number) => void;
  setSummonOptionIndex: (index: number) => void;
  resetSummonOptionIndex: () => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  cursorPosition: { x: 0, y: Y_AXIS_NEGATIVE_MAX, },
  keyBindings: (() => {
    const saved = localStorage.getItem('keyBindings');
    return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS;
  })(),
  selectedTilePiece: null,
  handSelectedIndex: -1,
  summonOptionIndex: 0,

  // Actions
  setCursorPosition: (position) => set({ cursorPosition: position }),
  setHandSelectedIndex: (i) => set({ handSelectedIndex: i }),
  setSummonOptionIndex: (i) => set({ summonOptionIndex: i }),
  resetSummonOptionIndex: () => set({ summonOptionIndex: 0 }),
  moveCursor: (direction) => {
    const state = get();
    const gameStore = useGameStore.getState();
    const { cursorPosition } = state;
    const validPositions = gameStore.getValidMovePositions();
    const isInStagingMode = state.selectedTilePiece && gameStore.stagingState;

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
    if (gameStore.summoningState.active) {
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
  },

  updateKeyBindings: (bindings) => {
    set({ keyBindings: bindings });
    localStorage.setItem('keyBindings', JSON.stringify(bindings));
  },

  selectTilePiece: (piece) => {
    const state = get();
    const gameStore = useGameStore.getState();
    // If clicking the same piece, do nothing
    if (piece === state.selectedTilePiece) return;

    // If deselecting, cancel current action
    if (!piece) {
      gameStore.cancelAction();
      set({ selectedTilePiece: null });
      return;
    }

    // If there's an active staging session for a different piece, cancel it
    if (gameStore.stagingState && state.selectedTilePiece) {
      const isDifferentPiece =
        state.selectedTilePiece.id !== piece.id ||
        (isCard(state.selectedTilePiece) !== isCard(piece));

      if (isDifferentPiece) {
        gameStore.cancelAction();
      }
    }

    // Check if piece has already acted this turn
    if (gameStore.hasActedThisTurn(piece)) {
      set({ selectedTilePiece: piece });
      // Don't initialize staging for pieces that already acted
      return;
    }

    // Check if it's the correct player's turn
    const isPlayerPiece = piece.owner === 'player';

    if ((gameStore.turnState.currentTurn === 'player' && !isPlayerPiece) || (gameStore.turnState.currentTurn === 'opponent' && isPlayerPiece)) {
      set({ selectedTilePiece: piece });
      // Don't initialize staging for opponent's pieces
      return;
    }

    // Initialize staging state for valid pieces
    gameStore.initializeStagingState(piece);
    // set({ selectedTilePiece: piece });

    // Move cursor to piece position
    const tileX = Math.round(piece.position.x);
    const tileY = Math.round(piece.position.y);
    set({ cursorPosition: { x: tileX, y: tileY }, selectedTilePiece: piece });
  },
  updateSelectedPiece: (piece) => set({ selectedTilePiece: piece }),
}));
