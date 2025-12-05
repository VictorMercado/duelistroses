import type { KeyBindings, TileType } from "@/types";
import { Vector3 } from "three";

export const PLAYER_BASE_Z = 0.1;
export const BOARD_SIZE = 11;
export const SQUARE_SIZE = 1;
export const X_AXIS_NEGATIVE_MAX = -(BOARD_SIZE-1) / 2;
export const X_AXIS_POSITIVE_MAX = (BOARD_SIZE-1) / 2;
export const Y_AXIS_NEGATIVE_MAX = -(BOARD_SIZE-1) / 2;
export const Y_AXIS_POSITIVE_MAX = (BOARD_SIZE-1) / 2;

export const NORTH_BOARD_START = new Vector3(0, Y_AXIS_POSITIVE_MAX, 0.1);
export const SOUTH_BOARD_START = new Vector3(0, Y_AXIS_NEGATIVE_MAX, 0.1);
export const EAST_BOARD_START = new Vector3(X_AXIS_POSITIVE_MAX, 0, 0.1);
export const WEST_BOARD_START = new Vector3(X_AXIS_NEGATIVE_MAX, 0, 0.1);

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  select: "k",
  cancel: ["l", "Escape"],
  playCard: "j",
  viewDetails: "i",
  flipCard: "o",
  changePosition: "u",
  cursorUp: "w",
  cursorDown: "s",
  cursorLeft: "a",
  cursorRight: "d"
};

export const TILE_TEXTURES: TileType[] = [
  'grass',
  'dark',
  'labyrinth',
  'normal',
  'water'
];