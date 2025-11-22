import { Texture, Vector3 } from "three";

export type TileType = 'grass' | 'dark' | 'labyrinth' | 'normal' | 'water' | 'crush' | 'mountain' | 'wasteland' | 'forest';

export interface Tile {
  type: TileType;
  name: string;
  texture: Texture;
  position: Vector3;
}

export type TilePiece = {
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
  isHuman: boolean; // true for player, false for opponent
}
