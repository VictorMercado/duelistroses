import { create } from 'zustand';
import type { ChainStep } from '@/net/protocol';

/** Cards played together, waiting to be played back merging (see FusionSequence). */
export interface FusionChain {
  key: string;
  seat: number;
  steps: ChainStep[];
  /** The card the chain became on the board, kept hidden until the animation lands. -1 when none. */
  resultId: number;
  /** Ours to see: after the animation it flies onto its square like any card played from our hand. */
  mine: boolean;
}

interface FusionState {
  queue: FusionChain[];
  /** Board cards whose play-from-hand flight should run when they appear. */
  landing: number[];
  /** Bumped to cut the animation playing now short. */
  skipSeq: number;
  push: (chain: FusionChain) => void;
  finish: (key: string) => void;
  skip: () => void;
  clear: () => void;
}

export const useFusionStore = create<FusionState>()((set) => ({
  queue: [],
  landing: [],
  skipSeq: 0,
  push: (chain) => set((s) => ({ queue: [...s.queue, chain] })),
  finish: (key) => set((s) => {
    const done = s.queue.find((c) => c.key === key);
    if (!done) return s;
    const lands = done.mine && done.resultId >= 0;
    // Only for the moment it appears: a later remount must not replay the flight.
    if (lands) setTimeout(() => set((now) => ({ landing: now.landing.filter((id) => id !== done.resultId) })), 2000);
    return { queue: s.queue.filter((c) => c.key !== key), landing: lands ? [...s.landing, done.resultId] : s.landing };
  }),
  skip: () => set((s) => ({ skipSeq: s.skipSeq + 1 })),
  clear: () => set({ queue: [], landing: [] }),
}));
