import { create } from 'zustand';

/**
 * Exodia's win being played on the board (see components/game/Exodia). The
 * board drives the stages so the screen overlay (title, flash, quake) keeps
 * time with it, and the Game Over screen waits until it is over.
 *
 *   rise      the five pieces light up and rise off the field
 *   assemble  they fly together into the Forbidden One
 *   awaken    the seals break, it wakes
 *   charge    the blast gathers
 *   unleash   Obliterate!
 *   fade      the light dies down
 */
export type ExodiaStage = 'idle' | 'rise' | 'assemble' | 'awaken' | 'charge' | 'unleash' | 'fade';

interface ExodiaState {
  stage: ExodiaStage;
  /** Bumped for every jolt the screen should shake with; `power` 0..1. */
  quake: { n: number; power: number; };
}

export const useExodiaStore = create<ExodiaState>(() => ({ stage: 'idle', quake: { n: 0, power: 0 } }));

/** Longest the Game Over screen waits: a stalled board (a hidden tab draws no frames) never hides it for good. */
const MAX_MS = 14000;
let timer: ReturnType<typeof setTimeout> | undefined;

export function exodiaStage(stage: ExodiaStage) {
  clearTimeout(timer);
  if (stage !== 'idle') timer = setTimeout(() => useExodiaStore.setState({ stage: 'idle' }), MAX_MS);
  useExodiaStore.setState({ stage });
}

export function exodiaQuake(power: number) {
  useExodiaStore.setState(({ quake }) => ({ quake: { n: quake.n + 1, power } }));
}
