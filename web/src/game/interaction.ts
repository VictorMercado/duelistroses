import { create } from 'zustand';
import { selectRole, useGameStore, type Prediction } from '@/stores/gameStore';
import { BOARD_WIPES, session } from '@/net/session';
import { cardName, catalogCard } from '@/game/catalog';
import { terrainAt } from '@/game/terrain';
import { playSfx, type Sfx } from '@/game/sfx';
import { BOARD_ROTATION, displayRotation, upOnScreen } from '@/game/orientation';
import { setInputHandler, type InputAction, type InputDevice } from '@/input/actions';
import type { Action, CardView, GameView, HandCardView, Pos, Selection } from '@/net/protocol';

/**
 * What the player is in the middle of doing. This is a small explicit state
 * machine: every input is interpreted by the current mode and nothing else.
 *
 *   browse  the cursor roams the board. Whatever is under it is "in focus" and
 *           shown in the side panel; focus is always just the cursor, never a
 *           separate piece of state that could fall out of step.
 *   card    one of our cards is picked up: its legal squares are lit and
 *           Confirm on one of them orders the move (or attack, or merge).
 *           Flip and Position only stage a change (shown on the board);
 *           Confirm on the card itself commits it. Turning face up or into
 *           attack position is free, so the card can still move; switching
 *           into defense is its whole order for the turn.
 *   leader  our deck leader is picked up: step it, or start a summon.
 *   place   summoning, step 1: choose the square next to the leader the
 *           card will go to.
 *   hand    the hand is open. With a `target` (summoning, step 2) choose the
 *           card to play there; Up marks cards to fuse, in order, and the
 *           highlighted card joins last. Without a target it is
 *           only being looked at (not our turn, or nothing left to play).
 *   grave   a graveyard is open to look through, newest card first. Anyone
 *           can open any seat's graveyard at any time: they are public.
 *
 * A decision the server is waiting on (e.g. which monster to revive) takes
 * over all input until it is answered. Reviving (Monster Reborn) is answered
 * in the graveyard view itself. While an action is on its way to the
 * server the machine is `busy` and ignores orders, so two actions can never
 * overlap; the server's answer (or its refusal) clears it.
 */
export type Mode =
  | { kind: 'browse'; }
  /** `flip` and `switchPosition` are staged, not yet sent: Confirm on the card commits them. */
  | { kind: 'card'; cardId: number; flip: boolean; switchPosition: boolean; }
  | { kind: 'leader'; }
  | { kind: 'hand'; picked: number[]; target: Pos | null; }
  | { kind: 'place'; }
  /** `index` counts from the newest card in that seat's graveyard. */
  | { kind: 'grave'; seat: number; index: number; };

interface InteractionState {
  mode: Mode;
  cursor: Pos;
  handIndex: number;
  choiceIndex: number;
  busy: boolean;
  /** Card shown full screen in the 3D preview (rotatable, with its holo foil). `note` is its state on the board. */
  preview: { num: number; atk?: number; def?: number; /** What its square adds to ATK and DEF. */ terrain?: number; note?: string; /** A deck leader: shown as its art alone, not as a card. */ leader?: boolean; } | null;
  /** Square whose terrain is shown full screen. */
  tilePreview: Pos | null;
  device: InputDevice;
  /**
   * For an administrator watching with nothing hidden: the seat whose hand
   * the hand view shows, chosen by tapping its deck leader. -1 follows the
   * turn.
   */
  handSeat: number;
}

export const useInteraction = create<InteractionState>(() => ({
  mode: { kind: 'browse' },
  cursor: { x: 0, y: 0 },
  handIndex: 0,
  choiceIndex: 0,
  busy: false,
  preview: null,
  tilePreview: null,
  device: 'keyboard',
  handSeat: -1,
}));

// Every way of inspecting (a card, a deck leader, the ground) opens one of the
// two previews: the sound plays as one opens, whatever opened it.
useInteraction.subscribe((state, previous) => {
  if ((state.preview && !previous.preview) || (state.tilePreview && !previous.tilePreview)) playSfx('infoUp', 0.4);
});

const set = useInteraction.setState;
const get = useInteraction.getState;

// --- reading the game ------------------------------------------------------

interface Ctx {
  view: GameView; seat: number; /** Seat the board is seen from; differs from seat for a spectator. */ perspective: number;
  /**
   * How the board is turned on the screen the player looks at, in radians,
   * which is what the directions follow: their own board, or on a controller
   * the arena display, turned as the display has it. With the display flat
   * on a table and seat controls on, it is the player's own seat's turn
   * again: "up" is away from their edge.
   */
  facing: number;
  myTurn: boolean; choosing: boolean; /** The hand we can look at (see visibleHand). */ hand: HandCardView[]; }

/**
 * Whose hand the hand view shows: a seated player's own, a spectator's who
 * they watch through, or, for an administrator who sees every hand, the
 * seat picked by tapping its leader (else whoever's turn it is).
 */
export function handOwner(view: GameView, seat: number, watch: number, handSeat: number): number {
  if (seat >= 0) return seat;
  if (view.reveal) return view.reveal.hands[handSeat] ? handSeat : view.turn;
  return watch;
}

/** The cards the hand view shows (see handOwner). */
export function visibleHand(view: GameView, seat: number, watch: number, handSeat: number): HandCardView[] {
  if (seat < 0 && view.reveal) return view.reveal.hands[handOwner(view, seat, watch, handSeat)] ?? [];
  return view.hand;
}

function context(): Ctx | null {
  const game = useGameStore.getState();
  const { view, seat, watch } = game;
  if (!view) return null;
  const playing = view.phase === 'playing';
  const perspective = seat >= 0 ? seat : watch;
  return {
    view, seat, perspective,
    facing: selectRole(game) === 'controller' && !game.room?.seatControls ? displayRotation(game.room?.displayTurn ?? 0) : BOARD_ROTATION[perspective] ?? 0,
    hand: visibleHand(view, seat, watch, get().handSeat),
    myTurn: playing && seat >= 0 && view.turn === seat && !view.pending,
    choosing: playing && !!view.pending && view.pending.seat === seat,
  };
}

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const cardAt = (view: GameView, p: Pos) => view.cards.find((c) => c.x === p.x && c.y === p.y);
const leaderAt = (view: GameView, p: Pos) => view.seats.find((s) => s.alive && s.leaderX === p.x && s.leaderY === p.y);

/** A card's state on the board, as a short line ("face down · defense · spellbound 2"). */
export function cardNote(card: CardView): string | undefined {
  if (card.hidden) return undefined;
  const parts = [card.faceDown ? 'face down' : 'face up'];
  if (catalogCard(card.num)?.kind === 'monster') parts.push(card.defense ? 'defense' : 'attack');
  if (card.atkMod) parts.push(`${card.atkMod > 0 ? '+' : ''}${card.atkMod} power`);
  if (card.spellbound) parts.push(`spellbound${card.spellbound > 0 ? ` ${card.spellbound}` : ''}`);
  return parts.join(' · ');
}

/** Opens the 3D preview of the card or deck leader at `p`. False when there is neither. */
function inspectCardAt(view: GameView, p: Pos): boolean {
  const card = cardAt(view, p);
  // A card hidden from us previews as its back.
  if (card) { set({ preview: { num: card.num, atk: card.atk, def: card.def, terrain: card.terrain, note: cardNote(card) } }); return true; }
  const leader = leaderAt(view, p);
  if (leader && leader.leaderNum >= 0) { set({ preview: { num: leader.leaderNum, note: `deck leader · ${leader.lp} LP`, leader: true } }); return true; }
  return false;
}

const leaderOf = (view: GameView, seat: number): Pos | null => {
  const s = view.seats[seat];
  return s && s.alive ? { x: s.leaderX, y: s.leaderY } : null;
};

/** Where a card can move this turn; with `flip`, as it will be once turned face up on the way. */
export function moveTargets(view: GameView, cardId: number, flip = false): Pos[] {
  const id = String(cardId);
  return (flip ? view.legal?.flipMoves?.[id] : undefined) ?? view.legal?.moves[id] ?? [];
}

/** True when the picked-up card has a switch into defense staged: that ends its turn where it stands. */
export function stagedDefense(view: GameView, mode: Mode): boolean {
  if (mode.kind !== 'card' || !mode.switchPosition) return false;
  const card = view.cards.find((c) => c.id === mode.cardId);
  return !!card && !card.defense;
}

/**
 * Directions are relative to the screen. Each seat sees the board turned so
 * its own edge is nearest, so "up" is a different board direction per seat
 * (see game/orientation.ts).
 */
function step(action: InputAction, rotation: number): Pos {
  const up = upOnScreen(rotation);
  const right = { x: up.y, y: -up.x };
  switch (action) {
    case 'UP': return up;
    case 'DOWN': return { x: -up.x, y: -up.y };
    case 'LEFT': return { x: -right.x, y: -right.y };
    default: return right;
  }
}

const isDirection = (a: InputAction) => a === 'UP' || a === 'DOWN' || a === 'LEFT' || a === 'RIGHT';

// --- doing things ----------------------------------------------------------

function refuse() { playSfx('cant', 0.4); }
/** Backing out of something: closing a menu, putting a card down, leaving a preview. */
function backOut() { playSfx('cancel', 0.4); }

/**
 * The sound an action surely makes, played the moment it is sent rather than
 * when the server confirms it: only what the action itself is certain to do
 * (a step, a card landing, a spell going off, the turn ending). What follows
 * from it (a battle, a fusion, a trap) is still heard when the server says so.
 */
function soundsOf(action: Action, view: GameView): [Sfx, number?][] {
  switch (action.type) {
    case 'endTurn': return [['endTurn']];
    case 'move': case 'leader': return [['move', 0.35]];
    case 'summon':
      // A fusion chain, or a card played onto another, is sounded as it merges.
      return action.cardIds.length === 1 && !cardAt(view, action) ? [['cardIn']] : [];
    case 'flip': {
      const def = catalogCard(view.cards.find((c) => c.id === action.cardId)?.num ?? -1);
      if (def?.kind !== 'spell') return []; // a ritual is sounded by the summon it performs
      return [[BOARD_WIPES.has(def.effect?.op ?? '') ? 'cleanboard' : 'spell']];
    }
  }
  return [];
}

/** What to change once the server accepts an action, by its id (see send). */
let onAccept: { id: number; patch: Partial<InteractionState>; } | null = null;
/** What to put back if the server refuses a predicted play (the hand as it was). */
let onRefuse: { id: number; patch: Partial<InteractionState>; } | null = null;

/**
 * Sends an action; false when it could not go (busy, or not connected).
 * `after` applies at once; `accepted` only once the server takes the action,
 * so a refused play leaves the player where they were (the hand still open).
 */
function send(action: Action, after?: Partial<InteractionState>, accepted?: Partial<InteractionState>): number {
  if (get().busy) return 0;
  const view = useGameStore.getState().view;
  const id = session.send(action, view ? soundsOf(action, view) : []);
  if (id === 0) { refuse(); return 0; }
  onAccept = accepted ? { id, patch: accepted } : null;
  onRefuse = null;
  set({ busy: true, ...after });
  return id;
}

/**
 * The card a play from the hand surely puts on the board, worked out the way
 * the server does (engine.actSummon), so it can fly in at once instead of a
 * round trip later. Only the plain case: one card onto an empty square, with
 * room on the field. Fusions, power-ups and plays onto a card depend on the
 * recipes, and are left to the server. Null when unsure.
 */
function predictSummon(ctx: Ctx, cardIds: number[], target: Pos): Omit<Prediction, 'actionId'> | null {
  const { view, seat: me } = ctx;
  const seat = view.seats[me];
  const hand = cardIds.length === 1 ? ctx.hand.find((c) => c.id === cardIds[0]) : undefined;
  const def = hand && catalogCard(hand.num);
  if (!seat || !hand || !def || cardAt(view, target) || view.maxMonsters === undefined || view.maxSpells === undefined) return null;
  // A strong monster is crushed on arrival: let the server show that.
  if (terrainAt(view, target.x, target.y) === 'crush') return null;
  const monster = def.kind === 'monster';
  const cost = monster ? def.level ?? 0 : 0;
  if (!useGameStore.getState().sandbox?.unlimited) {
    if (seat.playsLeft <= 0 || cost > seat.stars) return null;
    const team = view.seats.filter((s) => s.team === seat.team).map((s) => s.index);
    const counted = view.cards.filter((c) => (monster ? team.includes(c.owner) : c.owner === me) && !c.borrowed);
    // A teammate's card hidden from us could be either kind: leave the count to the server.
    if (counted.some((c) => !catalogCard(c.num))) return null;
    const onField = counted.filter((c) => (catalogCard(c.num)?.kind === 'monster') === monster).length;
    if (onField >= (monster ? view.maxMonsters * team.length : view.maxSpells)) return null;
  }
  return {
    seat: me,
    cost,
    // Cards come out of the deck face down, in attack position (engine.drawCard).
    card: { id: hand.id, num: hand.num, owner: me, x: target.x, y: target.y, faceDown: true, defense: false, acted: false, atk: def.atk ?? 0, def: def.def ?? 0 },
  };
}

/** Why the play of a single hand card is surely refused, or null when only the server can tell. */
function handCardRefusal(ctx: Ctx, card: HandCardView, picked: number[]): string | null {
  // A sandbox in free play has no costs or play limit.
  if (useGameStore.getState().sandbox?.unlimited) return null;
  const seat = ctx.view.seats[ctx.seat];
  if (!seat?.playsLeft) return 'You have already played a card this turn';
  // A chain's cost depends on its fusions: the server works that out.
  if (picked.some((id) => id !== card.id)) return null;
  const def = catalogCard(card.num);
  // The hand shows such a card greyed out ("needs ★n").
  if (def?.kind === 'monster' && (def.level ?? 0) > seat.stars) return `Not enough summoning stars: ${def.name} needs ★${def.level}`;
  return null;
}

function moveCursor(action: InputAction, ctx: Ctx) {
  const half = Math.floor(ctx.view.size / 2);
  const d = step(action, ctx.facing);
  const { cursor } = get();
  const next = { x: Math.max(-half, Math.min(half, cursor.x + d.x)), y: Math.max(-half, Math.min(half, cursor.y + d.y)) };
  if (!same(next, cursor)) set({ cursor: next });
}

/** Picks up whatever of ours is on a square. Returns false if nothing was. */
function pickUp(p: Pos, ctx: Ctx): boolean {
  if (!ctx.myTurn) return false;
  const card = cardAt(ctx.view, p);
  if (card && card.owner === ctx.seat) {
    if (card.acted || card.spellbound) { refuse(); return true; }
    playSfx('select', 0.4);
    set({ mode: { kind: 'card', cardId: card.id, flip: false, switchPosition: false }, cursor: p });
    return true;
  }
  const leader = leaderOf(ctx.view, ctx.seat);
  if (leader && same(leader, p)) {
    playSfx('select', 0.4);
    set({ mode: { kind: 'leader' }, cursor: p });
    return true;
  }
  return false;
}

/**
 * For an administrator who sees every hand: a tap on a deck leader picks
 * whose hand the hand view shows. Returns false when p is not a leader.
 */
function pickHandSeat(p: Pos, ctx: Ctx): boolean {
  if (ctx.seat >= 0 || !ctx.view.reveal) return false;
  const leader = leaderAt(ctx.view, p);
  if (!leader) return false;
  playSfx('select', 0.4);
  set({ handSeat: leader.index });
  return true;
}

/** Opens the hand, either to play into `target` or (with null) just to look at it. */
function showHand(ctx: Ctx, target: Pos | null) {
  if (ctx.hand.length === 0) { refuse(); return; }
  playSfx('select', 0.4);
  set((s) => ({ mode: { kind: 'hand', picked: [], target }, handIndex: Math.min(s.handIndex, ctx.hand.length - 1) }));
}

/** A seat's graveyard, newest first: the order it is shown in. */
export const graveyardOf = (view: GameView, seat: number): number[] => [...(view.seats[seat]?.graveyard ?? [])].reverse();

function openGraveyard(ctx: Ctx, seat = ctx.perspective) {
  if (!ctx.view.seats[seat]) { refuse(); return; }
  playSfx('select', 0.4);
  set({ mode: { kind: 'grave', seat, index: 0 } });
}

/** Steps to the next (or previous) seat's graveyard. */
function otherGraveyard(ctx: Ctx, mode: Extract<Mode, { kind: 'grave'; }>, direction: 1 | -1) {
  const count = ctx.view.seats.length;
  playSfx('blip', 0.25);
  set({ mode: { kind: 'grave', seat: (mode.seat + direction + count) % count, index: 0 } });
}

const canSummon = (ctx: Ctx) => ctx.myTurn && ctx.hand.length > 0 && (ctx.view.legal?.summon.length ?? 0) > 0;

/**
 * Starts a summon: first the square, then the card. When there is nothing to
 * summon (not our turn, or no play left) the hand just opens to be looked at.
 */
function startSummon(ctx: Ctx, at?: Pos) {
  if (!canSummon(ctx)) { showHand(ctx, null); return; }
  const tiles = ctx.view.legal?.summon ?? [];
  // Start on the given square if it is legal, else the one in front of the leader, towards the board's centre.
  // An ally's monster (which only takes power-ups) is never the default.
  const allys = (p: Pos) => ctx.view.cards.some((c) => same(c, p) && c.owner !== ctx.seat) ? 1 : 0;
  const start = at && tiles.some((p) => same(p, at)) ? at
    : [...tiles].sort((a, b) => allys(a) - allys(b) || (Math.abs(a.x) + Math.abs(a.y)) - (Math.abs(b.x) + Math.abs(b.y)))[0];
  playSfx('select', 0.4);
  set({ mode: { kind: 'place' }, cursor: start });
}

/** Jumps the cursor to the next of our pieces that can still act. */
function cycle(direction: 1 | -1, ctx: Ctx) {
  const stops: Pos[] = ctx.view.cards
    .filter((c) => c.owner === ctx.seat && !c.acted && !c.spellbound)
    .map((c) => ({ x: c.x, y: c.y }));
  const leader = leaderOf(ctx.view, ctx.seat);
  if (leader) stops.push(leader);
  if (stops.length === 0) return;
  const { cursor } = get();
  const at = stops.findIndex((p) => same(p, cursor));
  const next = stops[(at + direction + stops.length) % stops.length];
  playSfx('blip', 0.3);
  set({ cursor: next });
}

/**
 * Flip or Position on a picked-up card: stage (or unstage) the change. Nothing
 * is sent until the card is confirmed, so the player can change their mind.
 */
function stageOrder(card: CardView, action: 'FLIP' | 'POSITION', mode: Extract<Mode, { kind: 'card'; }>) {
  const def = catalogCard(card.num);
  if (action === 'POSITION') {
    if (def?.kind !== 'monster') { refuse(); return; }
    playSfx('flip', 0.5);
    set({ mode: { ...mode, switchPosition: !mode.switchPosition } });
    return;
  }
  // Traps spring on their own; face-up cards have nothing to flip.
  if (!card.faceDown || def?.kind === 'trap') { refuse(); return; }
  playSfx('flip', 0.5);
  set({ mode: { ...mode, flip: !mode.flip } });
}

/** Confirm on the picked-up card itself: send what was staged, or put it down. */
function commitStaged(card: CardView, mode: Extract<Mode, { kind: 'card'; }>) {
  const monster = catalogCard(card.num)?.kind === 'monster';
  // Going face up or into attack leaves a monster free to move: keep it picked up.
  const free = monster && !(mode.switchPosition && !card.defense);
  const after = { mode: (free ? { kind: 'card', cardId: card.id, flip: false, switchPosition: false } : { kind: 'browse' }) as Mode };
  if (mode.switchPosition) send({ type: 'position', cardId: card.id, defense: !card.defense, flip: mode.flip || undefined }, after);
  else if (mode.flip) send({ type: 'flip', cardId: card.id }, after);
  else set({ mode: { kind: 'browse' } });
}

function dispatch(action: InputAction, device: InputDevice) {
  const { mode, preview, tilePreview } = get();
  handle(action, device);
  // Cancel only sounds when it backed out of something; in plain browsing there is nothing to cancel.
  const after = get();
  if (action === 'CANCEL' && (after.mode !== mode || after.preview !== preview || after.tilePreview !== tilePreview)) backOut();
}

function handle(action: InputAction, device: InputDevice) {
  // The arena display only shows the board: the players play from their phones.
  if (useGameStore.getState().display) return;
  if (get().device !== device) set({ device });
  const ctx = context();
  if (!ctx || ctx.view.phase !== 'playing') return;
  // Nothing is played while the duel is paused (see PausedOverlay).
  if (useGameStore.getState().room?.paused) return;
  const state = get();
  const { mode, cursor } = state;

  // The card and tile previews swallow input while open; Details or Cancel closes them.
  if (state.preview || state.tilePreview) {
    if (action === 'DETAILS' || action === 'CANCEL') set({ preview: null, tilePreview: null });
    return;
  }
  if (action === 'DETAILS') {
    // Details on a card opens the 3D preview; on empty ground it toggles the terrain note.
    // Choosing a monster to revive: inspect the one highlighted.
    if (ctx.choosing) {
      const option = ctx.view.pending?.options?.[state.choiceIndex];
      if (option?.num !== undefined) set({ preview: { num: option.num } });
      else refuse();
      return;
    }
    if (mode.kind === 'grave') {
      const num = graveyardOf(ctx.view, mode.seat)[mode.index];
      if (num !== undefined) set({ preview: { num } });
      else refuse();
      return;
    }
    if (mode.kind === 'hand') {
      const current = ctx.hand[state.handIndex];
      if (current) set({ preview: { num: current.num } });
      else refuse();
      return;
    }
    // On the board: the card (or deck leader) under the cursor, else the ground itself.
    if (!inspectCardAt(ctx.view, cursor)) set({ tilePreview: { ...cursor } });
    return;
  }

  // A decision the server is waiting on comes before everything else.
  if (ctx.choosing) {
    const options = ctx.view.pending?.options ?? [];
    if (action === 'UP' || action === 'LEFT') set({ choiceIndex: (state.choiceIndex - 1 + options.length) % options.length });
    else if (action === 'DOWN' || action === 'RIGHT') set({ choiceIndex: (state.choiceIndex + 1) % options.length });
    else if (action === 'CONFIRM') send({ type: 'choose', choice: state.choiceIndex });
    return;
  }

  // Ending the turn works from anywhere too: whatever was half-done is dropped.
  if (action === 'END_TURN') {
    // Its sound plays at once (see soundsOf), not when the server confirms.
    if (!ctx.myTurn || !send({ type: 'endTurn' }, { mode: { kind: 'browse' } })) refuse();
    return;
  }

  // The graveyard opens and closes from anywhere.
  if (action === 'GRAVE') {
    if (mode.kind === 'grave') { set({ mode: { kind: 'browse' } }); backOut(); }
    else openGraveyard(ctx);
    return;
  }

  switch (mode.kind) {
    case 'browse': {
      if (isDirection(action)) { moveCursor(action, ctx); return; }
      const card = cardAt(ctx.view, cursor);
      const mine = card && card.owner === ctx.seat && ctx.myTurn;
      switch (action) {
        case 'CONFIRM': if (!pickUp(cursor, ctx) && !pickHandSeat(cursor, ctx)) refuse(); return;
        case 'HAND': startSummon(ctx); return;
        case 'NEXT': cycle(1, ctx); return;
        case 'PREV': cycle(-1, ctx); return;
        case 'FLIP': case 'POSITION': {
          // Picks the card up with the change staged; Confirm on it commits.
          if (!card || !mine || !pickUp(cursor, ctx)) { refuse(); return; }
          const picked = get().mode;
          if (picked.kind === 'card') stageOrder(card, action, picked);
          return;
        }
      }
      return;
    }

    case 'card': {
      const card = ctx.view.cards.find((c) => c.id === mode.cardId);
      if (!card) { set({ mode: { kind: 'browse' } }); return; }
      if (isDirection(action)) { moveCursor(action, ctx); return; }
      switch (action) {
        case 'CONFIRM':
          if (same(cursor, card)) {
            commitStaged(card, mode);
          } else if (!stagedDefense(ctx.view, mode) && moveTargets(ctx.view, card.id, mode.flip).some((p) => same(p, cursor))) {
            // A staged switch into defense keeps the card where it is; into attack it moves with it.
            const attack = mode.switchPosition && card.defense;
            send({ type: 'move', cardId: card.id, x: cursor.x, y: cursor.y, flip: mode.flip || undefined, attack: attack || undefined }, { mode: { kind: 'browse' } });
          } else if (!pickUp(cursor, ctx)) {
            refuse();
          }
          return;
        case 'FLIP': case 'POSITION': stageOrder(card, action, mode); return;
        case 'CANCEL': set({ mode: { kind: 'browse' }, cursor: { x: card.x, y: card.y } }); return;
        case 'HAND': startSummon(ctx); return;
      }
      return;
    }

    case 'leader': {
      const leader = leaderOf(ctx.view, ctx.seat);
      if (!leader) { set({ mode: { kind: 'browse' } }); return; }
      if (isDirection(action)) { moveCursor(action, ctx); return; }
      switch (action) {
        case 'CONFIRM':
          if (same(cursor, leader)) startSummon(ctx);
          else if (ctx.view.legal?.leader.some((p) => same(p, cursor))) {
            // Stepping onto one of our own cards eats it: make sure that was meant.
            const meal = cardAt(ctx.view, cursor);
            if (meal && !confirm(`Your deck leader will eat (destroy) your own ${cardName(meal.num)}. Continue?`)) return;
            send({ type: 'leader', x: cursor.x, y: cursor.y }, { mode: { kind: 'browse' } });
          }
          else if (!pickUp(cursor, ctx)) refuse();
          return;
        case 'HAND': startSummon(ctx); return;
        case 'CANCEL': set({ mode: { kind: 'browse' }, cursor: leader }); return;
      }
      return;
    }

    case 'hand': {
      const hand = ctx.hand;
      const current = hand[state.handIndex];
      switch (action) {
        case 'LEFT': set({ handIndex: (state.handIndex - 1 + hand.length) % hand.length }); playSfx('blip', 0.25); return;
        case 'RIGHT': set({ handIndex: (state.handIndex + 1) % hand.length }); playSfx('blip', 0.25); return;
        case 'UP': case 'FLIP':
          // Mark several cards to fuse them as they are played, in the order marked.
          if (!current || !mode.target) { refuse(); return; }
          playSfx('blip', 0.35);
          set({ mode: { ...mode, picked: mode.picked.includes(current.id) ? mode.picked.filter((id) => id !== current.id) : [...mode.picked, current.id] } });
          return;
        // Cards are not discarded from the hand: the Position key does nothing here.
        case 'POSITION': refuse(); return;
        case 'CONFIRM': {
          const target = mode.target;
          if (!current || !target || !ctx.myTurn || !ctx.view.legal?.summon.some((p) => same(p, target))) { refuse(); return; }
          // A card that surely cannot be played (greyed out) is refused here, and the hand stays open.
          const why = handCardRefusal(ctx, current, mode.picked);
          if (why) { useGameStore.getState().pushLog(why, 'bad'); refuse(); return; }
          const cardIds = mode.picked.includes(current.id) ? mode.picked : [...mode.picked, current.id];
          // The hand closes once the server takes the play; a refusal (a power-up the
          // monster cannot use, say) plays "you can't" and leaves it open.
          const action: Action = { type: 'summon', cardIds, x: target.x, y: target.y };
          const predicted = predictSummon(ctx, cardIds, target);
          if (predicted) {
            // Sure to land: the hand closes and the card flies in now. A refusal puts both back.
            const before = { mode, handIndex: state.handIndex };
            const id = send(action, { mode: { kind: 'browse' }, handIndex: 0 });
            if (id) {
              useGameStore.getState().predict({ actionId: id, ...predicted });
              onRefuse = { id, patch: before };
            }
            return;
          }
          send(action, undefined, { mode: { kind: 'browse' }, handIndex: 0 });
          return;
        }
        case 'CANCEL':
          // Back to choosing the square, or out of a hand that was only being looked at.
          if (mode.target && canSummon(ctx)) set({ mode: { kind: 'place' }, cursor: mode.target });
          else set({ mode: { kind: 'browse' } });
          return;
        case 'HAND': set({ mode: { kind: 'browse' } }); return;
      }
      return;
    }

    case 'grave': {
      const count = graveyardOf(ctx.view, mode.seat).length;
      switch (action) {
        case 'LEFT': case 'RIGHT':
          if (count === 0) return;
          set({ mode: { ...mode, index: (mode.index + (action === 'RIGHT' ? 1 : -1) + count) % count } });
          playSfx('blip', 0.25);
          return;
        case 'UP': case 'PREV': otherGraveyard(ctx, mode, -1); return;
        case 'DOWN': case 'NEXT': otherGraveyard(ctx, mode, 1); return;
        case 'CONFIRM': {
          const num = graveyardOf(ctx.view, mode.seat)[mode.index];
          if (num !== undefined) set({ preview: { num } });
          else refuse();
          return;
        }
        case 'CANCEL': case 'HAND': set({ mode: { kind: 'browse' } }); return;
      }
      return;
    }

    case 'place': {
      if (isDirection(action)) { moveCursor(action, ctx); return; }
      switch (action) {
        case 'CONFIRM':
          if (ctx.view.legal?.summon.some((p) => same(p, cursor))) showHand(ctx, { ...cursor });
          else refuse();
          return;
        case 'CANCEL': case 'HAND': {
          const leader = leaderOf(ctx.view, ctx.seat);
          set({ mode: { kind: 'browse' }, ...(leader ? { cursor: leader } : {}) });
          return;
        }
      }
      return;
    }
  }
}

// --- pointer ---------------------------------------------------------------
// A click is "put the cursor here and confirm", so mouse and touch go through
// exactly the same rules as a controller.

export function pointTile(x: number, y: number) {
  const ctx = context();
  if (!ctx || ctx.choosing) return;
  let { mode } = get();
  set({ cursor: { x, y }, device: 'pointer' });
  // Tapping the board closes an open graveyard, and the tap counts as on the board.
  if (mode.kind === 'grave') { mode = { kind: 'browse' }; set({ mode }); backOut(); }
  if (mode.kind === 'hand') {
    // While summoning, tapping another legal square moves the summon there; anything else closes the hand.
    if (mode.target && ctx.view.legal?.summon.some((p) => p.x === x && p.y === y)) set({ mode: { ...mode, target: { x, y } } });
    else { set({ mode: { kind: 'browse' } }); backOut(); }
    return;
  }
  if (mode.kind === 'browse') { if (!pickUp({ x, y }, ctx)) pickHandSeat({ x, y }, ctx); return; }
  dispatch('CONFIRM', 'pointer');
}

export function pointHand(index: number) {
  const { handIndex, mode } = get();
  if (mode.kind !== 'hand') return;
  if (handIndex === index) dispatch('CONFIRM', 'pointer');
  else set({ handIndex: index, device: 'pointer' });
}

/** Highlights an option without choosing it (a first tap). */
export function selectChoice(index: number) {
  set({ choiceIndex: index, device: 'pointer' });
}

/** Opens a seat's graveyard (the counter on its HUD panel), or switches to it if one is open. */
export function pointGraveyard(seat: number) {
  const ctx = context();
  if (!ctx || ctx.choosing) return;
  const { mode } = get();
  if (mode.kind === 'grave' && mode.seat === seat) { set({ mode: { kind: 'browse' } }); backOut(); return; }
  set({ device: 'pointer' });
  openGraveyard(ctx, seat);
}

/** A tap on a graveyard card: highlight it, and a second tap inspects it. */
export function pointGraveCard(index: number) {
  const { mode } = get();
  if (mode.kind !== 'grave') return;
  if (mode.index === index) dispatch('DETAILS', 'pointer');
  else set({ mode: { ...mode, index }, device: 'pointer' });
}

export function pointChoice(index: number) {
  set({ choiceIndex: index });
  dispatch('CONFIRM', 'pointer');
}

/** The card portal: the 3D preview of whatever stands under the cursor. */
export function inspectCursorCard() {
  const view = useGameStore.getState().view;
  if (view) inspectCardAt(view, get().cursor);
}

/** The tile portal: the terrain under the cursor, full screen. */
export function inspectCursorTile() {
  if (useGameStore.getState().view) set({ tilePreview: { ...get().cursor } });
}

/** Opens the 3D preview of a seat's deck leader (from its portrait in the HUD). */
export function inspectLeader(seat: number) {
  const s = useGameStore.getState().view?.seats[seat];
  if (s && s.leaderNum >= 0) set({ preview: { num: s.leaderNum, note: `deck leader · ${s.lp} LP`, leader: true } });
}

export const closeTilePreview = () => { if (get().tilePreview) backOut(); set({ tilePreview: null }); };

export const press = (action: InputAction) => dispatch(action, 'pointer');

/** Commits the flip / position change staged on the picked-up card, wherever the cursor is. */
export function commitPicked() {
  const ctx = context();
  const { mode, busy, preview, tilePreview } = get();
  if (!ctx || mode.kind !== 'card' || busy || preview || tilePreview || ctx.choosing) return;
  const card = ctx.view.cards.find((c) => c.id === mode.cardId);
  if (!card) return;
  set({ device: 'pointer' });
  commitStaged(card, mode);
}

// --- the arena display -----------------------------------------------------

/**
 * What we have picked up and where it may go, for the arena display to light
 * up the way our own board would (see Highlights in GameBoard): a controller
 * shows no board, so the display is where the player sees their options.
 */
export function selectionOf(view: GameView, seat: number, mode: Mode): Selection {
  switch (mode.kind) {
    case 'card': {
      const card = view.cards.find((c) => c.id === mode.cardId);
      if (!card) break;
      return { kind: 'card', from: { x: card.x, y: card.y }, targets: stagedDefense(view, mode) ? [] : moveTargets(view, card.id, mode.flip) };
    }
    case 'leader': return { kind: 'leader', from: leaderOf(view, seat) ?? undefined, targets: view.legal?.leader ?? [] };
    case 'place': return { kind: 'place', from: leaderOf(view, seat) ?? undefined, targets: view.legal?.summon ?? [] };
    case 'hand': if (mode.target) return { kind: 'hand', targets: [mode.target] }; break;
  }
  return { kind: '', targets: [] };
}

let sentSelection = '';

/** Sends our selection to the display whenever it changes, if we are a controller. */
function shareSelection() {
  const game = useGameStore.getState();
  if (selectRole(game) !== 'controller' || !game.view) { sentSelection = ''; return; }
  const sel = selectionOf(game.view, game.seat, get().mode);
  const key = JSON.stringify(sel);
  if (key === sentSelection) return;
  sentSelection = key;
  session.selection(sel);
}

// --- keeping in step with the server ---------------------------------------

let lastPending = '';

/** After every server answer: clear `busy`, and drop a mode that no longer makes sense. */
function reconcile(answered: boolean) {
  const ctx = context();
  const state = get();
  // Only the answer to our own action ends the wait for it.
  const patch: Partial<InteractionState> = answered ? { busy: false } : {};

  if (!ctx || ctx.view.phase !== 'playing') {
    patch.mode = { kind: 'browse' };
  } else {
    const { mode } = state;
    const card = mode.kind === 'card' ? ctx.view.cards.find((c) => c.id === mode.cardId) : undefined;
    const stale =
      (mode.kind === 'card' && (!ctx.myTurn || !card || card.acted || card.owner !== ctx.seat)) ||
      (mode.kind === 'leader' && !ctx.myTurn) ||
      (mode.kind === 'place' && !canSummon(ctx)) ||
      (mode.kind === 'hand' && (ctx.hand.length === 0 || (!!mode.target && !canSummon(ctx))));
    if (stale) patch.mode = { kind: 'browse' };
    if (mode.kind === 'grave') {
      const count = graveyardOf(ctx.view, mode.seat).length;
      if (mode.index >= count) patch.mode = { ...mode, index: Math.max(0, count - 1) };
    }
    if (state.handIndex >= ctx.hand.length) patch.handIndex = Math.max(0, ctx.hand.length - 1);

    const pending = ctx.view.pending ? `${ctx.view.pending.kind}:${ctx.view.pending.options?.length}` : '';
    if (pending !== lastPending) { lastPending = pending; patch.choiceIndex = 0; }

    // The first state of a game: start with the cursor on our own leader.
    const half = Math.floor(ctx.view.size / 2);
    if (Math.abs(state.cursor.x) > half || Math.abs(state.cursor.y) > half) patch.cursor = leaderOf(ctx.view, ctx.seat) ?? { x: 0, y: 0 };
  }
  set(patch);
}

let wired = false;

/** Connects the input layer and the server's answers to this machine. Call once. */
export function startInteraction() {
  if (wired) return;
  wired = true;
  setInputHandler(dispatch);
  // Everyone in the room can see where we are pointing (see Room.cursor on the server).
  useInteraction.subscribe((state, previous) => {
    const game = useGameStore.getState();
    if (state.cursor !== previous.cursor && game.view && !game.display) session.cursor(state.cursor.x, state.cursor.y);
    if (state.mode !== previous.mode) shareSelection();
  });
  // A new state can change where the picked-up piece may go; a display that
  // just joined needs telling too.
  useGameStore.subscribe((game, previous) => {
    if (game.view !== previous.view || game.room?.display !== previous.room?.display) {
      if (game.room?.display && !previous.room?.display) sentSelection = '';
      shareSelection();
    }
  });
  session.onAnswer((id, error) => {
    if (onAccept && (id === onAccept.id || (error && id === undefined))) {
      if (!error) set(onAccept.patch);
      onAccept = null;
    }
    if (onRefuse && (id === onRefuse.id || (error && id === undefined))) {
      if (error) {
        useGameStore.getState().dropPrediction();
        set(onRefuse.patch);
      }
      onRefuse = null;
    }
    reconcile(id !== undefined || !!error);
  });
  // Put the cursor on our leader when a game begins.
  let startedFor = '';
  useGameStore.subscribe((game) => {
    const key = game.view ? `${game.room?.id}:${game.seat}:${game.watch}` : '';
    if (key && key !== startedFor && game.view) {
      startedFor = key;
      set({ mode: { kind: 'browse' }, cursor: leaderOf(game.view, game.seat >= 0 ? game.seat : game.watch) ?? { x: 0, y: 0 }, busy: false, handSeat: -1 });
    } else if (!key) {
      startedFor = '';
    }
  });
}

// Input is wired to this module's dispatch once, at startup. A hot swap would
// leave the keyboard driving the old copy while the board reads the new one,
// so an edit here reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
