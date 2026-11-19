import { create } from 'zustand';
import type { GameEvent } from '@/net/protocol';

/** Ritual monsters whose summoning is still being played (see RitualRites): kept off the board until they land. */
interface RitualState {
  hidden: number[];
  hide: (id: number) => void;
  show: (id: number) => void;
}

export const useRitualStore = create<RitualState>()((set) => ({
  hidden: [],
  hide: (id) => set((s) => (s.hidden.includes(id) ? s : { hidden: [...s.hidden, id] })),
  show: (id) => set((s) => ({ hidden: s.hidden.filter((h) => h !== id) })),
}));

/** Whether a spell event is a ritual card going off: its rite plays it instead of the usual glow. */
export function isRitualCast(e: GameEvent, events: GameEvent[]) {
  return e.type === 'spell' && events.some((s) => s.type === 'summon' && s.text === 'ritual' && s.seat === e.seat && s.x === e.x && s.y === e.y);
}
