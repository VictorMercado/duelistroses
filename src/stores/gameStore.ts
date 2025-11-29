import { create } from 'zustand';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState } from '@/types';
import { isCard, isPlayer } from '@/types';
import { cards, players } from '@/data';

interface GameState {
  cards: Card[];
  players: Player[];
  tiles: Tile[];
  turnState: TurnState;
  stagingState: StagingState | null;

  // Hand state
  handCards: Card[];
  showHand: boolean;

  // Actions
  updateCard: (card: Card) => void;
  updatePlayer: (player: Player) => void;
  updateTilePiece: (tilePiece: TilePiece) => void;
  setTiles: (tiles: Tile[]) => void;

  // Turn management
  initializeStagingState: (piece: TilePiece) => void;
  clearStagingState: () => void;
  commitAction: () => void;
  cancelAction: () => void;

  // Hand management
  openHand: () => void;
  closeHand: () => void;

  // Helpers
  getPieceKey: (piece: TilePiece) => string;
  getValidMovePositions: () => Set<string>;
  hasActedThisTurn: (piece: TilePiece) => boolean;
}

export const useGameStore = create<GameState>((set, get) => ({
  cards: cards,

  players: players,

  tiles: [],

  turnState: {
    currentTurn: 'player',
    actedPieceIds: []
  },

  stagingState: null,

  // Hand state - initially get first 5 cards from player's deck
  handCards: cards.filter(c => c.owner === 'player').slice(0, 5),
  showHand: false,

  // Actions
  updateCard: (card) => set((state) => ({
    cards: state.cards.map(c => c.id === card.id ? card : c)
  })),

  updatePlayer: (player) => set((state) => ({
    players: state.players.map(p => p.id === player.id ? player : p)
  })),

  updateTilePiece: (tilePiece) => {
    const state = get();

    if (isCard(tilePiece)) {
      state.updateCard(tilePiece);
    } else if (isPlayer(tilePiece)) {
      state.updatePlayer(tilePiece);
    }

    // Track if piece moved during staging
    if (state.stagingState && tilePiece.id === state.stagingState.pieceId) {
      const moved = !tilePiece.position.equals(state.stagingState.originalPosition);
      if (moved && !state.stagingState.hasMoved) {
        set({ stagingState: { ...state.stagingState, hasMoved: true } });
      }
    }
  },

  setTiles: (tiles) => set({ tiles }),

  // Turn management
  initializeStagingState: (piece) => {
    const newStagingState: StagingState = {
      pieceId: piece.id,
      originalPosition: piece.position.clone(),
      hasMoved: false,
      hasFlipped: false,
      hasChangedPosition: false
    };

    if (isCard(piece)) {
      newStagingState.originalIsFaceDown = piece.isFaceDown;
      newStagingState.originalIsDefenseMode = piece.isDefenseMode;
    }

    set({ stagingState: newStagingState });
  },

  clearStagingState: () => set({ stagingState: null }),

  commitAction: () => {
    const state = get();
    const { stagingState } = state;

    if (!stagingState) return;

    // Find the piece
    const piece = [...state.cards, ...state.players].find(p => p.id === stagingState.pieceId);
    if (!piece) return;

    // Check if any action was taken
    const actuallyMoved = !piece.position.equals(stagingState.originalPosition);
    if (!actuallyMoved && !stagingState.hasFlipped && !stagingState.hasChangedPosition) {
      // No action taken, just clear staging
      set({ stagingState: null });
      return;
    }

    // Mark piece as having acted
    set((state) => ({
      turnState: {
        ...state.turnState,
        actedPieceIds: [...state.turnState.actedPieceIds, state.getPieceKey(piece)]
      },
      stagingState: null
    }));
  },

  cancelAction: () => {
    const state = get();
    const { stagingState } = state;

    if (!stagingState) return;

    // Find and revert the piece
    const piece = [...state.cards, ...state.players].find(p => p.id === stagingState.pieceId);
    if (!piece) return;
    let reverted = { ...piece, position: stagingState.originalPosition };

    if (isCard(reverted) && stagingState.originalIsFaceDown !== undefined) {
      reverted.isFaceDown = stagingState.originalIsFaceDown;
    }
    if (isCard(reverted) && stagingState.originalIsDefenseMode !== undefined) {
      reverted.isDefenseMode = stagingState.originalIsDefenseMode;
    }

    state.updateTilePiece(reverted);
    set({ stagingState: null });
  },

  // Helpers
  getPieceKey: (piece) => {
    const type = isCard(piece) ? 'card' : 'player';
    return `${type}-${piece.id}`;
  },

  getValidMovePositions: () => {
    const state = get();
    if (!state.stagingState) return new Set();

    const validPositions = new Set<string>();
    const originalPos = state.stagingState.originalPosition;

    // Add the 8 surrounding squares
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = Math.round(originalPos.x) + dx;
        const y = Math.round(originalPos.y) + dy;
        if (x >= -5 && x <= 5 && y >= -5 && y <= 5) {
          validPositions.add(`${x},${y}`);
        }
      }
    }

    // Also add the original position
    validPositions.add(`${Math.round(originalPos.x)},${Math.round(originalPos.y)}`);

    return validPositions;
  },

  hasActedThisTurn: (piece) => {
    const state = get();
    const key = state.getPieceKey(piece);
    return state.turnState.actedPieceIds.includes(key);
  },

  // Hand management
  openHand: () => set(() => ({ showHand: true })),
  closeHand: () => set(() => ({ showHand: false })),
}));
