/**
 * One clock for the holo shimmer and god rays. A shimmering card used to ask
 * for a frame every frame, so one holo card on the board kept the whole scene
 * drawing at the display's full rate (120 Hz on many phones) for the rest of
 * the duel. Instead every canvas with a shimmering card is redrawn at
 * SHIMMER_FPS from one timer; anything else that moves still asks for its
 * own frames, and the shimmer simply rides along at that rate.
 */
const SHIMMER_FPS = 30;

const canvases = new Map<() => void, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (document.hidden) return;
  for (const invalidate of canvases.keys()) invalidate();
}

/** Keeps `invalidate`'s canvas redrawing at the shimmer rate while held. Returns the release. */
export function holdShimmer(invalidate: () => void): () => void {
  canvases.set(invalidate, (canvases.get(invalidate) ?? 0) + 1);
  timer ??= setInterval(tick, 1000 / SHIMMER_FPS);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (canvases.get(invalidate) ?? 1) - 1;
    if (left > 0) canvases.set(invalidate, left);
    else canvases.delete(invalidate);
    if (canvases.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}
