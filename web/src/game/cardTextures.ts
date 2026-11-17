import { DataTexture, RGBAFormat, Texture, TextureLoader, type WebGLRenderer } from 'three';
import { ASSET_URL } from '@/const';

export const BLANK_MASK = ASSET_URL + '/textures/blank_mask.png';
export const MYSTERY_CARD = ASSET_URL + '/cards/mysteryCard.png';

/** What every 3D card shares: loaded with each duel's cards (see game/preload.ts). */
export const SHARED_CARD_TEXTURES = [
  ...['normal', 'effect', 'fusion', 'ritual', 'spell', 'trap'].map((frame) => `${ASSET_URL}/textures/${frame}Template.png`),
  ...['dark', 'earth', 'fire', 'light', 'water', 'wind', 'spell', 'trap'].map((a) => `${ASSET_URL}/attributes/${a}_attribute.svg`),
  ASSET_URL + '/textures/shine_mask_2.png',
  BLANK_MASK,
  ASSET_URL + '/textures/levelStar.png',
  MYSTERY_CARD,
];

/**
 * The textures the 3D cards draw, loaded once and shared. Unlike drei's
 * useTexture this never leaves a card undrawable:
 *
 * - preloading fills the very entries the cards read, so a card whose
 *   textures were preloaded draws on its first frame, without suspending;
 * - a failed load is retried a few times, and then the card draws with its
 *   fallback instead of throwing (drei caches the error for good, and the
 *   card would stay invisible for the rest of the duel);
 * - a loaded texture is uploaded to the GPU at once, not on the frame the
 *   card first appears.
 */
interface Entry {
  promise: Promise<Texture | null>;
  texture?: Texture;
  /** Every attempt failed: draw the fallback. Forgotten after a while, so the url is tried again later. */
  failed?: boolean;
}

const loader = new TextureLoader();
const entries = new Map<string, Entry>();
const ATTEMPTS = 3;
const RETRY_MS = 400; // doubled each attempt
const FORGET_FAILURE_MS = 15_000;

let renderer: WebGLRenderer | null = null;
const upload = (texture: Texture) => { try { renderer?.initTexture(texture); } catch { /* the first frame uploads it instead */ } };

/** Lets loaded textures go to the GPU straight away. Call from inside the board's Canvas. */
export function bindRenderer(gl: WebGLRenderer) {
  renderer = gl;
  for (const entry of entries.values()) if (entry.texture) upload(entry.texture);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function entryFor(url: string): Entry {
  const known = entries.get(url);
  if (known) return known;
  const entry: Entry = { promise: Promise.resolve(null) };
  const attempt = async (n: number): Promise<Texture> => {
    try {
      return await loader.loadAsync(url);
    } catch (error) {
      if (n + 1 >= ATTEMPTS) throw error;
      await wait(RETRY_MS * 2 ** n);
      return attempt(n + 1);
    }
  };
  entry.promise = attempt(0).then(
    (texture) => { entry.texture = texture; upload(texture); return texture; },
    (error) => {
      console.warn('card texture failed to load', url, error);
      entry.failed = true;
      setTimeout(() => { if (entries.get(url) === entry) entries.delete(url); }, FORGET_FAILURE_MS);
      return null;
    },
  );
  entries.set(url, entry);
  return entry;
}

/** Starts loading a texture (if it is not already); resolves once it is ready, or has failed. */
export function loadCardTexture(url: string): Promise<Texture | null> {
  return entryFor(url).promise;
}

/** True once the texture can be drawn without waiting. */
export const cardTextureReady = (url: string) => !!entries.get(url)?.texture;

// Drawn when a texture and its fallback both failed: a transparent pixel, so the rest of the card still shows.
const EMPTY = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
EMPTY.needsUpdate = true;

const FAILED = Symbol('failed');

/** The texture when it is ready, FAILED when it cannot be had; suspends (throws the load) otherwise. */
function read(url: string): Texture | typeof FAILED {
  const entry = entryFor(url);
  if (entry.texture) return entry.texture;
  if (entry.failed) return FAILED;
  throw entry.promise;
}

/**
 * A card's texture, for use inside a Suspense boundary: suspends while it
 * loads (not at all when preloaded), and gives `fallback` (then a blank) if
 * it cannot be loaded. Never throws an error.
 */
export function useCardTexture(url: string, fallback?: string): Texture {
  const texture = read(url);
  if (texture !== FAILED) return texture;
  const second = fallback && fallback !== url ? read(fallback) : FAILED;
  return second !== FAILED ? second : EMPTY;
}
