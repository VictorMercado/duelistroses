import { create } from 'zustand';
import { allCards, catalogCard } from '@/game/catalog';
import { useInteraction } from '@/game/interaction';
import { CROSS_STRIKES, VOIDS, session } from '@/net/session';
import { useGameStore } from '@/stores/gameStore';
import { useFusionStore } from '@/stores/fusionStore';
import type { CardView, ChainStep, GameEvent, GameView } from '@/net/protocol';
import type { CatalogCard } from '@/net/api';

/*
 * The sandbox's animation tester. Every animation the board plays is set off
 * by events from the server (see session.handle), so each preview here makes
 * up the events (and, where the animation needs it, a board to go with them),
 * plays them through the same path a real update takes, then puts back the
 * board the server last sent. Nothing is sent to the server: the duel itself
 * never changes.
 */

type Pos = { x: number; y: number; };
/** One beat of a preview: a board (or the real one) with events, then a wait before the next. */
interface Beat { view?: GameView; events?: GameEvent[]; wait: number; }

export interface PreviewContext {
  /** The board the server last sent. */
  view: GameView;
  /** The seat we play, and an opponent's. */
  me: number;
  foe: number;
  cursor: Pos;
  /** The card under the board cursor, if any. */
  target?: CardView;
}

export interface AnimationPreview {
  id: string;
  label: string;
  /** What it is, and when the game plays it. */
  note: string;
  /** It plays on the card under the cursor (and cannot run without one). */
  needsTarget?: boolean;
  beats: (ctx: PreviewContext) => Beat[];
}

// --- made-up cards and boards ------------------------------------------------

let fakeId = 900000;
const nextId = () => ++fakeId;

const pick = (test: (c: CatalogCard) => boolean, fallback = 1) =>
  allCards().find((c) => c.implemented !== false && !c.locked && test(c))?.num ?? fallback;
const sampleMonster = () => pick((c) => c.kind === 'monster' && (c.atk ?? 0) >= 1800 && c.frame !== 'fusion');
const otherMonster = (not: number) => pick((c) => c.kind === 'monster' && c.num !== not && (c.atk ?? 0) >= 1000 && c.frame !== 'fusion');
const sampleFusion = () => pick((c) => c.kind === 'monster' && c.frame === 'fusion', sampleMonster());
const sampleSpell = () => pick((c) => c.kind === 'spell' && !!c.effect && !CROSS_STRIKES.has(c.effect.op) && !VOIDS.has(c.effect.op) && c.effect.op !== 'equip');
const sampleTrap = () => pick((c) => c.kind === 'trap');
const sampleEquip = () => pick((c) => c.effect?.op === 'equip', sampleSpell());
const darkHole = () => pick((c) => VOIDS.has(c.effect?.op ?? ''));
const raigeki = () => (catalogCard(700) ? 700 : pick((c) => CROSS_STRIKES.has(c.effect?.op ?? '')));

const sampleRitual = () => pick((c) => c.kind === 'ritual', sampleSpell());
const sampleRitualMonster = () => pick((c) => c.kind === 'monster' && c.frame === 'ritual', sampleMonster());

/** Empty squares nearest p, leaders' squares left out. */
function emptyNear(view: GameView, p: Pos, count: number): Pos[] {
  const half = Math.floor(view.size / 2);
  const taken = new Set([...view.cards.map((c) => `${c.x},${c.y}`), ...view.seats.map((s) => `${s.leaderX},${s.leaderY}`), `${p.x},${p.y}`]);
  const free: Pos[] = [];
  for (let x = -half; x <= half; x++) for (let y = -half; y <= half; y++) if (!taken.has(`${x},${y}`)) free.push({ x, y });
  return free.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, count);
}

const isMonster = (num: number) => catalogCard(num)?.kind === 'monster' || catalogCard(num)?.kind === 'ritual';
/** The card under the cursor if it is a known monster, else a stand-in. */
const monsterNum = (ctx: PreviewContext) => (ctx.target && ctx.target.num >= 0 && isMonster(ctx.target.num) ? ctx.target.num : sampleMonster());

function fakeCard(num: number, owner: number, p: Pos, faceDown = false): CardView {
  const def = catalogCard(num);
  return { id: nextId(), num, owner, x: p.x, y: p.y, faceDown, defense: false, acted: false, atk: def?.atk ?? 0, def: def?.def ?? 0 };
}
const without = (view: GameView, ...ids: (number | undefined)[]): GameView =>
  ({ ...view, cards: view.cards.filter((c) => !ids.includes(c.id)) });
const withCard = (view: GameView, card: CardView): GameView =>
  ({ ...view, cards: [...view.cards.filter((c) => !(c.x === card.x && c.y === card.y)), card] });
const changed = (view: GameView, id: number, patch: Partial<CardView>): GameView =>
  ({ ...view, cards: view.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
const leaderOf = (view: GameView, seat: number): Pos => ({ x: view.seats[seat]?.leaderX ?? 0, y: view.seats[seat]?.leaderY ?? 0 });
const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type' | 'seat'>): GameEvent => ({ x: 0, y: 0, ...e });
/** The server names the card in a spell or trap event (the log reads it). */
const named = (e: GameEvent): GameEvent => ({ ...e, text: catalogCard(e.num ?? -1)?.name });

/** A fusion chain played from the hand onto the cursor's square, as the server reports one. */
function chain(ctx: PreviewContext, steps: ChainStep[]): Beat[] {
  const result = steps[steps.length - 1].result;
  const card = fakeCard(result, ctx.me, ctx.cursor);
  return [{
    view: withCard(without(ctx.view, ctx.target?.id), card),
    events: [
      ev({ type: 'fusionChain', seat: ctx.me, steps }),
      ev({ type: 'summon', seat: ctx.me, cardId: card.id, num: result, x: card.x, y: card.y }),
    ],
    wait: 400,
  }];
}

// --- the previews --------------------------------------------------------------

export const ANIMATIONS: AnimationPreview[] = [
  {
    id: 'ritual', label: 'Ritual summoning',
    note: 'The field darkens and a magic circle opens; three tributes orbit the board\'s centre around the ritual card, collapse into it in a flash, and the ritual monster comes down onto the square.',
    beats: (ctx) => {
      const { view, me, cursor } = ctx;
      const spell = fakeCard(sampleRitual(), me, cursor);
      let tributeNum = sampleMonster();
      const tributes = emptyNear(view, cursor, 3).map((p) => {
        const card = fakeCard(tributeNum, me, p);
        tributeNum = otherMonster(tributeNum);
        return card;
      });
      const result = fakeCard(sampleRitualMonster(), me, cursor);
      const base = without(view, ctx.target?.id);
      const set = [spell, ...tributes].reduce(withCard, base);
      return [
        { view: set, wait: 700 },
        {
          view: withCard(base, result),
          events: [
            named(ev({ type: 'spell', seat: me, cardId: spell.id, num: spell.num, ...cursor })),
            ...tributes.map((c) => ev({ type: 'destroyed', seat: me, cardId: c.id, num: c.num, x: c.x, y: c.y, text: 'sacrificed' })),
            ev({ type: 'destroyed', seat: me, cardId: spell.id, num: spell.num, ...cursor, text: 'used' }),
            ev({ type: 'summon', seat: me, cardId: result.id, num: result.num, ...cursor, text: 'ritual' }),
          ],
          wait: 7000,
        },
      ];
    },
  },
  {
    id: 'exodia', label: 'Exodia: obliterate',
    note: 'The duel won by Exodia: the four limbs and the head rise off the field and assemble into the Forbidden One over the board, the seals break, and a beam obliterates every enemy deck leader. Plays at the start of the Exodia-led seat\'s turn with all four limbs face up on the field; the Game Over screen waits for it.',
    beats: (ctx) => {
      const { view, me } = ctx;
      const exodia = pick((c) => c.name.startsWith('Exodia'), 58);
      const limbs = allCards().filter((c) => c.name.includes('of the Forbidden One')).map((c) => c.num);
      const home = leaderOf(view, me);
      const set = emptyNear(view, home, limbs.length).map((p, i) => fakeCard(limbs[i], me, p)).reduce(withCard, view);
      const led = { ...set, seats: set.seats.map((s) => (s.index === me ? { ...s, leaderNum: exodia } : s)) };
      return [
        { view: led, wait: 700 },
        { view: led, events: [ev({ type: 'leaderWin', seat: me, num: exodia, ...home, text: catalogCard(exodia)?.name })], wait: 8800 },
      ];
    },
  },
  {
    id: 'crushed', label: 'Crushed by crush terrain',
    note: 'A monster steps onto crush terrain and is torn apart there. Uses the card under the cursor if there is one, stepping one square towards the middle; otherwise a stand-in steps in from the next square.',
    beats: (ctx) => {
      const half = Math.floor(ctx.view.size / 2);
      const t = ctx.target && ctx.target.num >= 0 && isMonster(ctx.target.num) ? ctx.target : fakeCard(sampleMonster(), ctx.me, ctx.cursor);
      // The card starts where it is; the crush square is one step on (or, for a stand-in, the cursor's square).
      const start = ctx.target ? t : { x: t.x, y: t.y + (t.y < half ? 1 : -1) };
      const to = ctx.target ? { x: t.x, y: t.y + (t.y > -half ? -1 : 1) } : ctx.cursor;
      const before = withCard(ctx.view, { ...t, x: start.x, y: start.y });
      return [
        { view: before, wait: 80 },
        {
          view: without(before, t.id),
          events: [
            ev({ type: 'move', seat: t.owner, cardId: t.id, num: t.num, ...to }),
            ev({ type: 'destroyed', seat: t.owner, cardId: t.id, num: t.num, ...to, text: 'crushed' }),
          ],
          wait: 3200,
        },
      ];
    },
  },
  {
    id: 'destroyed', label: 'Destroyed: torn apart',
    note: 'The card slams down, spins up, and rips apart pixel by pixel. Played for a card played onto a full field.',
    beats: (ctx) => {
      const num = ctx.target && ctx.target.num >= 0 ? ctx.target.num : sampleMonster();
      return [{
        view: without(ctx.view, ctx.target?.id),
        events: [ev({ type: 'destroyed', seat: ctx.target?.owner ?? ctx.me, cardId: ctx.target?.id, num, ...ctx.cursor, text: 'overflow' })],
        wait: 3200,
      }];
    },
  },
  {
    id: 'raigeki', label: 'Raigeki: lightning',
    note: 'Lightning strikes down every square of the row and column, outwards from the square. Monsters on those lines are struck and burn out; with none there, two stand-ins take the hits.',
    beats: (ctx) => {
      const { view, cursor, me } = ctx;
      const half = Math.floor(view.size / 2);
      const struck = view.cards.filter((c) => (c.x === cursor.x || c.y === cursor.y) && c.num >= 0 && isMonster(c.num));
      const events: GameEvent[] = [ev({ type: 'spell', seat: me, cardId: nextId(), num: raigeki(), ...cursor, text: 'Raigeki' })];
      if (struck.length) {
        for (const c of struck) events.push(ev({ type: 'destroyed', seat: c.owner, cardId: c.id, num: c.num, x: c.x, y: c.y, text: 'spell' }));
      } else {
        const along = [{ x: cursor.x, y: cursor.y + 2 > half ? cursor.y - 2 : cursor.y + 2 }, { x: cursor.x + 2 > half ? cursor.x - 2 : cursor.x + 2, y: cursor.y }];
        along.forEach((p, i) => events.push(ev({ type: 'destroyed', seat: ctx.foe, cardId: nextId(), num: i ? otherMonster(sampleMonster()) : sampleMonster(), ...p, text: 'spell' })));
      }
      return [{ view: without(view, ...struck.map((c) => c.id)), events, wait: 3000 }];
    },
  },
  {
    id: 'darkhole', label: 'Dark Hole: black hole',
    note: 'A black hole opens in the middle of the board; every card on the field is torn up, whirls round the centre and is swallowed, then the hole snaps shut in a shockwave. With the field empty, stand-ins are swallowed.',
    beats: (ctx) => {
      const { view, cursor, me } = ctx;
      const taken = view.cards.filter((c) => c.num >= 0 || c.faceDown);
      const events: GameEvent[] = [named(ev({ type: 'spell', seat: me, cardId: nextId(), num: darkHole(), ...cursor }))];
      if (taken.length) {
        for (const c of taken) events.push(ev({ type: 'destroyed', seat: c.owner, cardId: c.id, num: c.num, x: c.x, y: c.y, text: 'spell' }));
      } else {
        let num = sampleMonster();
        emptyNear(view, { x: 0, y: 0 }, 6).forEach((p, i) => {
          events.push(ev({ type: 'destroyed', seat: i % 2 ? ctx.foe : me, cardId: nextId(), num, ...p, text: 'spell' }));
          num = otherMonster(num);
        });
      }
      return [{ view: without(view, ...taken.map((c) => c.id)), events, wait: 3400 }];
    },
  },
  {
    id: 'spell', label: 'Spell activated',
    note: 'The card lifts, glows, turns to light and fades, with the activation popup.',
    beats: (ctx) => [{
      view: without(ctx.view, ctx.target?.id),
      events: [named(ev({ type: 'spell', seat: ctx.me, cardId: nextId(), num: ctx.target && catalogCard(ctx.target.num)?.kind === 'spell' ? ctx.target.num : sampleSpell(), ...ctx.cursor }))],
      wait: 2000,
    }],
  },
  {
    id: 'trap', label: 'Trap sprung',
    note: 'The same glow as a spell, in pink, with the activation popup.',
    beats: (ctx) => [{
      view: without(ctx.view, ctx.target?.id),
      events: [named(ev({ type: 'trap', seat: ctx.me, cardId: nextId(), num: ctx.target && catalogCard(ctx.target.num)?.kind === 'trap' ? ctx.target.num : sampleTrap(), ...ctx.cursor }))],
      wait: 2000,
    }],
  },
  {
    id: 'summon', label: 'Played from the hand',
    note: 'The card shows where the hand is, then flies to its square and turns onto its back.',
    beats: (ctx) => {
      const card = ctx.target ? { ...ctx.target, owner: ctx.me } : fakeCard(sampleMonster(), ctx.me, ctx.cursor, true);
      return [
        { view: without(ctx.view, card.id), wait: 60 },
        { view: withCard(ctx.view, card), events: [ev({ type: 'summon', seat: ctx.me, cardId: card.id, num: card.num, x: card.x, y: card.y })], wait: 1400 },
      ];
    },
  },
  {
    id: 'fusion', label: 'Fusion',
    note: 'Two cards orbit each other in front of the camera and become the fusion, which then lands on the square.',
    beats: (ctx) => {
      const a = monsterNum(ctx);
      return chain(ctx, [{ base: a, add: otherMonster(a), result: sampleFusion(), kind: 'fuse' }]);
    },
  },
  {
    id: 'bonk', label: 'Failed fusion (bonk)',
    note: 'Two cards that do not fuse: the newcomer knocks the held card away.',
    beats: (ctx) => {
      const a = monsterNum(ctx);
      const b = otherMonster(a);
      return chain(ctx, [{ base: a, add: b, result: b, kind: 'bonk' }]);
    },
  },
  {
    id: 'equip', label: 'Power-up (equip)',
    note: 'A power-up glows into its monster.',
    beats: (ctx) => {
      const a = monsterNum(ctx);
      return chain(ctx, [{ base: a, add: sampleEquip(), result: a, kind: 'equip', amount: 500 }]);
    },
  },
  {
    id: 'boardFusion', label: 'Fusion with a card on the field',
    note: 'A card from the hand fuses with one already standing on the board, which drops in from above.',
    beats: (ctx) => {
      const a = monsterNum(ctx);
      return chain(ctx, [{ base: a, add: otherMonster(a), result: sampleFusion(), kind: 'fuse', board: true }]);
    },
  },
  {
    id: 'chain', label: 'Chain of three',
    note: 'Fuse, then power up the result, then a card that will not fuse bonks it away.',
    beats: (ctx) => {
      const a = monsterNum(ctx);
      const fused = sampleFusion();
      const last = otherMonster(a);
      return chain(ctx, [
        { base: a, add: otherMonster(a), result: fused, kind: 'fuse' },
        { base: fused, add: sampleEquip(), result: fused, kind: 'equip', amount: 500 },
        { base: fused, add: last, result: last, kind: 'bonk' },
      ]);
    },
  },
  {
    id: 'direct', label: 'Direct attack',
    note: 'A streak from the monster to the enemy deck leader, which flashes red and shakes, and the LP lost rises off it.',
    beats: (ctx) => {
      const attacker = ctx.target && ctx.target.num >= 0 && isMonster(ctx.target.num) ? ctx.target : fakeCard(sampleMonster(), ctx.me, ctx.cursor);
      const leader = leaderOf(ctx.view, ctx.foe);
      return [{
        view: withCard(ctx.view, attacker),
        events: [
          ev({ type: 'attack', seat: attacker.owner, cardId: attacker.id, num: attacker.num, ...leader, target: -1, amount: attacker.atk }),
          ev({ type: 'damage', seat: ctx.foe, ...leader, amount: 1200, text: 'direct attack' }),
        ],
        wait: 2000,
      }];
    },
  },
  {
    id: 'blocked', label: 'Direct attack stopped',
    note: 'The streak and flash, but nothing gets through (a trap or an ability stopped it).',
    beats: (ctx) => {
      const attacker = ctx.target && ctx.target.num >= 0 && isMonster(ctx.target.num) ? ctx.target : fakeCard(sampleMonster(), ctx.me, ctx.cursor);
      const leader = leaderOf(ctx.view, ctx.foe);
      return [{ view: withCard(ctx.view, attacker), events: [ev({ type: 'attack', seat: attacker.owner, cardId: attacker.id, num: attacker.num, ...leader, target: -1, amount: attacker.atk })], wait: 1800 }];
    },
  },
  {
    id: 'burn', label: 'Burn damage',
    note: 'LP lost to an effect rather than an attack: the leader flashes and the number rises, with no streak.',
    beats: (ctx) => [{ events: [ev({ type: 'damage', seat: ctx.foe, ...leaderOf(ctx.view, ctx.foe), amount: 500, text: 'burn' })], wait: 1600 }],
  },
  {
    id: 'hurt', label: 'Your leader is hit',
    note: 'The same hit, on your own deck leader.',
    beats: (ctx) => [{ events: [ev({ type: 'damage', seat: ctx.me, ...leaderOf(ctx.view, ctx.me), amount: 800, text: 'battle' })], wait: 1600 }],
  },
  {
    id: 'flip', label: 'Flip face up / down',
    note: 'The card under the cursor turns over, and back.',
    needsTarget: true,
    beats: (ctx) => [
      { view: changed(ctx.view, ctx.target!.id, { faceDown: !ctx.target!.faceDown }), events: [ev({ type: 'flip', seat: ctx.target!.owner, cardId: ctx.target!.id, num: ctx.target!.num, ...ctx.cursor })], wait: 1100 },
    ],
  },
  {
    id: 'position', label: 'Attack / defense position',
    note: 'The card under the cursor turns sideways into defense, and back.',
    needsTarget: true,
    beats: (ctx) => [{ view: changed(ctx.view, ctx.target!.id, { defense: !ctx.target!.defense }), wait: 1100 }],
  },
  {
    id: 'move', label: 'Move',
    note: 'The card under the cursor glides one square towards the middle, and back.',
    needsTarget: true,
    beats: (ctx) => {
      const t = ctx.target!;
      const to = Math.abs(t.y) >= Math.abs(t.x) ? { x: t.x, y: t.y - Math.sign(t.y || 1) } : { x: t.x - Math.sign(t.x), y: t.y };
      return [{ view: changed(ctx.view, t.id, to), events: [ev({ type: 'move', seat: t.owner, cardId: t.id, num: t.num, ...to })], wait: 1000 }];
    },
  },
  {
    id: 'ability', label: 'Effect popup',
    note: 'The banner in the middle of the screen when a card’s ability goes off.',
    beats: (ctx) => [{ events: [ev({ type: 'ability', seat: ctx.me, num: monsterNum(ctx), ...ctx.cursor, amount: 300 })], wait: 2200 }],
  },
  {
    id: 'destiny', label: 'Destiny Draw',
    note: 'The Destiny Draw banner, with the card drawn.',
    beats: (ctx) => {
      const card = ctx.view.hand[0];
      return [{ events: [ev({ type: 'destinyDraw', seat: ctx.me, cardId: card?.id })], wait: 2600 }];
    },
  },
];

// --- playing them ----------------------------------------------------------------

/** Which preview is playing, for the menu. */
export const usePreviewStore = create<{ playing: string; }>(() => ({ playing: '' }));

let seq = 2_000_000_000;
let run = 0;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function context(): PreviewContext | null {
  const game = useGameStore.getState();
  const view = session.lastServed ?? game.serverView;
  if (!view) return null;
  const me = Math.max(0, game.seat);
  const myTeam = view.seats[me]?.team;
  const foe = view.seats.find((s) => s.team !== myTeam)?.index ?? (me === 0 ? 1 : 0);
  const cursor = useInteraction.getState().cursor;
  const target = view.cards.find((c) => c.x === cursor.x && c.y === cursor.y);
  return { view, me, foe, cursor, target };
}

/** Whether a preview can play now. */
export function canPreview(preview: AnimationPreview, ctx = context()) {
  return !!ctx && (!preview.needsTarget || !!ctx.target);
}

/** Plays one preview, then gives the board back to the server's last state. */
export function playPreview(preview: AnimationPreview) {
  allRun++; // a preview picked by hand ends "play all"
  return play(preview);
}

async function play(preview: AnimationPreview) {
  const ctx = context();
  if (!ctx || !canPreview(preview, ctx)) return;
  const mine = ++run;
  usePreviewStore.setState({ playing: preview.id });
  for (const beat of preview.beats(ctx)) {
    if (mine !== run) return;
    session.playback(seq++, beat.view ?? ctx.view, beat.events ?? []);
    await sleep(beat.wait);
  }
  // A fusion plays as long as it takes: let it finish first.
  while (useFusionStore.getState().queue.length && mine === run) await sleep(100);
  if (mine !== run) return;
  restore();
  usePreviewStore.setState({ playing: '' });
}

let allRun = 0;

/** Plays every preview, one after another. */
export async function playAll() {
  const mine = ++allRun;
  for (const preview of ANIMATIONS) {
    if (mine !== allRun) return;
    if (!canPreview(preview)) continue;
    await play(preview);
    await sleep(500);
  }
}

/** Stops whatever is playing and shows the real board. */
export function stopPreview() {
  run++;
  allRun++;
  restore();
  usePreviewStore.setState({ playing: '' });
}

function restore() {
  const real = session.lastServed ?? useGameStore.getState().serverView;
  if (real) session.playback(seq++, real, []);
}
