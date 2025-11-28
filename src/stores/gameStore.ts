import { create } from 'zustand';
import { Vector3 } from 'three';
import type { Card, Player, Tile, TilePiece, TurnState, StagingState } from '@/types';
import { isCard, isPlayer } from '@/types';

interface GameState {
  cards: Card[];
  players: Player[];
  tiles: Tile[];
  turnState: TurnState;
  stagingState: StagingState | null;

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

  // Helpers
  getPieceKey: (piece: TilePiece) => string;
  getValidMovePositions: () => Set<string>;
  hasActedThisTurn: (piece: TilePiece) => boolean;
}

export const useGameStore = create<GameState>((set, get) => ({
  cards: [
    {
      id: 1,
      name: "Dark Magician",
      attack: 2500,
      defense: 2100,
      description: "The ultimate wizard in terms of attack and defense.",
      owner: "player",
      position: new Vector3(1, -5, 0.11),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Dark_Magician.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 2,
      name: "Blue-Eyes White Dragon",
      attack: 3000,
      defense: 2500,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "opponent",
      position: new Vector3(0, 4, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_White_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 3,
      name: "Dark Magician Girl",
      attack: 2000,
      defense: 1600,
      description: "The Dark Magician's younger sister. She wields the power of the Dark Magician.",
      owner: "player",
      position: new Vector3(-2, -5, 0.13),
      isFaceDown: true,
      isDefenseMode: false,
      level: 6,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Dark_Magician_Girl.png",
      textureTemplateUrl: "/textures/effectTemplate.png",
    },
    {
      id: 4,
      name: "Red-Eyes Black Dragon",
      attack: 2400,
      defense: 2000,
      description: "A ferocious dragon with a deadly attack.",
      owner: "opponent",
      position: new Vector3(2, 5, 0.14),
      isFaceDown: false,
      isDefenseMode: false,
      level: 7,
      attribute: "Dark",
      attributeUrl: "/attributes/darkAttr.svg",
      textureUrl: "/cards/Red_Eyes_Black_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 5,
      name: "Blue-Eyes White Dragon",
      attack: 3000,
      defense: 2500,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "player",
      position: new Vector3(0, -2, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 8,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_White_Dragon.png",
      textureTemplateUrl: "/textures/normalTemplate.png",
    },
    {
      id: 6,
      name: "Blue-Eyes Ultimate Dragon",
      attack: 4500,
      defense: 3800,
      description: "This legendary dragon is a powerful engine of destruction.",
      owner: "player",
      position: new Vector3(1, -2, 0.12),
      isFaceDown: true,
      isDefenseMode: false,
      level: 12,
      attribute: "Light",
      attributeUrl: "/attributes/lightAttr.svg",
      textureUrl: "/cards/Blue_Eyes_Ultimate_Dragon.png",
      textureTemplateUrl: "/textures/fusionTemplate.png",
    },
    {
      id: 7,
      name: "Black Luster Soldier",
      attack: 3000,
      defense: 2500,
      description: "This monster can only be Ritual Summoned with the Ritual Spell Card, Black Luster Ritual.",
      owner: "player",
      position: new Vector3(-1, -5, 0.13),
      isFaceDown: false,
      isDefenseMode: false,
      level: 8,
      attribute: "Earth",
      attributeUrl: "/attributes/earthAttr.svg",
      textureUrl: "/cards/Black_Luster_Soldier.png",
      textureTemplateUrl: "/textures/ritualTemplate.png",
    },
    {
      id: 8,
      name: "Change of Heart",
      attack: -1,
      defense: -1,
      description: "Target 1 monster your opponent controls; change its ATK and DEF to 0.",
      owner: "player",
      position: new Vector3(0, -3, 0.11),
      isFaceDown: true,
      isDefenseMode: false,
      level: 0,
      attribute: "Spell",
      attributeUrl: "/attributes/spellAttr.png",
      textureUrl: "/cards/Change_of_Heart.png",
      textureTemplateUrl: "/textures/magicTemplate.png",
    }
  ],

  players: [
    {
      id: 1,
      name: "Player 1",
      clan: "Yorkists",
      textureUrl: "/textures/Red_rose_emblem.png",
      position: new Vector3(0, -5, 0.2),
      allCards: [],
      cardsInPlay: [1, 3],
      type: "player",
    },
    {
      id: 2,
      name: "Opponent",
      clan: "Lancastrians",
      textureUrl: "/textures/White_rose_emblem.png",
      position: new Vector3(0, 5, 0.2),
      allCards: [],
      cardsInPlay: [2, 4],
      type: "opponent",
    },
  ],

  tiles: [],

  turnState: {
    currentTurn: 'player',
    actedPieceIds: []
  },

  stagingState: null,

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
    return state.turnState.actedPieceIds.includes(state.getPieceKey(piece));
  }
}));
