import { Texture, Vector3 } from "three";

declare global {
  interface Window {
    gameStore: any;
    uiStore: any;
    inputStore: any;
    __THREE_DEVTOOLS__?: any;
  }
}

export interface KeyBindings {
  select: string;           // Default: "k"
  cancel: string[];         // Default: ["l", "Escape"]
  playCard: string;         // Default: "j" (placeholder)
  viewDetails: string;      // Default: "i"
  flipCard: string;         // Default: "o"
  changePosition: string;   // Default: "u"
  endTurn: string;          // Default: "e"
  cursorUp: string;         // Default: "w"
  cursorDown: string;       // Default: "s"
  cursorLeft: string;       // Default: "a"
  cursorRight: string;      // Default: "d"
}

export type TerrainType = 'sogen' | 'yami' | 'labyrinth' | 'normal' | 'umi' | 'crush' | 'mountain' | 'wasteland' | 'forest' | 'toon';

export type Terrain = {
  type: TerrainType;
  name: string;
  textureUrl: string;
  displacementUrl?: string;
};

export interface Tile {
  terrain: Terrain;
  texture: Texture;
  displacementTexture?: Texture;
  position: Vector3;
}

export type TilePiece = {
  // Cards are numbered by the server; a player's id is the id of the user
  // sitting in that seat.
  id: string | number;
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

export type MonsterType =
  'aqua' |
  'beast' |
  'beast-warrior' |
  'dinosaur' |
  'dragon' |
  'fairy' |
  'fish' |
  'fiend' |
  'immortal' |
  'insect' |
  'machine' |
  'plant' |
  'pyro' |
  'reptile' |
  'rock' |
  'sea-serpent' |
  'spellcaster' |
  'toon' |
  'thunder' |
  'warrior' |
  'winged-beast' |
  'zombie';

export type SpellType =
  'normal' |
  'power-up' |
  'field' |
  'ritual';
// 'continuous' |
// 'quick-play' |

export type TrapType =
  'limited-range' |
  'full-range';
// 'normal' |
// 'continuous' |
// 'counter'

export type Spell = SpellType;
export type Trap = TrapType;
export type Monster = "normal" | "effect" | "fusion" | "ritual";

export type MonsterKind = {
  monster: MonsterType;
  strongIn: TerrainType[];
  weakIn: TerrainType[];
};
export type Attribute = {
  type: "light" | "dark" | "wind" | "water" | "earth" | "fire" | "spell" | "trap";
  attributeUrl: string;
};

export interface Card extends TilePiece {
  id: number;
  name: string;
  attack: number;
  defense: number;
  description: string;
  level: number;
  monster: MonsterKind | null;
  type: Monster | Spell | Trap;
  templateUrl: string;
  attribute: Attribute;
  rarity: Rarity;
  textureUrl: string;
  maskUrl?: string;
  isFaceDown: boolean;
  isDefenseMode: boolean;
  /** Server stripped this card's identity: it is face down and not ours. */
  hidden?: boolean;
}

export type Clan = 'Yorkists' | 'Lancastrians';

export interface Player extends TilePiece {
  id: string;
  name: string;
  clan: Clan;
  textureUrl: string; // Red_rose_emblem.png or White_rose_emblem.png
  deck: number[]; // IDs of cards in deck (server side only, empty on the client)
  hand: number[]; // IDs of cards in hand
  graveyard: number[]; // IDs of cards in graveyard
  cardsInPlay: number[]; // IDs of cards currently in play
  boardSide: 'N' | 'S' | 'E' | 'W'; // Which edge this seat holds
  facing: 'N' | 'S' | 'E' | 'W'; // Which edge this seat looks from (server assigned)
  firstMove: boolean;
  connected?: boolean; // Online only: is somebody sitting here
  deckCount?: number; // Online only: deck size without revealing the cards
  handCount?: number; // Online only: hand size (own hand is also in `hand`)
}

// export interface GamePlayer extends Player {
//   hand: Card[]; // IDs of cards in hand
//   graveyard: Card[]; // IDs of cards in graveyard
//   cardsInPlay: Card[]; // IDs of cards currently in play
//   boardSide: 'N' | 'S' | 'E' | 'W';
// }

// Type guards
export function isCard(tilePiece: TilePiece): tilePiece is Card {
  return 'attack' in tilePiece && 'defense' in tilePiece;
}

export function isPlayer(tilePiece: TilePiece): tilePiece is Player {
  return 'clan' in tilePiece && 'boardSide' in tilePiece;
}

export interface TurnState {
  playerTurnIndex: number;
  actedPieceIds: string[]; // Composite keys like "card-1" or "player-1" to avoid ID collision
}

export interface StagingState {
  pieceId: string | number;
  originalPosition: Vector3;
  originalIsFaceDown?: boolean; // for cards
  originalIsDefenseMode?: boolean; // for cards
  hasMoved: boolean;
  hasFlipped: boolean; // flipped face up/down
  hasChangedPosition: boolean; // changed attack/defense mode
}

export interface SummoningState {
  phase: 'target' | 'card' | 'confirm';
  targetTile: Vector3 | null;
  selectedCardId: number | null;
  playerIndex: number;
}

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}
