import { create } from 'zustand';

/**
 * A card shown in a popup, under the name of the duelist it belongs to.
 * `destroyed` greys it out: it left for the graveyard, and `label` says how
 * ("DESTROYED", "TO GRAVEYARD", "BANISHED").
 */
export interface FlashCard { num: number; seat: number; who: string; destroyed?: boolean; label?: string; }

/**
 * A popup in the middle of the screen (components/ui/ActivationFlash): what
 * one server update set off, shown at once. The cards whose effects went off
 * come first, then every card sent to the graveyard (or banished), so a
 * Raigeki that takes two monsters shows all three cards together.
 */
export interface Activation { key: number; cards: FlashCard[]; }

/** More than this many waiting and the oldest are dropped, so the popups never fall far behind the duel. */
const MAX_QUEUED = 4;
/** The most cards one popup shows: past this they would be too small to read, so the rest follow in another. */
export const MAX_PER_POPUP = 8;

export const useActivationStore = create<{ queue: Activation[]; }>(() => ({ queue: [] }));
let key = 0;

/**
 * Queues what one update set off as one popup (more, if there are more cards
 * than fit). A card already shown going off is not shown twice in a popup.
 */
export function showFlash(cards: FlashCard[]) {
  if (holds > 0) { held.push(cards); return; }
  const unique = cards.filter((card, i) => card.destroyed
    || !cards.slice(0, i).some((c) => !c.destroyed && c.num === card.num && c.seat === card.seat));
  if (!unique.length) return;
  const popups: Activation[] = [];
  for (let i = 0; i < unique.length; i += MAX_PER_POPUP) popups.push({ key: ++key, cards: unique.slice(i, i + MAX_PER_POPUP) });
  useActivationStore.setState(({ queue }) => {
    const next = [...queue, ...popups];
    // Keep the one on screen; drop the oldest waiting ones.
    return { queue: next.length > MAX_QUEUED ? [next[0], ...next.slice(-(MAX_QUEUED - 1))] : next };
  });
}

/**
 * Popups wait while an effect plays out on the board (Raigeki's lightning,
 * Dark Hole's vortex): the board shows what happened first, then the popup
 * tells it. Their order is kept.
 */
let holds = 0;
let held: FlashCard[][] = [];
/** Longest a hold may last: a stalled board (a hidden tab draws no frames) never swallows the popups. */
const MAX_HOLD_MS = 6000;

/** Holds the popups until the returned release is called (once is enough; more do nothing). */
export function holdFlash(): () => void {
  holds++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (--holds > 0) return;
    const waiting = held;
    held = [];
    for (const cards of waiting) showFlash(cards);
  };
  const timer = setTimeout(release, MAX_HOLD_MS);
  return release;
}

/** The popup on screen is done: on to the next. */
export function nextActivation() {
  useActivationStore.setState(({ queue }) => ({ queue: queue.slice(1) }));
}
