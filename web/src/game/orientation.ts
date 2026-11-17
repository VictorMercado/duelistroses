import type { Pos } from '@/net/protocol';

/**
 * How the board is turned on screen. Each seat sees it turned so its own edge
 * is nearest (BOARD_ROTATION, by seat); a spectator, and the arena display,
 * see it as seat 0 does, and the display can turn that by quarter turns.
 */
export const BOARD_ROTATION = [0, Math.PI, -Math.PI / 2, Math.PI / 2];

/** The board's turn, in radians, on the arena display turned `quarters` times (counter-clockwise). */
export const displayRotation = (quarters: number) => (((quarters % 4) + 4) % 4) * (Math.PI / 2);

/** The board direction that shows as "up" on a screen turning the board by `rotation` radians. */
export function upOnScreen(rotation: number): Pos {
  // Turning the board by r carries (sin r, cos r) onto screen up, (0, 1).
  return { x: Math.round(Math.sin(rotation)), y: Math.round(Math.cos(rotation)) };
}
