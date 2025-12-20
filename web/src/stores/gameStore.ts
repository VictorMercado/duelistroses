import { create } from 'zustand';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState, SummoningState } from '@/types';
import { isCard, isPlayer } from '@/types';
import { cards, players } from '@/data';

import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX
} from "@/const";
import { Vector3 } from 'three';

interface GameState {
  playerIndex: number;
  cards: Card[];
  players: Player[];
  tiles: Tile[];

  turnState: TurnState;
  selectedTile: Tile | null;
  selectedTilePiece: TilePiece | null;
  stagingState: StagingState | null;

  // Hand state
  handCards: Card[];
  showHand: boolean;
  currentPlayersCount: number;
  currentCardsCount: number;

  // Input State
  cursorPosition: { x: number; y: number; };
  handSelectedIndex: number; // -1 if not navigating hand

  // Summoning State
  summoningState: SummoningState | null;

  // Actions
  updateCards: (cards: Card[]) => void;
  updateCard: (card: Card) => void;
  updatePlayer: (player: Player) => void;
  updateTilePiece: (tilePiece: TilePiece) => void;
  updateTurnState: (turnState: TurnState) => void;
  updateSelectedTile: (tile: Tile | null) => void;
  updateSelectedTilePiece: (tilePiece: TilePiece | null) => void;
  updateStagingState: (stagingState: StagingState | null) => void;
  updateSummoningState: (summoningState: SummoningState | null) => void;
  updateHandCards: (handCards: Card[]) => void;
  setCursorPosition: (position: { x: number; y: number; }) => void;
  setHandSelectedIndex: (index: number) => void;

  setTiles: (tiles: Tile[]) => void;
  returnToHand: () => void;
  returnToTarget: () => void;

  // Hand management
  openHand: () => void;
  closeHand: () => void;

  // Helpers
  getPieceKey: (piece: TilePiece) => string;
  getValidMovePositions: () => Vector3[];
  getValidSummonPositions: () => Vector3[];
  getTileAtPosition: (position: Vector3) => Tile | null;
}

export const useGameStore = create<GameState>((set, get) => {
  // INITIAL DRAW LOGIC
  const initialPlayers = [...players];
  const player1 = initialPlayers.find(p => p.firstMove) as Player;
  const playerIndex = initialPlayers.indexOf(player1);
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
    // Hand state
    playerIndex: playerIndex,
    handCards: initialHandCards,
    showHand: false,
    cards: cards,
    currentCardsCount: cards.length,
    players: initialPlayers,
    currentPlayersCount: initialPlayers.length,
    tiles: [],

    // Input State
    cursorPosition: { x: 0, y: Y_AXIS_NEGATIVE_MAX },
    handSelectedIndex: -1,

    turnState: {
      playerTurnIndex: playerIndex,
      actedPieceIds: []
    },
    selectedTile: null,
    selectedTilePiece: null,
    summoningState: null,
    stagingState: null,

    setTiles: (tiles) => set({ tiles }),

    // Actions
    updateCards: (cards) => set({ cards }),
    updateCard: (card) => set((state) => ({
      cards: state.cards.map(c => c.id === card.id ? card : c)
    })),

    updatePlayer: (player) => set((state) => ({
      players: state.players.map(p => p.id === player.id ? player : p)
    })),
    updateSelectedTile: (tile) => set({ selectedTile: tile }),
    updateSelectedTilePiece: (tilePiece) => set({ selectedTilePiece: tilePiece }),
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
    updateTurnState: (turnState) => set({ turnState }),
    updateStagingState: (stagingState) => {
      set({ stagingState });
    },
    updateSummoningState: (summoningState) => set({ summoningState }),
    updateHandCards: (handCards) => set({ handCards }),
    setCursorPosition: (position) => set({ cursorPosition: position }),
    setHandSelectedIndex: (i) => set({ handSelectedIndex: i }),
    returnToTarget: () => {
      const state = get();
      const summoningState = state.summoningState;
      if (!summoningState) return;
      return set({
        summoningState: {
          ...summoningState,
          phase: 'target',
          selectedCardId: null
        },
        showHand: false
      });
    },
    returnToHand: () => {
      const state = get();
      const summoningState = state.summoningState;
      if (!summoningState) return;
      set({
        summoningState: {
          ...summoningState,
          phase: 'card',
          selectedCardId: null
        },
        showHand: true
      });
    },
    // Hand management
    openHand: () => {
      set(() => ({ showHand: true }));
      // Auto-select first card
      get().setHandSelectedIndex(0);

      // Snap cursor to a valid summon position
      // const validPositions = get().getValidSummonPositions();
      // if (validPositions.length > 0) {
      //   // Pick the first one (e.g. top-left relative to player)
      //   const firstPos = validPositions[0];
      //   useInputStore.getState().setCursorPosition({ x: firstPos[0], y: firstPos[1] });
      // }
    },
    closeHand: () => set(() => ({ showHand: false })),

    // Helpers
    getPieceKey: (piece) => {
      const type = isCard(piece) ? 'card' : 'player';
      return `${type}-${piece.id}`;
    },

    getValidMovePositions: () => {
      const state = get();
      if (!state.stagingState) return [];

      const positions: Vector3[] = [];
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
          positions.push(new Vector3(x, y, 0.06));
        }
      }

      // Also add the original position (allows moving back)
      positions.push(new Vector3(Math.round(originalPos.x), Math.round(originalPos.y), 0.06));

      return positions;
    },

    getValidSummonPositions: () => {
      const state = get();
      // Find player leader
      const playerLeader = state.players.find(p => p.owner === 'player');
      if (!playerLeader) return [];

      const positions: Vector3[] = [];
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
            positions.push(new Vector3(x, y, 0.06));
          }
        }
      }
      return positions;
    },
    getTileAtPosition: (position: Vector3) => {
      const state = get();
      const tile = state.tiles.find(tile => tile.position.equals(position));
      return tile || null;
    },
  };
});
