import { create } from 'zustand';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState, SummoningState } from '@/types';
import { isCard, isPlayer } from '@/types';
import type {
  CardChangedPositionPayload,
  InitStatePayload,
  NetRole,
  NetVector3,
} from '@/net/protocol';
import { hideCardIdentity, mergeServerCard, mergeServerPlayer, toVector3 } from '@/net/mappers';

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

  // Multiplayer identity. Everything above is a mirror of room state: until a
  // room sends it, the board is empty.
  isOnline: boolean;
  /** Our seat, which is our own user id. Null when we hold no seat. */
  localPlayerId: string | null;
  netRole: NetRole | null;

  turnState: TurnState;
  selectedTile: Tile | null;
  selectedTilePiece: TilePiece | null;
  stagingState: StagingState | null;

  // Hand state
  handCards: Card[];
  showHand: boolean;

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

  // Multiplayer actions (driven by netManager)
  applyServerInit: (payload: InitStatePayload) => void;
  applyRemoteMove: (cardId: number, target: NetVector3) => void;
  applyRemoteOrientation: (payload: CardChangedPositionPayload) => void;
  applyRemoteDestroy: (cardId: number) => void;
  setTurnToPlayerId: (playerId: string) => void;
  advanceTurnLocally: () => void;
  markPieceActed: (pieceId: string | number) => void;
  resetNetworkState: () => void;
  clearGameState: () => void;

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
  return {
    // The room is the only source of game data: no seats, no board and no hand
    // until INIT_STATE arrives. -1 means "no seat".
    playerIndex: -1,
    isOnline: false,
    localPlayerId: null,
    netRole: null,
    cards: [],
    players: [],
    handCards: [],
    showHand: false,
    tiles: [],

    // Input State
    cursorPosition: { x: 0, y: Y_AXIS_NEGATIVE_MAX },
    handSelectedIndex: -1,

    turnState: {
      playerTurnIndex: -1,
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
    // --- Multiplayer ---
    /**
     * Replaces the local board with the authoritative server state and records
     * which seat this client was given. Cosmetic card data stays local, see
     * net/mappers.ts.
     */
    applyServerInit: (payload) => {
      const serverState = payload.gameState;

      const nextPlayers = serverState.players.map(mergeServerPlayer);

      const nextCards = serverState.cards.map((serverCard) =>
        mergeServerCard(serverCard)
      );

      // Only ever our own hand: the server does not send anyone else's.
      const nextHand = (payload.yourHand ?? []).map((serverCard) =>
        mergeServerCard(serverCard)
      );

      // Spectators get an empty id, and a seat nobody holds also has an empty
      // id, so never match the two up.
      const localIndex = payload.yourId
        ? nextPlayers.findIndex(p => p.id === payload.yourId)
        : -1;
      const activeIndex = nextPlayers.length > 0
        ? serverState.playerTurnIndex % nextPlayers.length
        : 0;

      // Cards the server already marked as moved this turn cannot act again.
      const actedPieceIds = serverState.cards
        .filter(c => c.hasMoved)
        .map(c => String(c.id));

      set({
        isOnline: true,
        localPlayerId: payload.yourId || null,
        netRole: payload.yourRole,
        players: nextPlayers,
        cards: nextCards,
        handCards: nextHand,
        playerIndex: localIndex,
        turnState: { playerTurnIndex: activeIndex, actedPieceIds },
        selectedTilePiece: null,
        stagingState: null,
        summoningState: null,
        showHand: false,
        handSelectedIndex: -1,
      });
    },

    applyRemoteMove: (cardId, target) => {
      set((state) => ({
        cards: state.cards.map(c => c.id === cardId
          ? { ...c, position: toVector3(target), isDefenseMode: false }
          : c),
        turnState: state.turnState.actedPieceIds.includes(String(cardId))
          ? state.turnState
          : {
            ...state.turnState,
            actedPieceIds: [...state.turnState.actedPieceIds, String(cardId)]
          }
      }));
    },

    applyRemoteOrientation: (payload) => {
      set((state) => {
        const seatOwner = state.players[state.playerIndex]?.owner ?? null;

        return {
          cards: state.cards.map((card) => {
            if (card.id !== payload.cardId) return card;

            // Turned face up: the server sends the real card with the event.
            if (payload.card) {
              return {
                ...mergeServerCard(payload.card),
                position: card.position,
              };
            }

            const updated = {
              ...card,
              isDefenseMode: payload.isDefenseMode,
              isFaceDown: payload.isFaceDown,
            };

            // Turned face down again by the other side: forget what it was.
            if (payload.isFaceDown && seatOwner !== null && card.owner !== seatOwner) {
              return hideCardIdentity(updated);
            }
            return updated;
          })
        };
      });
    },

    applyRemoteDestroy: (cardId) => {
      set((state) => ({
        cards: state.cards.filter(c => c.id !== cardId),
        selectedTilePiece: state.selectedTilePiece?.id === cardId ? null : state.selectedTilePiece,
      }));
    },

    /** Turn handed over by the server (END_TURN broadcast). */
    setTurnToPlayerId: (playerId) => {
      if (!playerId) return;
      const state = get();
      const nextIndex = state.players.findIndex(p => p.id === playerId);
      if (nextIndex === -1) return;

      set({
        turnState: { playerTurnIndex: nextIndex, actedPieceIds: [] },
        stagingState: null,
        selectedTilePiece: null,
        summoningState: null,
        showHand: false,
        handSelectedIndex: -1,
      });
    },

    /** Offline turn rotation, mirrors the server's PlayerTurnIndex++ */
    advanceTurnLocally: () => {
      const state = get();
      if (state.players.length === 0) return;
      const nextIndex = (state.turnState.playerTurnIndex + 1) % state.players.length;
      set({
        turnState: { playerTurnIndex: nextIndex, actedPieceIds: [] },
        stagingState: null,
        selectedTilePiece: null,
        summoningState: null,
        showHand: false,
        handSelectedIndex: -1,
      });
    },

    markPieceActed: (pieceId) => {
      set((state) => state.turnState.actedPieceIds.includes(String(pieceId))
        ? state
        : {
          turnState: {
            ...state.turnState,
            actedPieceIds: [...state.turnState.actedPieceIds, String(pieceId)]
          }
        });
    },

    /**
     * Drops the room identity but keeps the last board on screen, so a brief
     * reconnect does not blank the game.
     */
    resetNetworkState: () => {
      set({ isOnline: false, localPlayerId: null, netRole: null });
    },

    /** Leaves the room for good: nothing local survives it. */
    clearGameState: () => {
      set({
        isOnline: false,
        localPlayerId: null,
        netRole: null,
        playerIndex: -1,
        players: [],
        cards: [],
        handCards: [],
        turnState: { playerTurnIndex: -1, actedPieceIds: [] },
        selectedTilePiece: null,
        selectedTile: null,
        stagingState: null,
        summoningState: null,
        showHand: false,
        handSelectedIndex: -1,
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
      // Our own leader, i.e. the seat the server gave us.
      const playerLeader = state.players[state.playerIndex];
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
