import { create } from 'zustand';
import type { DeckSummary } from '@/net/api';

/** Which screen of the menu is showing while no duel is on. */
export type MenuScreen = 'lobby' | 'decks' | 'maps' | 'admin' | 'profile';

export const useMenuStore = create<{
  screen: MenuScreen;
  setScreen: (screen: MenuScreen) => void;
  /** Whose profile the profile screen shows; empty for your own. */
  profileName: string;
  showProfile: (name?: string) => void;
  /** A deck for the deck builder to open (an administrator may open anyone's). */
  editDeck: DeckSummary | null;
  openDeck: (deck: DeckSummary) => void;
  /** Someone the deck builder starts a new deck for. */
  buildFor: { id: string; name: string; } | null;
  newDeckFor: (person: { id: string; name: string; }) => void;
  clearEditDeck: () => void;
  /** A message for the menu to show, such as why we were sent back to it. */
  notice: string;
  setNotice: (notice: string) => void;
  /** The board shown behind the menu: the map chosen in the lobby, or null for plain ground. */
  backdrop: { size: number; tiles: string[]; } | null;
  setBackdrop: (backdrop: { size: number; tiles: string[]; } | null) => void;
}>()((set) => ({
  screen: 'lobby',
  setScreen: (screen) => set({ screen }),
  profileName: '',
  showProfile: (name = '') => set({ screen: 'profile', profileName: name }),
  editDeck: null,
  openDeck: (deck) => set({ screen: 'decks', editDeck: deck, buildFor: null }),
  buildFor: null,
  newDeckFor: (person) => set({ screen: 'decks', buildFor: person, editDeck: null }),
  clearEditDeck: () => set({ editDeck: null, buildFor: null }),
  notice: '',
  setNotice: (notice) => set({ notice }),
  backdrop: null,
  setBackdrop: (backdrop) => set({ backdrop }),
}));
