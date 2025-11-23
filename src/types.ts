import { Texture, Vector3 } from "three";

export type TileType = 'grass' | 'dark' | 'labyrinth' | 'normal' | 'water' | 'crush' | 'mountain' | 'wasteland' | 'forest';

export interface Tile {
  type: TileType;
  name: string;
  texture: Texture;
  position: Vector3;
}

export type TilePiece = {
  id: number;
  position: Vector3;
};

export interface Card extends TilePiece {
  id: number;
  name: string;
  attack: number;
  defense: number;
  description: string;
  owner: 'player' | 'opponent';
  isFaceDown: boolean;
  isDefenseMode: boolean;
  level: number;
  attribute: string;
  attributeUrl: string;
  textureUrl: string;
  textureTemplateUrl: string;
}

export type Clan = 'Yorkists' | 'Lancastrians';

export interface Player extends TilePiece {
  id: number;
  name: string;
  clan: Clan;
  textureUrl: string; // Red_rose_emblem.png or White_rose_emblem.png
  allCards: Card[]; // All cards the player owns
  cardsInPlay: number[]; // IDs of cards currently in play
  type: 'player' | 'opponent';
}

// Type guards
export function isCard(tilePiece: TilePiece): tilePiece is Card {
  return 'attack' in tilePiece && 'defense' in tilePiece;
}

export function isPlayer(tilePiece: TilePiece): tilePiece is Player {
  return 'clan' in tilePiece && 'allCards' in tilePiece;
}

export interface TurnState {
  currentTurn: 'player' | 'opponent';
  actedPieceIds: string[]; // Composite keys like "card-1" or "player-1" to avoid ID collision
}

export interface StagingState {
  pieceId: number;
  originalPosition: Vector3;
  originalIsFaceDown?: boolean; // for cards
  originalIsDefenseMode?: boolean; // for cards
  hasMoved: boolean;
  hasFlipped: boolean; // flipped face up/down
  hasChangedPosition: boolean; // changed attack/defense mode
}

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}
