import { Vector3 } from 'three';
import { ASSET_URL } from '@/const';
import { loadCatalog, type CatalogCard } from '@/net/api';
import type { Card } from '@/types';
import type { CardView } from '@/net/protocol';

/**
 * The card catalog, loaded once from the game server. The game server
 * sends card numbers only; names, stats and art are looked up here.
 */
const cards = new Map<number, CatalogCard>();
let loading: Promise<void> | null = null;

export function ensureCatalog(): Promise<void> {
  loading ??= loadCatalog().then((catalog) => {
    for (const card of catalog.cards) cards.set(card.num, card);
  }).catch((error) => {
    loading = null; // let the next caller retry
    throw error;
  });
  return loading;
}

/** Fetches the catalog again (after an administrator saved a card), swapping it in once it arrives. */
export function reloadCatalog(): Promise<void> {
  loading = loadCatalog(true).then((catalog) => {
    cards.clear();
    for (const card of catalog.cards) cards.set(card.num, card);
  });
  return loading;
}

/** The number the server sends for a card hidden from us. Card 0 is a real card, so never test `!num`. */
export const HIDDEN_NUM = -1;

export const catalogCard = (num: number) => cards.get(num);
/** Every card, in catalog order. Empty until ensureCatalog() resolves. */
export const allCards = () => [...cards.values()];
export const cardName = (num?: number) => (num !== undefined ? cards.get(num)?.name : undefined) ?? 'a face-down card';

const HIDDEN_ART = ASSET_URL + '/cards/mysteryCard.png';
const BLANK = ASSET_URL + '/textures/blank_mask.png';

/**
 * Asset urls for a card number: what to draw for it, in 3D or in the DOM.
 * `art` is the small copy (256px), for the hand and the board; `artFull`
 * (512px) is for the card detail view. Either falls back to the PNG when the
 * server has no WebP copy. The holo mask lines up with any size of art.
 */
export function cardArt(num: number) {
  const def = cards.get(num);
  if (!def) return { art: HIDDEN_ART, artFull: HIDDEN_ART, fallback: HIDDEN_ART, template: ASSET_URL + '/textures/normalTemplate.png', attribute: BLANK, mask: undefined as string | undefined };
  // The server decides each card's frame (normal, effect, fusion, ritual, spell, trap, or one of the card's own).
  const url = (file?: string) => (file ? `${ASSET_URL}/${file}` : undefined);
  const full = url(def.art) ?? url(def.image) ?? HIDDEN_ART;
  return {
    art: url(def.artSmall) ?? full,
    artFull: full,
    /** Drawn if the art cannot be loaded: the original PNG, then the card back. */
    fallback: url(def.image) ?? HIDDEN_ART,
    template: `${ASSET_URL}/${def.template ?? 'textures/normalTemplate.png'}`,
    attribute: def.attributeIcon ? `${ASSET_URL}/${def.attributeIcon}` : BLANK,
    mask: def.mask ? `${ASSET_URL}/${def.mask}` : undefined,
  };
}

/**
 * Builds the object the 3D card component draws. Results are cached and reused
 * while nothing about the card changed, so React can skip re-rendering every
 * card that an update did not touch.
 */
const rendered = new Map<number, { key: string; card: Card; }>();

/** `lift` raises the card above high ground (see game/terrain.ts); `full` draws the 512px art. */
export function toRenderCard(view: CardView, index: number, lift = 0, full = false): Card {
  const key = `${full}|${lift}|${view.num}|${view.owner}|${view.x}|${view.y}|${view.faceDown}|${view.defense}|${view.atk}|${view.def}|${view.terrain ?? 0}|${view.hidden}`;
  const cached = rendered.get(view.id);
  if (cached && cached.key === key) return cached.card;

  const def = cards.get(view.num);
  const art = cardArt(view.num);
  const card: Card = {
    id: view.id,
    owner: view.owner,
    // A small, stable z offset per card keeps overlapping planes from flickering.
    position: new Vector3(view.x, view.y, 0.11 + lift + (index % 16) * 0.002),
    name: def?.name ?? 'Face-down card',
    description: def?.text ?? '',
    attack: def?.kind === 'monster' ? view.atk : -1,
    defense: def?.kind === 'monster' ? view.def : -1,
    terrainBonus: view.terrain,
    level: def?.level ?? 0,
    monster: null,
    type: 'normal',
    templateUrl: art.template,
    attribute: { type: 'dark', attributeUrl: art.attribute },
    // Only cards that ship a holo mask get the holographic treatment.
    rarity: art.mask ? 'ultra' : 'common',
    textureUrl: full ? art.artFull : art.art,
    textureFallbackUrl: art.fallback,
    maskUrl: art.mask,
    isFaceDown: view.faceDown,
    isDefenseMode: view.defense,
    hidden: !!view.hidden,
  };
  rendered.set(view.id, { key, card });
  return card;
}

/** A card centred at the origin for the full-screen 3D preview: face up, or its back when hidden from us. */
export function previewRenderCard(num: number, atk?: number, def?: number, terrain?: number): Card {
  const base = cards.get(num);
  const view: CardView = {
    // Ids well clear of real card ids, so the preview never shares a cache entry with a board card.
    id: -1_000_000 - num, num, owner: 0, x: 0, y: 0, faceDown: !base, defense: false, acted: false, hidden: !base,
    atk: atk ?? base?.atk ?? 0, def: def ?? base?.def ?? 0, terrain,
  };
  return { ...toRenderCard(view, 0, 0, true), position: new Vector3(0, 0, 0) };
}

/**
 * The monster type a deck leans on: the most common type among its monsters,
 * capitalised for display ("Sea serpent"). Ties go to the type that comes
 * first in the deck. Undefined with no monsters, or before the catalog loads.
 */
export function mainMonsterType(nums: number[]): string | undefined {
  const counts = new Map<string, number>();
  for (const num of nums) {
    const card = cards.get(num);
    if (card?.kind === 'monster' && card.type) counts.set(card.type, (counts.get(card.type) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [type, n] of counts) if (!best || n > counts.get(best)!) best = type;
  if (!best) return undefined;
  const words = best.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
