/**
 * Error reports sent to the game server (POST /api/client-errors, see
 * reports/reports.go) so problems players hit can be looked into.
 *
 * A report says what went wrong, and what the client was doing when it did:
 * the screen, the connection, the duel as the server last sent it, the
 * player's input state, and a trail of recent events (breadcrumbs). Reports
 * never carry the session token; the server identifies the sender from the
 * Authorization header.
 */
import { DefaultLoadingManager } from 'three';
import { useGameStore } from '@/stores/gameStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useMenuStore } from '@/stores/menuStore';
import { useUIStore } from '@/stores/uiStore';
import { useInteraction } from '@/game/interaction';
import { SERVER_URL } from '@/const';
import type { GameEvent, GameView, PendingView, RoomInfo, SeatView } from './protocol';

export type ReportKind = 'exception' | 'unhandledrejection' | 'react' | 'websocket' | 'api' | 'asset' | 'webgl' | 'manual';

export type CrumbType = 'nav' | 'ws' | 'action' | 'answer' | 'api' | 'asset' | 'error' | 'lifecycle';

export interface Breadcrumb {
  /** Seconds since the page loaded. */
  t: number;
  type: CrumbType;
  message: string;
  data?: Record<string, unknown>;
}

/** Version 1 of the report. The server reads id, kind, message, stack, build and game.roomId; it stores the rest as sent. */
export interface ErrorReport {
  v: 1;
  /** Made by the client, so a report sent twice (a retry) is stored once. */
  id: string;
  /** When it happened, by the client's clock (ISO 8601). */
  at: string;
  kind: ReportKind;
  message: string;
  stack?: string;
  /** The React components that were rendering (kind 'react'). */
  componentStack?: string;
  /** Where a script error was thrown (kind 'exception'). */
  source?: { file?: string; line?: number; col?: number; };
  /** What the player wrote (kind 'manual'). */
  note?: string;
  build: { version: string; commit: string; mode: string; };
  page: {
    path: string;
    /** The menu screen showing, when not in a room. */
    screen: string;
    visible: boolean;
    online: boolean;
    /** Seconds since the page loaded. */
    uptime: number;
    /** Running as an installed app (PWA). */
    standalone: boolean;
  };
  device: {
    userAgent: string;
    platform: string;
    language: string;
    touch: boolean;
    cores?: number;
    memoryGB?: number;
    screen: { w: number; h: number; dpr: number; };
    viewport: { w: number; h: number; };
    /** The GPU WebGL reports. */
    gpu?: string;
    network?: { type?: string; rttMs?: number; downlinkMbps?: number; saveData?: boolean; };
    /** The game's low-power setting (fewer pixels drawn). */
    lowPower: boolean;
  };
  /** Who the client thinks is signed in. For reading only: the server trusts the token. */
  user?: { id: string; name: string; guest: boolean; admin?: boolean; };
  connection: { status: string; latencyMs: number | null; };
  /** Present while in a room. */
  game?: GameSnapshot;
  /** Oldest first, at most 50. */
  breadcrumbs: Breadcrumb[];
  extra?: Record<string, unknown>;
}

export interface GameSnapshot {
  roomId: string;
  room: Pick<RoomInfo, 'mode' | 'mapName' | 'size' | 'started' | 'finished' | 'paused' | 'lobby' | 'private' | 'spectators'> & {
    seats: { index: number; team: number; kind: string; name: string; connected: boolean; }[];
  } | null;
  /** Our seat, -1 for a spectator. */
  seat: number;
  watch: number;
  admin: boolean;
  tools: boolean;
  sandbox: boolean;
  /** Always present when a duel is on: the part of the view that matters most. */
  summary?: {
    phase: GameView['phase'];
    turn: number;
    turnCount: number;
    myTurn: boolean;
    /** Seconds left on the turn clock. */
    clock: number | null;
    seats: Omit<SeatView, 'graveyard'>[];
    pending?: PendingView;
    hand: number[];
    fieldCards: number;
    legalMoves: number | null;
  };
  /** The whole state as the server last sent it; left out when the report would be too big. */
  view?: GameView;
  /** The events of the last update. */
  lastEvents: GameEvent[];
  /** The last lines of the game log (chat left out). */
  log: string[];
  /** What the player was doing: the input mode, where the cursor was, the hand card picked. */
  input: { mode: unknown; cursor: { x: number; y: number; }; handIndex: number; busy: boolean; device: string; };
}

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

const ENDPOINT = `${SERVER_URL}/api/client-errors`;
/** Browsers cap a keepalive request's body at 64 KiB. */
const MAX_BYTES = 60_000;
const MAX_CRUMBS = 50;
/** Automatic reports per page load; a crash loop should not flood the server. */
const MAX_AUTO = 15;
const QUEUE_KEY = 'duelist-error-queue';

const loadedAt = performance.now();
const crumbs: Breadcrumb[] = [];
const recent = new Map<string, number>();
let autoSent = 0;
let gpu: string | undefined;
let installed = false;

const uptime = () => Math.round((performance.now() - loadedAt) / 100) / 10;

/** Notes something that happened, to show in the next report. */
export function crumb(type: CrumbType, message: string, data?: Record<string, unknown>) {
  crumbs.push({ t: uptime(), type, message: message.slice(0, 300), ...(data ? { data } : {}) });
  if (crumbs.length > MAX_CRUMBS) crumbs.shift();
}

/** Records the GPU name and watches for the WebGL context being lost. Call once the canvas is made. */
export function watchRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* some browsers hide it */ }
  canvas.addEventListener('webglcontextlost', () => reportError('webgl', 'WebGL context lost'));
  canvas.addEventListener('webglcontextrestored', () => crumb('lifecycle', 'WebGL context restored'));
}

/**
 * Sends a report. Automatic ones are deduplicated (the same message at most
 * every 30 seconds) and capped per page load; a 'manual' one always goes.
 */
export function reportError(kind: ReportKind, error: unknown, extra: Partial<Pick<ErrorReport, 'componentStack' | 'source' | 'note' | 'extra'>> = {}) {
  try {
    const { message, stack } = describe(error);
    if (kind !== 'manual') {
      if (ignored(message, stack)) return;
      const key = `${kind}:${message}`;
      const last = recent.get(key);
      const now = Date.now();
      if (last && now - last < 30_000) return;
      recent.set(key, now);
      if (++autoSent > MAX_AUTO) return;
    }
    const report = build(kind, message, stack, extra);
    crumb('error', `${kind}: ${message}`);
    void send(report);
  } catch {
    // Reporting must never be what breaks the page.
  }
}

/** A "report a problem" from the player, with what they wrote. */
export const reportProblem = (note: string) => reportError('manual', 'Player report', { note: note.slice(0, 2000) });

/** Catches what nothing else did: script errors, rejected promises, failed asset loads. Call once at start-up. */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportError('exception', event.error ?? event.message, { source: { file: event.filename, line: event.lineno, col: event.colno } });
  });
  window.addEventListener('unhandledrejection', (event) => reportError('unhandledrejection', event.reason));

  // Every three.js loader (textures, models) goes through the default manager.
  const previous = DefaultLoadingManager.onError;
  DefaultLoadingManager.onError = (url) => {
    previous?.(url);
    crumb('asset', `failed: ${url}`);
    reportError('asset', `Could not load ${url}`);
  };

  // A trail of what the player did, for the next report.
  useMenuStore.subscribe((state, prev) => { if (state.screen !== prev.screen) crumb('nav', `screen ${state.screen}`); });
  useGameStore.subscribe((state, prev) => {
    if (state.status !== prev.status) crumb('ws', `status ${state.status}`);
    if (state.room?.id !== prev.room?.id) crumb('nav', state.room ? `room ${state.room.id}` : 'left room');
    if (state.view && state.view.turnCount !== prev.view?.turnCount) crumb('lifecycle', `turn ${state.view.turnCount} (seat ${state.view.turn})`);
    if (state.view?.phase === 'finished' && prev.view?.phase !== 'finished') crumb('lifecycle', 'duel finished');
  });
  document.addEventListener('visibilitychange', () => crumb('lifecycle', document.visibilityState));
  window.addEventListener('online', () => { crumb('lifecycle', 'online'); void flushQueue(); });
  window.addEventListener('offline', () => crumb('lifecycle', 'offline'));

  void flushQueue();
}

// --- building the report ------------------------------------------------------

function describe(error: unknown): { message: string; stack?: string; } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`.slice(0, 1000), stack: error.stack?.slice(0, 8000) };
  if (typeof error === 'string') return { message: error.slice(0, 1000) };
  try { return { message: JSON.stringify(error).slice(0, 1000) }; } catch { return { message: String(error).slice(0, 1000) }; }
}

/** Noise that says nothing about the game: other origins' scripts, browser extensions, a benign layout warning. */
function ignored(message: string, stack?: string) {
  return message === 'Script error.' || message.includes('ResizeObserver loop')
    || /(chrome|moz|safari)-extension:\/\//.test(stack ?? '');
}

function build(kind: ReportKind, message: string, stack: string | undefined, extra: Partial<ErrorReport>): ErrorReport {
  const session = useSessionStore.getState();
  const game = useGameStore.getState();
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean; }; };
  const report: ErrorReport = {
    v: 1,
    id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    kind,
    message,
    ...(stack ? { stack } : {}),
    ...extra,
    build: { version: __APP_VERSION__, commit: __APP_COMMIT__, mode: import.meta.env.MODE },
    page: {
      path: location.pathname + location.search.replace(/token=[^&]*/g, 'token=…'),
      screen: useMenuStore.getState().screen,
      visible: document.visibilityState === 'visible',
      online: navigator.onLine,
      uptime: uptime(),
      standalone: matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean; }).standalone === true,
    },
    device: {
      userAgent: navigator.userAgent,
      platform: (navigator as { userAgentData?: { platform?: string; }; }).userAgentData?.platform ?? navigator.platform,
      language: navigator.language,
      touch: navigator.maxTouchPoints > 0,
      cores: navigator.hardwareConcurrency,
      memoryGB: nav.deviceMemory,
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
      viewport: { w: innerWidth, h: innerHeight },
      gpu,
      network: nav.connection && { type: nav.connection.effectiveType, rttMs: nav.connection.rtt, downlinkMbps: nav.connection.downlink, saveData: nav.connection.saveData },
      lowPower: useUIStore.getState().lowPower,
    },
    user: session.user ? { id: session.user.id, name: session.user.name, guest: session.user.guest, admin: session.user.admin } : undefined,
    connection: { status: game.status, latencyMs: game.latency },
    game: snapshot(),
    breadcrumbs: [...crumbs],
  };
  return fit(report);
}

function snapshot(): GameSnapshot | undefined {
  const s = useGameStore.getState();
  if (!s.room && !s.view) return undefined;
  const input = useInteraction.getState();
  const view = s.view;
  return {
    roomId: s.room?.id ?? '',
    room: s.room && {
      mode: s.room.mode, mapName: s.room.mapName, size: s.room.size, started: s.room.started, finished: s.room.finished,
      paused: s.room.paused, lobby: s.room.lobby, private: s.room.private, spectators: s.room.spectators,
      seats: s.room.seats.map(({ index, team, kind, name, connected }) => ({ index, team, kind, name, connected })),
    },
    seat: s.seat,
    watch: s.watch,
    admin: s.admin,
    tools: s.tools,
    sandbox: !!s.sandbox,
    summary: view ? {
      phase: view.phase,
      turn: view.turn,
      turnCount: view.turnCount,
      myTurn: view.phase === 'playing' && s.seat >= 0 && view.turn === s.seat,
      clock: s.deadline ? Math.round((s.deadline - Date.now()) / 1000) : null,
      seats: view.seats.map((seat) => { const { graveyard, ...rest } = seat; void graveyard; return rest; }),
      pending: view.pending,
      hand: view.hand.map((card) => card.num),
      fieldCards: view.cards.length,
      legalMoves: view.legal ? Object.values(view.legal.moves).reduce((n, moves) => n + moves.length, 0) : null,
    } : undefined,
    view: view ?? undefined,
    lastEvents: s.lastEvents.slice(-20),
    log: s.log.filter((entry) => entry.tone !== 'chat').slice(-15).map((entry) => entry.text),
    input: { mode: input.mode, cursor: input.cursor, handIndex: input.handIndex, busy: input.busy, device: input.device },
  };
}

const size = (report: ErrorReport) => new Blob([JSON.stringify(report)]).size;

/** Shrinks a report until it fits in a keepalive request: the bulkiest, least needed parts go first. */
function fit(report: ErrorReport): ErrorReport {
  if (size(report) <= MAX_BYTES) return report;
  if (report.game?.view) {
    report.game.view = { ...report.game.view, legal: undefined, reveal: undefined };
    if (size(report) <= MAX_BYTES) return report;
    delete report.game.view;
    if (size(report) <= MAX_BYTES) return report;
  }
  report.breadcrumbs = report.breadcrumbs.slice(-15);
  if (report.game) report.game.lastEvents = report.game.lastEvents.slice(-5);
  report.stack = report.stack?.slice(0, 2000);
  report.componentStack = report.componentStack?.slice(0, 2000);
  return report;
}

// --- sending ------------------------------------------------------------------

async function send(report: ErrorReport): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = useSessionStore.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    // keepalive: the report still goes out if the page is closing.
    const response = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(report), keepalive: true });
    // 4xx means the server will not take it, so sending it again won't help.
    if (response.status >= 500) queue(report);
  } catch {
    queue(report); // offline, or the server is down: try again later
  }
}

/** Keeps up to five reports that could not be sent, for the next time the page loads or goes online. */
function queue(report: ErrorReport) {
  try {
    const list: ErrorReport[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    list.push(report);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-5)));
  } catch { /* storage full or blocked */ }
}

async function flushQueue() {
  let list: ErrorReport[] = [];
  try {
    list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    localStorage.removeItem(QUEUE_KEY);
  } catch { return; }
  for (const report of list) await send(report);
}
