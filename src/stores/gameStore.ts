import { create } from 'zustand';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState } from '@/types';
import { isCard, isPlayer } from '@/types';
import { cards, players } from '@/data';
import { useInputStore } from './inputStore';
import { X_AXIS_NEGATIVE_MAX, 
  X_AXIS_POSITIVE_MAX, 
  Y_AXIS_NEGATIVE_MAX, 
  Y_AXIS_POSITIVE_MAX } from "@/const";

interface GameState {
  cards: Card[];
  players: Player[];
  tiles: Tile[];
  turnState: TurnState;
  stagingState: StagingState | null;

  // Hand state
  handCards: Card[];
  showHand: boolean;
  currentPlayersCount: number;
  currentCardsCount: number;

  // Actions
  updateCard: (card: Card) => void;
  updatePlayer: (player: Player) => void;
  updateTilePiece: (tilePiece: TilePiece) => void;
  setTiles: (tiles: Tile[]) => void;
  flipSelectedCard: () => void;
  changePosition: () => void;

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
  getValidMovePositions: () => [number, number, number][];
  hasActedThisTurn: (piece: TilePiece) => boolean;
}

export const useGameStore = create<GameState>((set, get) => ({
  cards: cards,
  currentCardsCount: cards.length,
  players: players,
  currentPlayersCount: players.length,
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
  flipSelectedCard: () => {
    const state = get();
    const selectedTilePiece = useInputStore.getState().selectedTilePiece;
    const stagingState = state.stagingState;
    if (!selectedTilePiece || !isCard(selectedTilePiece)) return;
    if (!stagingState) return;

    // Get fresh piece data
    const freshCards = state.cards;
    const currentPiece = freshCards.find(p => p.id === selectedTilePiece.id);

    if (!currentPiece) return;

    // Yu-Gi-Oh rule: Can't flip a card back down if it was originally face-up
    if (stagingState.originalIsFaceDown === false) {
      return;
    }

    const updated = { ...currentPiece, isFaceDown: !currentPiece.isFaceDown };
    state.updateTilePiece(updated);

    // Update selected piece in input store to keep it fresh
    useInputStore.getState().updateSelectedPiece(updated);

    // Mark as flipped in staging
    const isDifferentFromOriginal = stagingState.originalIsFaceDown !== undefined &&
      updated.isFaceDown !== stagingState.originalIsFaceDown;

    set((state) => ({
      stagingState: state.stagingState
        ? { ...state.stagingState, hasFlipped: isDifferentFromOriginal }
        : null
    }));
  },
  changePosition() {
    const state = get();
    const selectedTilePiece = useInputStore.getState().selectedTilePiece;
    const stagingState = state.stagingState;
    if (!selectedTilePiece || !isCard(selectedTilePiece) || !stagingState) return;
    if (!selectedTilePiece.position.equals(stagingState.originalPosition)) return;
    const updated = { ...selectedTilePiece, isDefenseMode: !selectedTilePiece.isDefenseMode };
    state.updateTilePiece(updated);
    useInputStore.getState().updateSelectedPiece(updated);
    const isDifferentFromOriginal = stagingState.originalIsDefenseMode !== undefined &&
      updated.isDefenseMode !== stagingState.originalIsDefenseMode;
    state.stagingState = state.stagingState
      ? { ...state.stagingState, hasChangedPosition: isDifferentFromOriginal }
      : null;
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
    // const actuallyMoved = !piece.position.equals(stagingState.originalPosition);
    // if (!actuallyMoved && !stagingState.hasFlipped && !stagingState.hasChangedPosition) {
    //   // No action taken, just clear staging
    //   set({ stagingState: null });
    //   return;
    // }

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
    if (!state.stagingState) return [];

    const positions: [number, number, number][] = [];
    const originalPos = state.stagingState.originalPosition;

    // Add only the 4 cardinal directions (N, S, E, W)
    const offsets: [number, number][] = [
      [0, 1],   // N
      [0, -1],  // S
      [1, 0],   // E
      [-1, 0],  // W
    ];

    for (const [dx, dy] of offsets) {
      const x = Math.round(originalPos.x) + dx;
      const y = Math.round(originalPos.y) + dy;

      // Check bounds
      if (x >= X_AXIS_NEGATIVE_MAX && x <= X_AXIS_POSITIVE_MAX && y >= Y_AXIS_NEGATIVE_MAX && y <= Y_AXIS_POSITIVE_MAX) {
        positions.push([x, y, 0.06]);
      }
    }

    // Also add the original position (allows moving back)
    positions.push([Math.round(originalPos.x), Math.round(originalPos.y), 0.06]);

    return positions;
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
