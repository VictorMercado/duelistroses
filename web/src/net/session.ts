import { selectRole, useGameStore } from '@/stores/gameStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useMenuStore } from '@/stores/menuStore';
import { cardName, catalogCard, ensureCatalog } from '@/game/catalog';
import { playSfx, playSfxBatch, preloadSfx, type Sfx } from '@/game/sfx';
import { readyCards } from '@/game/preload';

import { useFusionStore } from '@/stores/fusionStore';
import { showDestiny } from '@/stores/destinyStore';
import { showFlash, type FlashCard } from '@/stores/activationStore';
import { wsUrl } from './api';
import { crumb, reportError } from './errorReport';
import type { Action, AdminTool, GameEvent, LobbyMessage, Selection, ServerMessage } from './protocol';

/** How long a duel's first state may wait for its cards' art before it is shown anyway. */
const FIRST_STATE_WAIT_MS = 3000;

type Listener = (ackId: number | undefined, error?: string) => void;

const MAX_RECONNECTS = 6;

/** Spell effects that destroy every card of a kind on the field, not just some. */
export const BOARD_WIPES = new Set(['destroyAll', 'destroySpells']);

/**
 * The connection to a room. It sends intents, and feeds what the server
 * answers into the game store. There is no optimistic update and so nothing to
 * roll back: an action shows on the board when the server says it happened,
 * which on a healthy connection is a few milliseconds later.
 */
class Session {
  private ws: WebSocket | null = null;
  private room = '';
  /** A state has arrived on this connection (see FIRST_STATE_WAIT_MS). */
  private dealt = false;
  /** The states being applied, in order. */
  private states: Promise<unknown> = Promise.resolve();
  private watch: string | undefined;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorSent = 0;
  private wanted = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private listeners = new Set<Listener>();

  /** Called with the id of our action each time the server answers one. */
  onAnswer(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  constructor() {
    // A phone drops the socket while the tab sleeps or the network changes, and
    // the timed retries may run out meanwhile: try again as soon as it is back.
    if (typeof window !== 'undefined') {
      const wake = () => { if (document.visibilityState === 'visible') this.reconnect(); };
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', wake);
    }
  }

  /** The room we are in, or were in when the connection dropped. */
  get roomId() { return this.wanted ? this.room : ''; }

  /**
   * Tries the room again right away, after the connection dropped. The seat is
   * kept on the server for the whole duel, so this resumes the same game.
   */
  reconnect() {
    if (!this.wanted || this.ws) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.attempts = 0;
    this.open();
  }

  /**
   * Joins a room to play, or to watch it: through a player, a seat, a team, or
   * as an administrator (see wsUrl). 'display' joins as the room's arena
   * display: the board on a shared screen, while the players use their phones.
   */
  connect(room: string, watch?: string) {
    preloadSfx(); // ready before the first event of the duel
    this.disconnect();
    useMenuStore.getState().setNotice('');
    this.room = room;
    this.watch = watch;
    this.wanted = true;
    this.attempts = 0;
    this.open();
  }

  disconnect() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.pinger) clearInterval(this.pinger);
    this.retry = this.pinger = null;
    if (this.ws) {
      this.ws.onclose = this.ws.onmessage = this.ws.onopen = null;
      this.ws.close(1000);
      this.ws = null;
    }
    useGameStore.getState().reset();
    useFusionStore.getState().clear();
    this.predicted.clear();
  }

  /**
   * Sounds already played for actions still waiting on the server, by action
   * id. The server's answer to an action carries its id: those sounds are left
   * out of it, so they are not heard twice. A refusal just forgets them.
   */
  private predicted = new Map<number, Sfx[]>();

  /**
   * Sends an action; returns its id, or 0 when there is no connection.
   * `sounds` play at once, without waiting for the server to confirm the
   * action (see predicted).
   */
  send(action: Action, sounds: [Sfx, number?][] = []): number {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return 0;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ t: 'action', id, a: action }));
    crumb('action', `#${id} ${action.type}`, action as unknown as Record<string, unknown>);
    if (sounds.length) {
      playSfxBatch(sounds);
      this.predicted.set(id, sounds.map(([name]) => name));
      // Answers come back in order: anything older has been answered or lost.
      for (const old of this.predicted.keys()) if (old < id - 20) this.predicted.delete(old);
    }
    return id;
  }

  /** An administrator's test tool; returns its id, or 0 when there is no connection. */
  adminTool(tool: AdminTool): number {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return 0;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ t: 'admin', id, ...tool }));
    return id;
  }

  /** Ends a duel between computer players only (its host or an administrator): the room closes for everyone. */
  endBotsDuel() {
    this.ws?.send(JSON.stringify({ t: 'end' }));
  }

  /** Seat and team changes, and starting, while the room is a lobby. */
  lobby(message: LobbyMessage) {
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Tells the room where we are pointing. Sent at most every 60 ms, always
   * ending on the latest position, so a held direction does not flood the
   * socket and the last square is never lost.
   */
  cursor(x: number, y: number) {
    const flush = () => {
      this.cursorTimer = null;
      this.cursorSent = performance.now();
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'cursor', x, y }));
    };
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    const wait = 60 - (performance.now() - this.cursorSent);
    if (wait <= 0) flush();
    else this.cursorTimer = setTimeout(flush, wait);
  }

  /** Tells the arena display what we have picked up and where it may go (see Room.selection). */
  selection(sel: Selection) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'sel', ...sel }));
  }

  /**
   * Turns this connection into the room's arena display, in place (see
   * Room.becomeDisplay): reconnecting would give up the seat that entitles us
   * to it first. Reconnects after this come back as the display.
   */
  becomeDisplay() {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.watch = 'display';
    this.ws.send(JSON.stringify({ t: 'display' }));
    return true;
  }

  /** As the arena display: how it has turned the board, for the phones' d-pads (see Room.orient). */
  orient(quarters: number, seatControls: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'orient', num: quarters, on: seatControls }));
  }

  /** Whether we joined the room as its arena display. */
  get isDisplay() { return this.watch === 'display'; }

  chat(text: string) {
    this.ws?.send(JSON.stringify({ t: 'chat', text }));
  }

  /** A player silences, or allows, spectator chat for the room. */
  muteSpectators(on: boolean) {
    this.ws?.send(JSON.stringify({ t: 'mute', on }));
  }

  /** Pauses (or resumes) a duel against computer players. */
  pause(on: boolean) {
    this.ws?.send(JSON.stringify({ t: 'pause', on }));
  }

  rematch() {
    this.ws?.send(JSON.stringify({ t: 'rematch' }));
  }

  private open() {
    const { token, deckId } = useSessionStore.getState();
    const game = useGameStore.getState();
    if (!token) return;
    game.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');

    // Card names and art come from the catalog; load it alongside.
    ensureCatalog().catch((error: Error) => game.pushLog(error.message, 'bad'));

    this.dealt = false;
    const ws = new WebSocket(wsUrl(this.room, token, deckId, this.watch));
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      useGameStore.getState().setStatus('open');
      const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
      ping();
      this.pinger = setInterval(ping, 5000);
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try { message = JSON.parse(event.data as string); } catch { return; }
      this.handle(message);
    };

    ws.onclose = (event) => {
      crumb('ws', `closed ${event.code}${event.reason ? ` ${event.reason}` : ''}`, { attempts: this.attempts, wanted: this.wanted });
      if (this.pinger) clearInterval(this.pinger);
      this.ws = null;
      if (!this.wanted) return;
      const store = useGameStore.getState();
      // 4000 + an HTTP status: the server turned us away (see refuseWS in
      // api/api.go). Its reason was already logged; trying again won't help.
      // 4410: an administrator closed the room. There is nothing left to
      // show, so back to the menu, saying why.
      // 4409: we joined the same room from another screen, which took over.
      if (event.code === 4410 || event.code === 4409) {
        this.listeners.forEach((listener) => listener(undefined, event.reason || 'Room closed'));
        this.disconnect();
        useMenuStore.getState().setNotice(event.reason || (event.code === 4409 ? 'You joined this room from another screen.' : 'This room was closed.'));
        return;
      }
      if (event.code >= 4000 && event.code < 5000) {
        this.wanted = false;
        this.listeners.forEach((listener) => listener(undefined, event.reason || 'Refused by the server'));
        store.setStatus('closed');
        return;
      }
      // Any action still in flight will never be answered on this socket.
      this.listeners.forEach((listener) => listener(undefined, 'Connection lost'));
      if (this.attempts >= MAX_RECONNECTS) {
        store.setStatus('closed');
        store.pushLog('Could not reach the game server.', 'bad');
        reportError('websocket', `Gave up reconnecting to room ${this.room} after ${MAX_RECONNECTS} tries (last close ${event.code})`);
        return;
      }
      store.setStatus('reconnecting');
      // The seat is kept server side, so reconnecting resumes the same duel.
      this.retry = setTimeout(() => this.open(), 400 * 2 ** this.attempts++);
    };
  }

  private handle(message: ServerMessage) {
    const store = useGameStore.getState();
    switch (message.t) {
      case 'welcome':
        store.setRoom(message.room, message.you.seat, message.you.watch, !!message.you.admin, !!message.you.tools, message.you.sandbox ?? null, !!message.you.display);
        break;
      case 'room':
        store.setRoom(message.room);
        break;
      case 'state': {
        // The first state of a connection waits (briefly) for its cards' art,
        // so the opening hand can be played the moment the duel shows. States
        // are applied one after another, in the order they came.
        const first = !this.dealt;
        this.dealt = true;
        this.states = this.states
          .then(() => ensureCatalog().catch(() => { }))
          .then(() => (first ? readyCards([...message.state.hand, ...message.state.cards].map((c) => c.num), FIRST_STATE_WAIT_MS) : undefined))
          .then(() => {
          const events = message.events ?? [];
          // Queued before the state lands, so the card the chain became stays
          // hidden on the board until its animation has played.
          const chained = this.queueFusions(message.seq, events);
          // The sounds we played when sending the action this answers.
          const heard = new Set(message.id ? this.predicted.get(message.id) : []);
          if (message.id) this.predicted.delete(message.id);
          useGameStore.getState().applyState(message.state, events, message.deadline ?? 0, message.id);
          // A card just drawn: its art, ready before it is played.
          void readyCards(message.state.hand.map((c) => c.num), 0);
          const sounds: [Sfx, number?][] = [];
          for (const event of events) this.report(event, sounds, chained);
          this.announce(events, chained.size > 0);
          // The animation plays the merges' sounds as each one happens.
          const fresh = sounds.filter(([name]) => !heard.has(name));
          playSfxBatch(chained.size ? fresh.filter(([name]) => name !== 'bonk' && name !== 'powerup' && name !== 'cardIn') : fresh);
          this.listeners.forEach((listener) => listener(message.id));
        }).catch((error) => console.error('applying a state failed', error));
        break;
      }
      case 'error':
        crumb('answer', `#${message.id ?? '-'} refused: ${message.message}`);
        if (message.id) this.predicted.delete(message.id);
        store.pushLog(message.message, 'bad');
        playSfx('cant');
        this.listeners.forEach((listener) => listener(message.id, message.message));
        break;
      case 'thought':
        store.pushThought({ seat: message.seat, name: message.name, text: message.message, action: message.action ?? '' });
        break;
      case 'say':
        store.pushLog(`${this.seatName(message.seat)}: “${message.message}”`, 'say');
        break;
      case 'chat':
        store.pushLog(`${message.name}${message.spectator ? ' (spectator)' : ''}: ${message.message}`, 'chat');
        playSfx('blip', 0.2);
        break;
      case 'cursor':
        store.setCursor(message.cid, message.gone ? null : { name: message.name ?? '', seat: message.seat, x: message.x, y: message.y, spectator: !!message.spectator });
        break;
      case 'sel':
        store.setSelection(message.cid, { ...message.sel, seat: message.seat });
        break;
      case 'pong':
        store.setLatency(Math.round(performance.now() - message.ts));
        break;
    }
  }

  private seatName(seat: number) {
    return useGameStore.getState().room?.seats[seat]?.name || `Seat ${seat + 1}`;
  }

  /**
   * What an update set off, in one popup in the middle of the screen: the
   * cards whose effects went off, then every card that left the field or the
   * hand for the graveyard (or was banished), whatever the reason. A spell
   * already shown going off is not shown again for being used up, and the
   * cards our own fusions from the hand used up or knocked out are left out (we know). After a
   * fusion the popup waits for its animation, so it does not cover it.
   */
  private announce(events: GameEvent[], afterFusion: boolean) {
    const known = (e: GameEvent) => e.num != null && e.num >= 0;
    const activated: FlashCard[] = events.filter((e) => ACTIVATIONS.has(e.type) && known(e))
      .map((e) => ({ num: e.num!, seat: e.seat, who: this.seatName(e.seat) }));
    const unshown = [...activated];
    const gone: FlashCard[] = [];
    // Cards we played from our hand merging: we chose them, so we know where
    // they went. Merges made by moving a card on the board are still shown,
    // and the others at the table always get the popup.
    const me = useGameStore.getState().seat;
    const fromMyHand = events.some((e) => e.type === 'fusionChain' && e.seat === me);
    const ownMerge = (e: GameEvent) => fromMyHand && e.seat === me
      && (e.text === 'replaced' || e.text === 'fusion' || e.text === 'used');
    for (const e of events) {
      if (e.type !== 'destroyed' || !known(e) || NOT_TO_GRAVEYARD.has(e.text ?? '') || ownMerge(e)) continue;
      if (e.text === 'used') {
        const i = unshown.findIndex((c) => c.num === e.num && c.seat === e.seat);
        if (i >= 0) { unshown.splice(i, 1); continue; }
      }
      gone.push({ num: e.num!, seat: e.seat, who: this.seatName(e.seat), destroyed: true, label: goneLabel(e.text ?? '') });
    }
    const cards = [...activated, ...gone];
    if (!cards.length) return;
    if (!afterFusion || !useFusionStore.getState().queue.length) { showFlash(cards); return; }
    const stop = useFusionStore.subscribe((s) => {
      if (s.queue.length) return;
      stop();
      showFlash(cards);
    });
  }

  /**
   * Queues the fusion animation for each chain of cards played together, and
   * returns the seats whose chain is hidden from us (we see mystery cards).
   */
  private queueFusions(seq: number, events: GameEvent[]): Map<number, boolean> {
    const chained = new Map<number, boolean>();
    events.forEach((event, i) => {
      if (event.type !== 'fusionChain' || !event.steps?.length) return;
      const hidden = event.steps.some((step) => step.base < 0 || step.add < 0);
      chained.set(event.seat, hidden);
      const summon = events.slice(i + 1).find((e) => e.type === 'summon' && e.seat === event.seat);
      const store = useGameStore.getState();
      const perspective = store.seat >= 0 ? store.seat : store.watch;
      useFusionStore.getState().push({
        key: `${seq}:${i}`,
        seat: event.seat,
        steps: event.steps,
        resultId: summon?.cardId ?? -1,
        mine: event.seat === perspective,
      });
    });
    return chained;
  }

  /** Turns an event into a log line and a sound. chained: seats that played a fusion chain, true when hidden from us. */
  private report(event: GameEvent, sounds: [Sfx, number?][], chained = new Map<number, boolean>()) {
    const hidden = chained.get(event.seat) === true;
    const sound = (name: Sfx, volume?: number) => sounds.push([name, volume]);
    const store = useGameStore.getState();
    const who = this.seatName(event.seat);
    const mine = event.seat === store.seat;
    switch (event.type) {
      case 'turn':
        store.pushLog(`— ${who}'s turn —`);
        // A new turn means the last one ended; the duel's opening turn has no turn before it.
        if ((event.amount ?? 0) > 1) sound('endTurn');
        else if (mine) sound('select');
        // A controller has no board to watch: its phone says the turn has come round.
        if (mine && (event.amount ?? 0) > 1 && selectRole(store) === 'controller') sound('select');
        break;
      case 'summon':
        store.pushLog(event.text === 'ritual'
          ? `${who} performed a ritual and summoned ${cardName(event.num)}!`
          : `${who} played ${cardName(event.num)}${event.text ? ` (${event.text})` : ''}.`);
        sound('cardIn');
        break;
      case 'move': sound('move', 0.35); break;
      case 'attack':
        store.pushLog(`${who}'s ${cardName(event.num)} attacks${event.target === -1 ? ' directly' : ''} with ${event.amount} ATK.`);
        // A direct attack lands on the leader: the board shows the hit (see LeaderStrikes), this is its sound.
        if (event.target === -1) sound('lifeAttack');
        break;
      case 'damage':
        store.pushLog(`${who} loses ${event.amount} LP.`, mine ? 'bad' : 'good');
        // Battle damage is told by the attack itself; anything else is a card effect (Ookazi, Tremendous Fire...).
        if (event.text !== 'battle' && event.text !== 'direct attack') sound('lifeAttack');
        break;
      case 'heal': store.pushLog(`${who} recovers ${event.amount} LP.`, mine ? 'good' : 'info'); sound('lifePoints'); break;
      case 'destroyed':
        if (event.text === 'replaced') {
          // A fusion that did not take: the newer card knocks the older one into the graveyard.
          store.pushLog(hidden ? 'No fusion: a card was knocked into the graveyard.' : `No fusion: ${cardName(event.num)} was knocked into the graveyard.`);
          sound('bonk');
        } else if (event.text === 'returned') {
          store.pushLog(`${cardName(event.num)} was returned to the deck.`);
        } else if (event.text === 'absorbed') {
          store.pushLog(`${cardName(event.num)} was absorbed.`);
          sound('destroyed');
        } else if (event.text === 'shield') {
          store.pushLog(`${cardName(event.num)} was destroyed in place of the monster that absorbed it.`);
          sound('destroyed');
        } else if (event.text === 'battle' || event.text === 'trap' || event.text === 'spell' || event.text === 'crushed' || event.text === 'trampled' || event.text === 'blast' || event.text === 'ability' || event.text === 'banished') {
          store.pushLog(`${cardName(event.num)} was destroyed (${event.text}).`);
          sound('destroyed');
        }
        break;
      case 'flipBoost': store.pushLog(`${who}'s ${event.text ?? cardName(event.num)} is strengthened by the machines on the field (+${event.amount}).`, mine ? 'good' : 'info'); sound('powerup'); break;
      case 'ability': {
        const change = event.amount ? ` (${event.amount > 0 ? '+' : ''}${event.amount})` : '';
        store.pushLog(`${who}'s ${event.text ?? cardName(event.num)} uses its ability${change}.`, mine ? 'good' : 'info');
        sound('powerup');
        break;
      }
      case 'transform': store.pushLog(`A card turned into ${event.num == null ? 'something else' : event.text}!`); sound('powerup'); break;
      case 'peek': {
        if (!mine) { store.pushLog(`${who} is spying on the field.`); break; }
        const hands = store.view?.peek ?? [];
        if (event.text === 'hands') {
          for (const hand of hands) store.pushLog(`${this.seatName(hand.seat)}'s hand: ${hand.cards.map((num) => cardName(num)).join(', ') || 'empty'}.`, 'info');
        } else {
          store.pushLog('The class and type of every enemy card show this turn.', 'info');
        }
        break;
      }
      case 'blast': store.pushLog(`${who}'s ${event.text ?? cardName(event.num)} exploded, destroying every card around it!`, 'bad'); break;
      case 'fusion': store.pushLog(hidden ? `${who} fused two cards!` : `${who} fused into ${cardName(event.num)}!`, 'good'); sound('powerup'); break;
      case 'equip': store.pushLog(hidden ? `${who} powered up a monster (+${event.amount}).` : `${who} powered up a monster with ${cardName(event.num)} (+${event.amount}).`); sound('powerup'); break;
      case 'spell':
        store.pushLog(`${who} activated ${event.text}.`);
        // Spells that sweep the whole field (Dark Hole, Heavy Storm) get their own sound.
        sound(BOARD_WIPES.has(catalogCard(event.num ?? 0)?.effect?.op ?? '') ? 'cleanboard' : 'spell');
        break;
      case 'trap': store.pushLog(`${who}'s trap ${event.text} sprang!`, 'bad'); sound('trap'); break;
      case 'spellbound': sound('bind'); break;
      case 'terrain': sound('terrain'); break;
      case 'control': store.pushLog(`${who} took control of a card.`); break;
      case 'eliminated': store.pushLog(`${who} is out: ${event.text}.`, 'bad'); break;
      case 'concede': store.pushLog(`${who} conceded.`); break;
      case 'destinyDraw': {
        // The event never names the card; our own hand says what it is.
        const num = mine ? store.view?.hand.find((c) => c.id === event.cardId)?.num : undefined;
        store.pushLog(mine && num != null ? `Destiny Draw! ${cardName(num)} joins your hand.` : `${who} got a Destiny Draw!`, mine ? 'good' : 'bad');
        showDestiny(who, mine, num);
        sound('powerup');
        break;
      }
      case 'rankUp': store.pushLog(`${who}'s deck leader rose to rank ${event.amount}.`, mine ? 'good' : 'info'); break;
      case 'leaderWin': store.pushLog(`${event.text} is unleashed! ${who} wins.`, mine ? 'good' : 'bad'); break;
      case 'adminTool': store.pushLog(`🛠 ${who} ${event.text ?? 'used the test tools'}.`, 'say'); break;
    }
  }
}

/** Events that mean a card's effect went off. */
const ACTIVATIONS = new Set(['spell', 'trap', 'ability', 'flipBoost', 'blast']);
/** Reasons a destroyed event gives when the card did not go to a graveyard: back to the deck, or into a monster. */
const NOT_TO_GRAVEYARD = new Set(['returned', 'absorbed']);
/** Reasons that mean a card was destroyed (by battle, an effect, being trampled or eaten); the rest just went to the graveyard. */
const DESTROYING = new Set(['battle', 'spell', 'trap', 'ability', 'blast', 'crushed', 'negated', 'trampled', 'eaten', 'shield']);
const goneLabel = (reason: string) => (reason === 'banished' ? 'BANISHED' : DESTROYING.has(reason) ? 'DESTROYED' : 'TO GRAVEYARD');

export const session = new Session();

// The live socket belongs to this module's single session: reload on edit
// rather than hot swap, which would leave a second, disconnected copy.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
