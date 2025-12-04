import { create } from 'zustand';
import { type TilePiece, type KeyBindings, isCard, isPlayer, DEFAULT_KEYBINDINGS } from '@/types';
import { useGameStore } from './gameStore';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX
} from "@/const";

interface InputState {
  cursorPosition: { x: number; y: number; };
  keyBindings: KeyBindings;
  selectedTilePiece: TilePiece | null;

  // Actions
  setCursorPosition: (position: { x: number; y: number; }) => void;
  moveCursor: (direction: 'up' | 'down' | 'left' | 'right') => void;
  updateKeyBindings: (bindings: KeyBindings) => void;
  selectTilePiece: (piece: TilePiece | null) => void;
  updateSelectedPiece: (piece: TilePiece) => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  cursorPosition: { x: 0, y: Y_AXIS_NEGATIVE_MAX, },
  keyBindings: (() => {
    const saved = localStorage.getItem('keyBindings');
    return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS;
  })(),
  selectedTilePiece: null,

  // Actions
  setCursorPosition: (position) => set({ cursorPosition: position }),

  moveCursor: (direction) => {
    const state = get();
    const { cursorPosition } = state;
    const validPositions = useGameStore.getState().getValidMovePositions();
    const isInStagingMode = state.selectedTilePiece && useGameStore.getState().stagingState;

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
    const isPlayerPiece = (isCard(piece) && piece.owner === 'player') ||
      (isPlayer(piece) && piece.owner === 'player');

    if ((gameStore.turnState.currentTurn === 'player' && !isPlayerPiece) ||
      (gameStore.turnState.currentTurn === 'opponent' && isPlayerPiece)) {
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
