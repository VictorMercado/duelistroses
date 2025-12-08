import { create } from 'zustand';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState, SummoningState } from '@/types';
import { Vector3 } from 'three';
import { isCard, isPlayer } from '@/types';
import { cards, players } from '@/data';
import { useInputStore } from './inputStore';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX
} from "@/const";

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

  // Summoning State
  summoningState: SummoningState;

  // Actions
  updateCard: (card: Card) => void;
  updatePlayer: (player: Player) => void;
  updateTilePiece: (tilePiece: TilePiece) => void;
  setTiles: (tiles: Tile[]) => void;
  flipSelectedCard: () => void;
  changePosition: () => void;
  enterSummoningMode: () => void;
  confirmSummonTarget: () => void;
  selectCardForSummon: () => void;
  returnToHand: () => void;
  returnToTarget: () => void;
  confirmSummonPosition: (options: { isFaceDown: boolean; isDefenseMode: boolean; }) => void;
  cancelSummoning: () => void;
  canSummon: () => boolean;

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
  getValidSummonPositions: () => [number, number, number][];
  summonCard: (card: Card, position: Vector3) => void;
  hasActedThisTurn: (piece: TilePiece) => boolean;
}

export const useGameStore = create<GameState>((set, get) => {
  // INITIAL DRAW LOGIC
  const initialPlayers = [...players];
  const player1 = initialPlayers.find(p => p.owner === 'player');
  // Need to map IDs to card objects. Since deck cards are in player.allCards, we can find them there.
  // Note: data.ts initializes players with empty hand. We must draw here.

  let initialHandCards: Card[] = [];

  if (player1) {
    // Draw 5 cards
    const drawIds = player1.deck.slice(0, 5);
    player1.deck = player1.deck.slice(5); // Remove drawn
    player1.hand = [...player1.hand, ...drawIds];

    // Resolve card objects
    initialHandCards = player1.allCards.filter(c => drawIds.includes(c.id));
  }

  return {
    cards: cards,
    currentCardsCount: cards.length,
    players: initialPlayers,
    currentPlayersCount: initialPlayers.length,
    tiles: [],

    turnState: {
      currentTurn: 'player',
      actedPieceIds: []
    },

    stagingState: null,

    // Hand state
    handCards: initialHandCards,
    showHand: false,

    summoningState: { active: false, phase: 'target', targetTile: null, selectedCardId: null },

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

    canSummon: () => {
      const state = get();
      return !state.stagingState;
    },
    // Summoning Actions
    enterSummoningMode: () => {
      const state = get();
      // Only enter if not already active
      if (state.summoningState.active) return;
      // can only summon if tilePiece is not in staging
      if (state.stagingState) return;
      set({
        summoningState: {
          active: true,
          phase: 'target',
          targetTile: null,
          selectedCardId: null
        }
      });

      // Snap cursor to player position (center of summonable area)
      const player = state.players.find(p => p.owner === 'player');
      if (player) {
        useInputStore.getState().setCursorPosition({
          x: player.position.x,
          y: player.position.y
        });
      }
    },

    confirmSummonTarget: () => {
      const state = get();
      if (!state.summoningState.active || state.summoningState.phase !== 'target') return;

      const cursor = useInputStore.getState().cursorPosition;
      const target = new Vector3(cursor.x, cursor.y, 0.06); // Use same Z as valid positions

      // Validate that current cursor is a valid summon position
      const validPositions = state.getValidSummonPositions();
      const isValid = validPositions.some(p => p[0] === cursor.x && p[1] === cursor.y);

      if (isValid) {
        set({
          summoningState: {
            ...state.summoningState,
            phase: 'card',
            targetTile: target
          }
        });
        state.openHand();
      }
    },

    selectCardForSummon: () => {
      const state = get();
      if (!state.summoningState.active || state.summoningState.phase !== 'card') return;
      const handCards = state.handCards;
      const selectedIndex = useInputStore.getState().handSelectedIndex;
      if (selectedIndex >= 0 && selectedIndex < handCards.length) {
        const card = handCards[selectedIndex];
        set((state) => ({
          summoningState: {
            ...state.summoningState,
            phase: 'position',
            selectedCardId: card.id
          },
          showHand: false // Hide full hand to show preview
        }));
      }
    },
    returnToTarget: () => {
      set((state) => ({
        summoningState: {
          ...state.summoningState,
          active: true,
          phase: 'target',
          selectedCardId: null
        },
        showHand: false
      }));
    },
    returnToHand: () => {
      set((state) => ({
        summoningState: {
          ...state.summoningState,
          phase: 'card',
          selectedCardId: null
        },
        showHand: true
      }));
    },

    confirmSummonPosition: (options) => {
      const state = get();
      const { selectedCardId, targetTile } = state.summoningState;

      if (!selectedCardId || !targetTile) return;

      const card = state.handCards.find(c => c.id === selectedCardId);
      if (!card) return;

      // Update card with options
      const finalCard: Card = {
        ...card,
        isFaceDown: options.isFaceDown,
        isDefenseMode: options.isDefenseMode
      };

      state.summonCard(finalCard, targetTile);
      // summonCard handles clearing state
    },

    cancelSummoning: () => {
      set({
        summoningState: { active: false, phase: 'target', targetTile: null, selectedCardId: null },
        showHand: false
      });
      useInputStore.getState().setHandSelectedIndex(-1);
    },

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

    getValidSummonPositions: () => {
      const state = get();
      // Find player leader
      const playerLeader = state.players.find(p => p.owner === 'player');
      if (!playerLeader) return [];

      const positions: [number, number, number][] = [];
      const leaderX = Math.round(playerLeader.position.x);
      const leaderY = Math.round(playerLeader.position.y);

      // 1-tile radius (including diagonals, making it a 3x3 grid minus the center)
      for (let x = leaderX - 1; x <= leaderX + 1; x++) {
        for (let y = leaderY - 1; y <= leaderY + 1; y++) {
          // Skip the leader's own position
          if (x === leaderX && y === leaderY) continue;

          // Check bounds
          if (x >= X_AXIS_NEGATIVE_MAX && x <= X_AXIS_POSITIVE_MAX && y >= Y_AXIS_NEGATIVE_MAX && y <= Y_AXIS_POSITIVE_MAX) {
            // Allow stacking: Do NOT check if occupied by another piece
            positions.push([x, y, 0.06]);
          }
        }
      }
      return positions;
    },

    summonCard: (card, position) => {
      const state = get();
      const player = state.players.find(p => p.owner === 'player');
      if (!player) return;

      // Remove from hand array
      const handIndex = player.hand.indexOf(card.id);
      if (handIndex === -1) return;

      // Only update player state shallowly for now unless we need deep clone?
      // Zustand set() handles merging.

      const newHandIds = [...player.hand];
      newHandIds.splice(handIndex, 1);

      const updatedPlayer = {
        ...player,
        hand: newHandIds,
        cardsInPlay: [...player.cardsInPlay, card.id]
      };

      // Also update handCards view
      const newHandCards = state.handCards.filter(c => c.id !== card.id);

      const summonedCard: Card = {
        ...card,
        position: position,
        // isFaceDown and isDefenseMode are now taken from the passed 'card' object
        // which allows confirmSummonPosition to set them correctly.
        // If called directly with a hand card, it will use that card's state (usually Face Up Attack).
      };

      set((state) => ({
        players: state.players.map(p => p.id === player.id ? updatedPlayer : p),
        handCards: newHandCards,
        cards: [...state.cards, summonedCard],
        showHand: false,
        summoningState: { active: false, phase: 'target', targetTile: null, selectedCardId: null }, // Reset summoning state
        // Do NOT mark as acted immediately, allowing movement/attack if rules permit (or just visual selection)
        // turnState: {
        //   ...state.turnState,
        //   actedPieceIds: [...state.turnState.actedPieceIds, state.getPieceKey(summonedCard)]
        // }
      }));

      // Update cursor to summoned card
      useInputStore.getState().setCursorPosition({ x: Math.round(position.x), y: Math.round(position.y) });

      // Deselect
      useInputStore.getState().selectTilePiece(null);
    },

    hasActedThisTurn: (piece) => {
      const state = get();
      const key = state.getPieceKey(piece);
      return state.turnState.actedPieceIds.includes(key);
    },

    // Hand management
    openHand: () => {
      set(() => ({ showHand: true }));
      // Auto-select first card
      useInputStore.getState().setHandSelectedIndex(0);

      // Snap cursor to a valid summon position
      // const validPositions = get().getValidSummonPositions();
      // if (validPositions.length > 0) {
      //   // Pick the first one (e.g. top-left relative to player)
      //   const firstPos = validPositions[0];
      //   useInputStore.getState().setCursorPosition({ x: firstPos[0], y: firstPos[1] });
      // }
    },
    closeHand: () => set(() => ({ showHand: false })),
  };
});
