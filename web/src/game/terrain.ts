import type { GameView } from '@/net/protocol';

/** How tall the mountain relief rises above the board, in board units (a square is 1). */
export const MOUNTAIN_HEIGHT = 0.25;

/** How tall the labyrinth's walls stand, in board units. */
export const LABYRINTH_WALL_HEIGHT = 0.12;

/** How high the open Toon World book's pages stand, in board units. */
export const TOON_BOOK_HEIGHT = 0.08;

/**
 * How tall the forest's tallest pines stand, in board units. They grow around
 * the square's edge, so pieces in the middle are not raised for them.
 */
export const FOREST_TREE_HEIGHT = 0.3;

/**
 * Colours for a monster's ATK and DEF by what its square does to them (the
 * server's CardView.terrain): green where the square powers it up, red where
 * it weakens it. `onCard` is for the light stat box printed on a card face;
 * the others sit on the game's dark panels.
 */
export function terrainTone(bonus: number | undefined, onCard = false): string {
  if (!bonus) return onCard ? 'text-black' : 'text-white';
  if (bonus > 0) return onCard ? 'text-green-700' : 'text-emerald-300';
  return onCard ? 'text-red-700' : 'text-rose-300';
}

/** terrainTone for the 3D card's text, which takes a colour rather than a class. */
export const terrainColor = (bonus: number | undefined) => (!bonus ? 'black' : bonus > 0 ? '#15803d' : '#b91c1c');

/** The terrain name at a square ("normal" off the board). */
export function terrainAt(view: Pick<GameView, 'size' | 'tiles'>, x: number, y: number): string {
  const half = Math.floor(view.size / 2);
  if (Math.abs(x) > half || Math.abs(y) > half) return 'normal';
  return view.tiles[(y + half) * view.size + (x + half)] ?? 'normal';
}

/** How far pieces and highlights on a square are raised so the ground does not swallow them. */
export function liftAt(view: Pick<GameView, 'size' | 'tiles'>, x: number, y: number): number {
  const terrain = terrainAt(view, x, y);
  if (terrain === 'mountain') return MOUNTAIN_HEIGHT;
  if (terrain === 'labyrinth') return LABYRINTH_WALL_HEIGHT;
  if (terrain === 'toon') return TOON_BOOK_HEIGHT;
  return 0;
}
