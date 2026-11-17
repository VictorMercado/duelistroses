import { create } from 'zustand';

/** The "Destiny Draw!" banner on screen, if any (see components/ui/DestinyBanner). */
export interface Destiny { key: number; who: string; num?: number; mine: boolean; }

export const useDestinyStore = create<{ shown: Destiny | null; }>(() => ({ shown: null }));
let key = 0;

/** Shows the banner. num: the card, only when it is ours to know. */
export function showDestiny(who: string, mine: boolean, num?: number) {
  useDestinyStore.setState({ shown: { key: ++key, who, num, mine } });
}

export function hideDestiny() {
  useDestinyStore.setState({ shown: null });
}
