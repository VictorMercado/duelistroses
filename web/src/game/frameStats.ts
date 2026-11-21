/**
 * Counts frames the 3D scene actually draws. The canvas renders on demand, so
 * this is 0 while nothing moves; a requestAnimationFrame counter would only
 * report the display's refresh rate (and keep the page awake to do it).
 */
let frames = 0;

export function countFrame() {
  frames++;
}

/**
 * Frames drawn since the page loaded. Readers keep their own last value and
 * take the difference, so several counters on screen don't share (and split)
 * one count that each of them resets.
 */
export function totalFrames(): number {
  return frames;
}
