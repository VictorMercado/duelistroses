import { Texture, Vector3 } from "three";

export interface KeyBindings {
  select: string;           // Default: "k"
  cancel: string[];         // Default: ["l", "Escape"]
  playCard: string;         // Default: "j" (placeholder)
  viewDetails: string;      // Default: "i"
  flipCard: string;         // Default: "o"
  changePosition: string;   // Default: "u"
  cursorUp: string;         // Default: "w"
  cursorDown: string;       // Default: "s"
  cursorLeft: string;       // Default: "a"
  cursorRight: string;      // Default: "d"
}

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
  owner: 'player' | 'opponent';
};
// secret: sparkle image
// super: shiny art
// ghost: white filter with shiny art and level and attribute
// ultra: shiny art, level and attribute
// gold: gold shiny art, bezels, level and attribute
// ultimate: shiny art, bezels, card template, level and attribute, add halo effect
// starlight: sparkle shiny art, bezels, card template, level and attribute, add halo effect
export type Rarity = 'common' | 'secret' | 'ghost' | 'super' | 'ultra' | 'ultimate' | 'starlight' | 'gold';
export const getGlowColor = (rarity: Omit<Rarity, 'common' | 'ghost' | 'secret' | 'ultra' | 'gold'>) => {
  switch (rarity) {
    case 'ultimate': return '#ffffff'; // Orange Red
    case 'starlight': return '#ffd700'; // Orange Red
    default: return '#ffd700'; // Default Gold
  }
};

export interface Card extends TilePiece {
  id: number;
  name: string;
  attack: number;
  defense: number;
  description: string;
  isFaceDown: boolean;
  isDefenseMode: boolean;
  rarity: Rarity;
  level: number;
  attribute: string;
  attributeUrl: string;
  textureUrl: string;
  textureTemplateUrl: string;
  maskUrl?: string;
}

export type Clan = 'Yorkists' | 'Lancastrians';

export interface Player extends TilePiece {
  id: number;
  name: string;
  clan: Clan;
  textureUrl: string; // Red_rose_emblem.png or White_rose_emblem.png
  allCards: Card[]; // All cards the player owns
  cardsInPlay: number[]; // IDs of cards currently in play
  boardSide: 'N' | 'S' | 'E' | 'W';
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
