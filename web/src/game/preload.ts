import { cardArt, catalogCard, ensureCatalog } from '@/game/catalog';
import { loadCardTexture, SHARED_CARD_TEXTURES } from '@/game/cardTextures';

/**
 * Card art fetched ahead of time, so a card shows the moment it is drawn or
 * played instead of popping in. Two copies of each are warmed:
 *
 * - the 3D textures the board draws (game/cardTextures.ts), the very
 *   entries the cards read, already on the GPU;
 * - the DOM images the hand draws: kept here, decoded, so the hand's <img>
 *   tags for the same urls draw from memory at once.
 */
const held = new Map<string, Promise<void>>();

/** Fetches and decodes an image for the DOM; resolves once it is ready (or has failed). */
function warmImage(url: string): Promise<void> {
  const known = held.get(url);
  if (known) return known;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  // The element is kept alive by the promise, so its decoded copy stays in memory.
  const ready = img.decode().then(() => void img, () => { held.delete(url); }); // a missing file: let a later call try again
  held.set(url, ready);
  return ready;
}

const idle = (fn: () => void) =>
  'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200);

/**
 * Starts loading everything these cards draw with, templates first (every
 * card is drawn on one); resolves once all of it is ready, or has failed.
 */
function load(nums: Iterable<number>): Promise<unknown> {
  const templates = new Set<string>(SHARED_CARD_TEXTURES.filter((url) => url.endsWith('Template.png')));
  const textures = new Set<string>(SHARED_CARD_TEXTURES);
  const images = new Set<string>();
  for (const num of new Set(nums)) {
    if (!catalogCard(num)) continue;
    const art = cardArt(num);
    templates.add(art.template); // a card's own frame (the Egyptian Gods)
    for (const url of [art.art, art.attribute]) { textures.add(url); images.add(url); }
    if (art.mask) textures.add(art.mask);
  }
  // Templates lead both queues: the hand's <img> faces and the 3D cards.
  return Promise.all([
    ...[...templates].map(warmImage),
    ...[...templates].map(loadCardTexture),
    ...[...images].map(warmImage),
    ...[...textures].filter((url) => !templates.has(url)).map(loadCardTexture),
  ]);
}

/** Fetches the art of these cards in the background, when the browser is idle (the lobby's chosen deck). */
export function preloadCards(nums: Iterable<number>) {
  const wanted = [...nums];
  if (!wanted.length) return;
  ensureCatalog().then(() => idle(() => void load(wanted))).catch(() => { });
}

/**
 * Loads the art of these cards now, resolving once it is ready or after
 * `timeoutMs`, whichever comes first: a duel waits on its opening hand with
 * this, so the first card played can fly in at once.
 */
export function readyCards(nums: Iterable<number>, timeoutMs: number): Promise<void> {
  const wanted = [...nums];
  const ready = ensureCatalog().then(() => load(wanted)).catch(() => { });
  return Promise.race([ready, new Promise((resolve) => setTimeout(resolve, timeoutMs))]).then(() => { });
}
