import { create } from 'zustand';
import type { Card } from '@/types';
import type { CardView, GameEvent, GameView, RoomInfo, SandboxInfo, Selection } from '@/net/protocol';
import { pruneRenderCards, toRenderCard } from '@/game/catalog';
import { liftAt } from '@/game/terrain';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Somebody else's cursor on the board. */
export interface RemoteCursor { name: string; seat: number; x: number; y: number; spectator: boolean; }

/** A player's selection, shown on the arena display (see Room.selection on the server). */
export interface RemoteSelection extends Selection { seat: number; }

/**
 * What this screen is in the room. With an arena display attached the board
 * lives on the display and each player's phone is a controller: hand,
 * graveyard and buttons, no board. Without one every screen is a board.
 */
export type ScreenRole = 'board' | 'display' | 'controller';

/**
 * A card played from our hand, shown on the board before the server answers
 * (see predictSummon in game/interaction.ts). It is drawn over every server
 * state until the answer to `actionId` arrives: then the server's own state
 * takes over (the card keeps its id, so its fly-in carries on), or, on a
 * refusal, dropPrediction puts the card back in the hand.
 */
export interface Prediction {
  actionId: number;
  seat: number;
  /** The card as it lands: same id as in the hand. */
  card: CardView;
  /** Summoning stars it spends. */
  cost: number;
}

/** `view` with the prediction drawn in, or null when it no longer applies (the card left the hand, the turn moved on). */
function withPrediction(view: GameView, p: Prediction): GameView | null {
  if (view.phase !== 'playing' || view.turn !== p.seat || !view.hand.some((h) => h.id === p.card.id)) return null;
  if (view.cards.some((c) => c.id === p.card.id || (c.x === p.card.x && c.y === p.card.y))) return null;
  return {
    ...view,
    cards: [...view.cards, p.card],
    hand: view.hand.filter((h) => h.id !== p.card.id),
    seats: view.seats.map((s) => (s.index === p.seat ? { ...s, stars: Math.max(0, s.stars - p.cost), playsLeft: Math.max(0, s.playsLeft - 1), handCount: Math.max(0, s.handCount - 1) } : s)),
  };
}

const renderCards = (view: GameView) => {
  const cards = view.cards.map((card: CardView, index) => toRenderCard(card, index, liftAt(view, card.x, card.y)));
  pruneRenderCards(new Set(view.cards.map((card) => card.id)));
  return cards;
};

/** How a bot reached a move. The server sends these to administrators only. */
export interface Thought { id: number; seat: number; name: string; text: string; action: string; }
/**
 * Whether this connection may pause the duel: it is pausable (only computer
 * players besides the one player) and we play it, or we set up a duel
 * between computer players (or are an administrator watching one).
 */
export function selectCanPause(s: Pick<GameState, 'room' | 'seat'>, user?: { id: string; admin?: boolean; } | null): boolean {
  const room = s.room;
  if (!room?.pausable) return false;
  if (s.seat >= 0) return true;
  return room.seats.every((seat) => seat.kind === 'bot') && !!user && (room.hostId === user.id || !!user.admin);
}

export interface LogEntry { id: number; text: string; tone: 'info' | 'good' | 'bad' | 'say' | 'chat'; }

interface GameState {
  status: ConnectionStatus;
  room: RoomInfo | null;
  /** Our seat, -1 when spectating or not in a room. */
  seat: number;
  /** The seat we watch the duel through as a spectator, -1 when playing or not watching anyone. */
  watch: number;
  /** Watching as an administrator: nothing is hidden. */
  admin: boolean;
  /** Playing as an administrator: the test tools are on. */
  tools: boolean;
  /** Playing an administrator's sandbox, where we control every seat; null otherwise. */
  sandbox: SandboxInfo | null;
  /** Other people's cursors, by connection id. */
  cursors: Record<number, RemoteCursor>;
  /** This screen is the room's arena display. */
  display: boolean;
  /** Players' selections, by connection id (the arena display only). */
  selections: Record<number, RemoteSelection>;
  /** What the board shows: the server's last state, with any prediction drawn in. */
  view: GameView | null;
  /** The server's last state, exactly as sent. */
  serverView: GameView | null;
  prediction: Prediction | null;
  /** Renderable cards, derived from view.cards (see game/catalog.ts). */
  cards: Card[];
  /** For the settings panel, which counts seats. */
  players: RoomInfo['seats'];
  deadline: number;
  latency: number | null;
  log: LogEntry[];
  /** LLM bots' reasoning, newest last (administrators only). */
  thoughts: Thought[];
  /** The last few events, for one-shot effects (sound, flashes). */
  lastEvents: GameEvent[];
  eventSeq: number;

  setStatus: (status: ConnectionStatus) => void;
  setRoom: (room: RoomInfo | null, seat?: number, watch?: number, admin?: boolean, tools?: boolean, sandbox?: SandboxInfo | null, display?: boolean) => void;
  setCursor: (cid: number, cursor: RemoteCursor | null) => void;
  setSelection: (cid: number, selection: RemoteSelection | null) => void;
  /** A server state; `answers` is the id of our action it answers, if any. */
  applyState: (view: GameView, events: GameEvent[], deadline: number, answers?: number) => void;
  /** Shows a play before the server answers it. */
  predict: (prediction: Prediction) => void;
  /** Forgets the prediction (the server refused the play), back to the server's state. */
  dropPrediction: () => void;
  pushLog: (text: string, tone?: LogEntry['tone']) => void;
  pushThought: (thought: Omit<Thought, 'id'>) => void;
  setLatency: (ms: number) => void;
  reset: () => void;
}

let logId = 0;

/**
 * A mirror of what the server last sent. Nothing here is computed locally
 * except the conversion of cards into something drawable, and a card we just
 * played, until the server answers (see Prediction).
 */
export const useGameStore = create<GameState>((set) => ({
  status: 'idle',
  room: null,
  seat: -1,
  watch: -1,
  admin: false,
  tools: false,
  sandbox: null,
  cursors: {},
  display: false,
  selections: {},
  view: null,
  serverView: null,
  prediction: null,
  cards: [],
  players: [],
  deadline: 0,
  latency: null,
  log: [],
  thoughts: [],
  lastEvents: [],
  eventSeq: 0,

  setStatus: (status) => set({ status }),
  setRoom: (room, seat, watch, admin, tools, sandbox, display) => set((state) => ({ room, players: room?.seats ?? [], seat: seat ?? state.seat, watch: watch ?? state.watch, admin: admin ?? state.admin, tools: tools ?? state.tools, sandbox: sandbox === undefined ? state.sandbox : sandbox, display: display ?? state.display })),
  setCursor: (cid, cursor) => set((state) => {
    const cursors = { ...state.cursors };
    if (cursor) cursors[cid] = cursor; else delete cursors[cid];
    // A connection that left takes its selection with it.
    const selections = { ...state.selections };
    if (!cursor) delete selections[cid];
    return { cursors, selections };
  }),
  setSelection: (cid, selection) => set((state) => {
    const selections = { ...state.selections };
    if (selection && selection.kind) selections[cid] = selection; else delete selections[cid];
    return { selections };
  }),
  applyState: (serverView, events, deadline, answers) => set((state) => {
    // A state that is not the answer to the predicted play keeps it drawn in.
    let prediction = state.prediction && answers !== state.prediction.actionId ? state.prediction : null;
    const predicted = prediction ? withPrediction(serverView, prediction) : null;
    if (!predicted) prediction = null;
    const view = predicted ?? serverView;
    return {
      view,
      serverView,
      prediction,
      cards: renderCards(view),
      deadline,
      lastEvents: events,
      eventSeq: state.eventSeq + (events.length > 0 ? 1 : 0),
    };
  }),
  predict: (prediction) => set((state) => {
    const view = state.serverView && withPrediction(state.serverView, prediction);
    return view ? { view, prediction, cards: renderCards(view) } : {};
  }),
  dropPrediction: () => set((state) => {
    if (!state.prediction) return {};
    const view = state.serverView;
    return { prediction: null, view, cards: view ? renderCards(view) : [] };
  }),
  pushLog: (text, tone = 'info') => set((state) => ({ log: [...state.log, { id: ++logId, text, tone }].slice(-40) })),
  pushThought: (thought) => set((state) => ({ thoughts: [...state.thoughts, { id: ++logId, ...thought }].slice(-50) })),
  setLatency: (latency) => set({ latency }),
  reset: () => set({ status: 'idle', room: null, seat: -1, watch: -1, admin: false, tools: false, sandbox: null, cursors: {}, display: false, selections: {}, view: null, serverView: null, prediction: null, cards: [], players: [], deadline: 0, log: [], thoughts: [], lastEvents: [] }),
}));

/** What this screen is in the room (see ScreenRole). */
export const selectRole = (state: Pick<GameState, 'display' | 'room' | 'seat'>): ScreenRole =>
  state.display ? 'display' : state.room?.display && state.seat >= 0 ? 'controller' : 'board';

/** Convenience selectors used across components. */
export const selectIsMyTurn = (state: GameState) =>
  !!state.view && state.view.phase === 'playing' && state.seat >= 0 && state.view.turn === state.seat;
/**
 * The team shown as "ours" (green, on the left): our own, or the one we watch
 * through. Watching with nothing hidden, through nobody, it is the first
 * seat's team, so the two teams still read as two sides.
 */
export const selectHomeTeam = (state: GameState): number | undefined => {
  const seats = state.view?.seats;
  return seats?.[selectPerspective(state)]?.team ?? seats?.[0]?.team;
};
/** The seat the board is seen from: our own, or the one we are watching through. */
export const selectPerspective = (state: GameState) => (state.seat >= 0 ? state.seat : state.watch);
export const selectMySeat = (state: GameState) => state.view?.seats[state.seat] ?? null;
