import { create } from 'zustand';
import { loadReplay, type ReplayDoc, type ReplayFrame } from './api';
import { session } from './session';
import { cardName, ensureCatalog } from '@/game/catalog';
import { useFusionStore } from '@/stores/fusionStore';

/** How long a step stays on screen while playing, at 1×. */
const STEP_MS = 1200;
export const SPEEDS = [0.5, 1, 2, 4] as const;

interface ReplayState {
  /** The replay being watched, '' for none. */
  id: string;
  doc: ReplayDoc | null;
  loading: boolean;
  error: string;
  /** The frame on the board. */
  index: number;
  playing: boolean;
  speed: number;
}

/**
 * The replay player: a recorded duel (see the server's package replay) fed
 * into the game store through the session, as if a room were sending it.
 * Stepping forward plays the step's events (animations and sounds); jumping
 * anywhere else just shows the board as it was.
 */
export const useReplayStore = create<ReplayState>(() => ({
  id: '', doc: null, loading: false, error: '', index: 0, playing: false, speed: 1,
}));

/** Whether a replay is on screen: nobody to talk to, nothing to change, only things to look at. */
export const useReplaying = () => useReplayStore((s) => s.doc !== null);

let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Opens a replay and shows its first step. */
export async function openReplay(id: string) {
  closeReplay();
  useReplayStore.setState({ id, loading: true, error: '', doc: null, index: 0, playing: false });
  try {
    const [doc] = await Promise.all([loadReplay(id), ensureCatalog().catch(() => { })]);
    if (useReplayStore.getState().id !== id) return; // closed, or another opened, meanwhile
    if (!doc.frames?.length) throw new Error('This replay has nothing in it');
    useReplayStore.setState({ doc, loading: false });
    session.startPlayback(doc.room);
    show(0, false);
  } catch (e) {
    if (useReplayStore.getState().id !== id) return;
    useReplayStore.setState({ loading: false, error: (e as Error).message });
  }
}

/** Opens a replay and puts it in the address bar, so the link can be shared. */
export function watchReplay(id: string) {
  const params = new URLSearchParams(window.location.search);
  params.set('replay', id);
  window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  void openReplay(id);
}

/** Stops watching and goes back to the menu. */
export function closeReplay() {
  stopTimer();
  const was = useReplayStore.getState().id;
  useReplayStore.setState({ id: '', doc: null, loading: false, error: '', index: 0, playing: false });
  if (was) session.disconnect();
  const params = new URLSearchParams(window.location.search);
  if (params.has('replay')) {
    params.delete('replay');
    window.history.replaceState(null, '', window.location.pathname + (params.size ? `?${params}` : ''));
  }
}

function show(index: number, animate: boolean) {
  const { doc } = useReplayStore.getState();
  if (!doc) return;
  const i = Math.max(0, Math.min(doc.frames.length - 1, index));
  const frame = doc.frames[i];
  useReplayStore.setState({ index: i });
  session.playback(i + 1, frame.state, animate ? frame.events ?? [] : []);
}

/** Shows step i: the next one played out, any other one jumped to. */
export function seek(index: number) {
  const { index: at } = useReplayStore.getState();
  show(index, index === at + 1);
}

export const step = (by: number) => seek(useReplayStore.getState().index + by);

/** Jumps to the first step of the next turn (by 1) or of this or the previous one (by -1). */
export function stepTurn(by: 1 | -1) {
  const { doc, index } = useReplayStore.getState();
  if (!doc) return;
  const turnOf = (i: number) => doc.frames[i].state.turnCount;
  const here = turnOf(index);
  if (by > 0) {
    let i = index + 1;
    while (i < doc.frames.length && turnOf(i) === here) i++;
    seek(Math.min(i, doc.frames.length - 1));
    return;
  }
  // Back to the start of this turn, or of the previous one if already there.
  let i = index;
  while (i > 0 && turnOf(i - 1) === here) i--;
  if (i === index && i > 0) {
    const previous = turnOf(i - 1);
    i--;
    while (i > 0 && turnOf(i - 1) === previous) i--;
  }
  seek(i);
}

/** Plays the steps one after another, waiting for each fusion to finish animating. */
export function setPlaying(playing: boolean) {
  stopTimer();
  const { doc, index } = useReplayStore.getState();
  if (!doc) return;
  if (playing && index >= doc.frames.length - 1) show(0, false); // from the start again
  useReplayStore.setState({ playing });
  if (playing) schedule();
}

function schedule() {
  stopTimer();
  const { speed } = useReplayStore.getState();
  timer = setTimeout(() => {
    const { doc, index, playing } = useReplayStore.getState();
    if (!doc || !playing) return;
    if (useFusionStore.getState().queue.length) { schedule(); return; } // let it finish
    if (index >= doc.frames.length - 1) { useReplayStore.setState({ playing: false }); return; }
    seek(index + 1);
    schedule();
  }, STEP_MS / speed);
}

export function setSpeed(speed: number) {
  useReplayStore.setState({ speed });
  if (useReplayStore.getState().playing) schedule();
}

/** What a step was, in words: "Alice summons Dark Magician". */
export function describe(doc: ReplayDoc, index: number): string {
  const frame: ReplayFrame = doc.frames[index];
  if (frame.seat < 0) return 'The duel is dealt';
  const who = doc.room.seats[frame.seat]?.name || `Seat ${frame.seat + 1}`;
  if (frame.tool) return `${who} used the test tool "${frame.tool}"`;
  const a = frame.action;
  if (!a) return who;
  // Card ids are named from the board as it was just before.
  const before = doc.frames[Math.max(0, index - 1)].state;
  const name = (id?: number) => {
    if (id == null) return 'a card';
    const num = before.cards.find((c) => c.id === id)?.num
      ?? before.reveal?.hands.flat().find((c) => c.id === id)?.num;
    return num != null && num >= 0 ? cardName(num) : 'a card';
  };
  const names = (ids?: number[]) => (ids ?? []).map(name).join(' + ') || 'a card';
  switch (a.type) {
    case 'summon': return `${who} plays ${names(a.cardIds)}`;
    case 'move': return `${who} moves ${name(a.cardId)}`;
    case 'flip': return `${who} flips ${name(a.cardId)}`;
    case 'position': return `${who} switches ${name(a.cardId)} to ${a.defense ? 'defense' : 'attack'}`;
    case 'leader': return `${who} moves their deck leader`;
    case 'discard': return `${who} discards ${names(a.cardIds)}`;
    case 'choose': return `${who} makes a choice`;
    case 'endTurn': return `${who} ends their turn`;
    case 'concede': return `${who} concedes`;
  }
  return `${who}: ${a.type}`;
}
