import { SERVER_URL } from '@/const';
import type { GameEvent, GameView, RoomInfo } from './protocol';
import { crumb, reportError } from './errorReport';

export const GAME_URL = SERVER_URL;

export interface User { id: string; name: string; guest: boolean; admin?: boolean; }

export interface CatalogCard {
  num: number;
  name: string;
  kind: 'monster' | 'spell' | 'trap' | 'ritual';
  type?: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  deckCost?: number;
  text?: string;
  /** A normal monster's description: what the card says, with no effect on play. */
  flavor?: string;
  image?: string;
  /** WebP copies of `image`, relative to /assets, when the server has them: 512px and 256px. */
  art?: string;
  artSmall?: string;
  mask?: string;
  /** Which template the card is drawn on, worked out by the server. A card with a template of its own (the Egyptian Gods) names it instead. */
  frame?: 'normal' | 'effect' | 'fusion' | 'ritual' | 'spell' | 'trap' | (string & {});
  /** A template only this card is drawn on: textures/<ownFrame>Template.png. */
  ownFrame?: string;
  /** The template image and attribute icon, relative to /assets. */
  template?: string;
  attributeIcon?: string;
  implemented?: boolean;
  abilityPending?: boolean;
  /** In the catalog but no deck may hold it yet (the Egyptian Gods). */
  locked?: boolean;
  /** What a spell or trap does, as the server's rules engine reads it. */
  effect?: { op: string; };
}

export interface DeckSummary {
  id: string; name: string; leaderNum: number; cards: number[]; deckCost: number; isPublic?: boolean;
  starter?: boolean; description?: string; ownerId?: string; ownerName?: string; updatedAt?: string;
  /** Who built it for its owner (a friend or an administrator); absent when the owner did. */
  madeById?: string; madeByName?: string;
}
/** `preset`: a default map from the server's content/data/maps.json, the same for everyone and read-only. */
export interface MapSummary { id: string; name: string; size: number; tiles: string[]; isPublic?: boolean; ownerId?: string; ownerName: string; preset?: boolean; }
/** ownerId, on a new deck, builds it for a friend (or anyone, for an administrator). */
export type DeckInput = Pick<DeckSummary, 'name' | 'leaderNum' | 'cards'> & { isPublic: boolean; ownerId?: string; };
export type MapInput = Pick<MapSummary, 'name' | 'size' | 'tiles'> & { isPublic: boolean; };

/** A failed request, with the HTTP status when the server answered (0 when it could not be reached). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(url: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  // A FormData body sets its own multipart Content-Type (with the boundary).
  const headers: Record<string, string> = init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    crumb('api', `${init.method ?? 'GET'} ${new URL(url, location.href).pathname}: unreachable`);
    throw new ApiError(`Cannot reach ${new URL(url).host}. Is it running?`, 0);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const path = new URL(url, location.href).pathname;
    crumb('api', `${init.method ?? 'GET'} ${path}: ${response.status}`);
    if (response.status >= 500) reportError('api', `${init.method ?? 'GET'} ${path} answered ${response.status}: ${body?.error ?? response.statusText}`);
  }
  if (response.status === 401 && token) throw new ApiError('Your session has expired. Sign in again.', 401);
  if (!response.ok) throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
  // A 200 that is not JSON (an HTML page from a proxy or an older server) is not an answer.
  if (!response.headers.get('Content-Type')?.includes('json')) throw new Error(`Unexpected response from ${new URL(url, window.location.href).pathname}`);
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

// --- game server: accounts and rooms ---
export const signIn = (kind: 'guest' | 'login' | 'register', name: string, password = '') =>
  request<{ token: string; user: User; }>(`${GAME_URL}/api/auth/${kind}`, post({ name, password }));
/** Who the token belongs to, with a renewed token to use from now on. */
export const whoAmI = (token: string) => request<User & { token?: string; }>(`${GAME_URL}/api/auth/me`, {}, token);
export type LlmModel = { id: string; label: string; note: string; };
export type ServerConfig = { llmBots: boolean; catalogLoaded: boolean; llmModels?: LlmModel[]; llmDefault?: string; };
export const serverConfig = () => request<ServerConfig>(`${GAME_URL}/api/config`);
export const listRooms = () => request<RoomInfo[]>(`${GAME_URL}/api/rooms`);
/** Duels in progress where we hold a seat, public or private. */
export const mySeatedRooms = (token: string) => request<RoomInfo[]>(`${GAME_URL}/api/rooms/mine`, {}, token);
export const createRoom = (token: string, options: { id?: string; mode: string; seats: string[]; size?: number; mapId?: string; lobby?: boolean; private?: boolean; /** An administrator's sandbox (they play both seats); the server ignores mode and seats. */ sandbox?: boolean; }) =>
  request<RoomInfo>(`${GAME_URL}/api/rooms`, post(options), token);

// --- game server: administration ---
export interface AccountInfo { id: string; name: string; admin: boolean; /** Named in ADMIN_USERS: only the server's configuration can change it. */ fromConfig?: boolean; created?: string; }
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
export const listAccounts = (token: string) => request<AccountInfo[]>(`${GAME_URL}/api/admin/users`, {}, token);
export const createAccount = (token: string, account: { name: string; password: string; admin: boolean; }) =>
  request<AccountInfo>(`${GAME_URL}/api/admin/users`, post(account), token);
export const setAccountAdmin = (token: string, id: string, admin: boolean) =>
  request<AccountInfo>(`${GAME_URL}/api/admin/users/${encodeURIComponent(id)}/admin`, put({ admin }), token);
export const setAccountPassword = (token: string, id: string, password: string) =>
  request<AccountInfo>(`${GAME_URL}/api/admin/users/${encodeURIComponent(id)}/password`, put({ password }), token);
/**
 * Lets this browser see Grafana at /grafana/ (the admin portal's Monitoring
 * page): the server sets a cookie for it, as an embedded page cannot send the
 * Authorization header.
 */
export const openGrafanaSession = (token: string) =>
  request<void>(`${GAME_URL}/api/admin/grafana/session`, { method: 'POST' }, token);
/** Every room on the server, private ones included. */
export const listAllRooms = (token: string) => request<RoomInfo[]>(`${GAME_URL}/api/admin/rooms`, {}, token);
/** Ends the room's duel, if one is on, and disconnects everyone in it. */
export const closeRoom = (token: string, id: string) =>
  request<void>(`${GAME_URL}/api/admin/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);

// --- game server: admin arena (test games between computer players) ---
export interface LLMModelInfo { id: string; label: string; note: string; inputPerM?: number; outputPerM?: number; cacheReadPerM?: number; }
export interface ArenaKind { id: string; label: string; note?: string; model?: LLMModelInfo; }
export interface ArenaSpec { a: string; b: string; games: number; parallel: number; mode: '1v1' | '2v2'; budgetUsd: number; }
export interface ArenaUsage { calls: number; fallbacks: number; input: number; output: number; cacheRead: number; cacheWrite: number; }
export interface ArenaSide { kind: string; label: string; wins: number; usage?: ArenaUsage; costUsd: number; priced: boolean; }
export interface ArenaGame {
  n: number; seed: number; status: 'queued' | 'playing' | 'done' | 'cancelled' | 'error';
  /** Side A sat in seat 0 and moved first. */
  aFirst: boolean;
  winner?: 'A' | 'B' | 'draw'; reason?: string; turns: number; actions: number; lpA: number; lpB: number;
  deckA?: string; deckB?: string; seconds: number; error?: string; said?: string[];
}
export interface ArenaJob {
  id: string; spec: ArenaSpec; by: string; status: 'running' | 'done' | 'stopped'; stopped?: string;
  created: string; finished?: string; sides: [ArenaSide, ArenaSide]; draws: number; done: number; costUsd: number; games: ArenaGame[];
}
export const getArena = (token: string) => request<{ kinds: ArenaKind[]; jobs: ArenaJob[]; }>(`${GAME_URL}/api/admin/arena`, {}, token);
export const startArena = (token: string, spec: ArenaSpec) =>
  request<{ id: string; }>(`${GAME_URL}/api/admin/arena`, { method: 'POST', body: JSON.stringify(spec) }, token);
/** Stops a running job; a finished one is forgotten. */
export const stopArena = (token: string, id: string) =>
  request<void>(`${GAME_URL}/api/admin/arena/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);

// --- game server: admin card editor ---
/** A card as stored: the catalog's fields, without the ones the server adds when serving it. */
export type StoredCard = Record<string, unknown> & { num?: number; name?: string; kind?: string; };
export interface CardRevision { id: number; changedAt: string; changedBy: string; note: string; card: StoredCard; }
/** `abilities` is missing from servers older than the card editor. */
export interface EffectReference { effects: Record<string, string>; abilities?: Record<string, string[]>; leaders: string[]; }
export const getEffectReference = (token: string) => request<EffectReference>(`${GAME_URL}/api/admin/effects`, {}, token);
export const getStoredCard = (token: string, num: number) =>
  request<{ card: StoredCard; updatedAt: string; updatedBy: string; }>(`${GAME_URL}/api/admin/cards/${num}`, {}, token);
/** Creates or replaces a card. Refused with the problems listed in the error when it would not play. */
export const saveCard = (token: string, num: number, card: StoredCard, note: string) =>
  request<{ card: StoredCard; version: string; warnings: string[]; }>(
    `${GAME_URL}/api/admin/cards/${num}?note=${encodeURIComponent(note)}`, { method: 'PUT', body: JSON.stringify(card) }, token);
export const getCardRevisions = (token: string, num: number) => request<CardRevision[]>(`${GAME_URL}/api/admin/cards/${num}/revisions`, {}, token);

// --- game server: admin card lab (Claude designs cards) ---
export interface CardProposal { card: StoredCard; summary: string; newBehaviour?: string; warnings: string[]; replaces?: string; }
export interface CardLabReply {
  session: string; model: string; text: string; proposals: CardProposal[]; steps: string[];
  turnCostUsd: number; totalCostUsd: number; usage: ArenaUsage;
}
export const getCardLab = (token: string) =>
  request<{ available: boolean; models: LLMModelInfo[]; default: string; }>(`${GAME_URL}/api/admin/cardlab`, {}, token);
/** One message to Claude; an empty session starts a conversation. Status 410: the server forgot the conversation. */
export const sendCardLab = (token: string, body: { session: string; model: string; message: string; }) =>
  request<CardLabReply>(`${GAME_URL}/api/admin/cardlab`, { method: 'POST', body: JSON.stringify(body) }, token);

// --- game server: admin card scout (Claude adapts outside cards for review) ---
/** One way a scouted card could work in this game, already checked against the engine. */
export interface ScoutOption { title: string; card: StoredCard; summary: string; newBehaviour?: string; warnings: string[]; }
/** The card as the outside card database describes it. `atk`/`def` are null for "?". */
export interface ScoutSource {
  id: number; name: string; type: string; desc: string; race: string; attribute: string;
  atk: number | null; def: number | null; level: number; released: string;
  image: string; imageSmall: string; imageCropped: string; url: string;
  /** Uploaded cards: imageSmall is a data URL thumbnail of the card, artThumb one of the art dropped with it. */
  uploaded?: boolean; artThumb?: string; hint?: string;
}
/** working: Claude is still reading an uploaded card. */
export type ScoutStatus = 'working' | 'pending' | 'accepted' | 'rejected' | 'failed';
export interface ScoutSuggestion {
  id: number; sourceId: number; name: string; summon: string; released: string; source: ScoutSource;
  status: ScoutStatus; options: ScoutOption[]; note: string; model: string; costUsd: number;
  createdAt: string; decidedAt: string; decidedBy: string; chosen: number | null; cardNum: number | null;
  /** '' (not yet), working, done or failed: the art's WebP copies and holo mask. */
  assets: '' | 'working' | 'done' | 'failed'; assetsLog: string;
}
export interface ScoutState {
  available: boolean; running: boolean; busy: string; lastScan: string; lastError: string; model: string;
  intervalSeconds: number; dailyLimit: number; today: number; counts: Partial<Record<ScoutStatus, number>>;
  /** Cards not scouted yet; -1 until the scout has read the list. */
  left: number; spentUsd: number; summons: string[];
}
export const getCardScout = (token: string) =>
  request<{ status: ScoutState; suggestions: ScoutSuggestion[]; }>(`${GAME_URL}/api/admin/scout`, {}, token);
export const setCardScoutRunning = (token: string, running: boolean) =>
  request<void>(`${GAME_URL}/api/admin/scout/running`, { method: 'POST', body: JSON.stringify({ running }) }, token);
export const scanCardScout = (token: string) =>
  request<void>(`${GAME_URL}/api/admin/scout/scan`, { method: 'POST' }, token);
/** Saves that option as a new card and starts building its art; answers the new card's number. */
export const acceptScouted = (token: string, id: number, option: number) =>
  request<{ num: number; }>(`${GAME_URL}/api/admin/scout/${id}/accept`, { method: 'POST', body: JSON.stringify({ option }) }, token);
export const rejectScouted = (token: string, id: number) =>
  request<void>(`${GAME_URL}/api/admin/scout/${id}/reject`, { method: 'POST' }, token);
export const rescanScouted = (token: string, id: number, feedback: string) =>
  request<void>(`${GAME_URL}/api/admin/scout/${id}/rescan`, { method: 'POST', body: JSON.stringify({ feedback }) }, token);
/**
 * Sends the image of a card to add (and, optionally, the art to draw it with
 * in the game). Claude reads it in the background: it shows as "working".
 */
export const uploadScoutCard = (token: string, card: File, art: File | null, hint: string) => {
  const form = new FormData();
  form.append('card', card);
  if (art) form.append('art', art);
  form.append('hint', hint);
  return request<{ id: number; }>(`${GAME_URL}/api/admin/scout/upload`, { method: 'POST', body: form }, token);
};
export const retryScoutedAssets = (token: string, id: number) =>
  request<void>(`${GAME_URL}/api/admin/scout/${id}/assets`, { method: 'POST' }, token);

// --- game server: deck assistant (Claude builds decks) ---
export interface DeckProposal { name: string; leaderNum: number; cards: number[]; summary: string; deckCost: number; fusions: number; }
export interface DeckAssistantReply { session: string; model: string; text: string; proposals: DeckProposal[]; steps: string[]; }
/** models comes only for administrators, who may pick one per conversation. */
export const getDeckAssistant = (token: string) =>
  request<{ available: boolean; model?: string; models?: LLMModelInfo[]; }>(`${GAME_URL}/api/deck-assistant`, {}, token);
/** One message to Claude with the deck open in the builder; an empty session starts a conversation. Status 410: the server forgot it. */
export const sendDeckAssistant = (token: string, body: { session: string; model: string; message: string; draft: { name: string; leaderNum: number; cards: number[]; }; }) =>
  request<DeckAssistantReply>(`${GAME_URL}/api/deck-assistant`, { method: 'POST', body: JSON.stringify(body) }, token);

export interface DeckAssistEntry {
  id: number; at: string; userId: string; userName: string; session: string; model: string;
  message: string; reply: string; steps: string[]; proposals: DeckProposal[]; refusals: number;
  usage: ArenaUsage; costUsd: number; durationMs: number; error?: string;
}
export interface DeckAssistStats {
  model: string; queries: number; failed: number; withDeck: number; decks: number; refusals: number;
  totalCostUsd: number; avgCostUsd: number; avgCostPerDeckUsd: number; avgSeconds: number; avgCalls: number;
  avgOutputTokens: number; avgFusionsPerDeck: number; cacheHitRate: number;
}
export interface DeckAssistOverview {
  available: boolean; models: LLMModelInfo[]; playerModel: string; defaultModel: string;
  stats: DeckAssistStats[]; log: DeckAssistEntry[];
}
export const getDeckAssistOverview = (token: string, days: number) =>
  request<DeckAssistOverview>(`${GAME_URL}/api/admin/deck-assistant?days=${days}`, {}, token);
export const setDeckAssistPlayerModel = (token: string, playerModel: string) =>
  request<void>(`${GAME_URL}/api/admin/deck-assistant`, { method: 'PUT', body: JSON.stringify({ playerModel }) }, token);

// --- game server: friends ---
export interface Friend { id: string; name: string; online: boolean; roomId?: string; }
export interface FriendsList {
  friends: Friend[];
  incoming: { id: string; name: string; }[];
  outgoing: { id: string; name: string; }[];
  invites: { from: { id: string; name: string; }; roomId: string; }[];
}
export const friendsList = (token: string) => request<FriendsList>(`${GAME_URL}/api/friends`, {}, token);
export const friendAction = (token: string, action: 'request' | 'accept' | 'remove' | 'invite', body: { name?: string; id?: string; }) =>
  request<{ friends?: boolean; roomId?: string; }>(`${GAME_URL}/api/friends/${action}`, post(body), token);

// --- game server: profiles ---
/** What one duelist did in a duel, or over many (see game/engine/stats.go). */
export interface DuelStats {
  damageDealt: number; damageTaken: number; biggestHit: number; healed: number;
  cardsDestroyed: number; monstersDestroyed: number; cardsLost: number;
  summons: number; fusions: number; rituals?: number; revives: number; equips: number;
  spellsCast: number; trapsSprung: number; takeovers: number; cardsDrawn: number;
  attacks: number; directAttacks: number; battlesWon: number;
}
export interface Tally { games: number; wins: number; }
export interface NamedTally extends Tally { name: string; }
export interface MatchSeat { userId?: string; name: string; bot?: boolean; team: number; deck?: string; lp: number; conceded?: boolean; }
export interface MatchSummary {
  at: string; room?: string; mode: string; map: string; result: 'win' | 'loss' | 'draw'; conceded?: boolean;
  deck?: string; lp: number; turns: number; seconds: number; allies: MatchSeat[]; opponents: MatchSeat[]; stats: DuelStats;
  /** The duel's recording, to watch again (see listReplays). */
  replay?: string;
}
export interface DuelRecord {
  games: number; wins: number; losses: number; draws: number; concedes: number; flawless: number;
  vsHumans: Tally; vsBots: Tally; oneVOne: Tally; twoVTwo: Tally;
  /** Positive: wins in a row; negative: losses in a row. */
  streak: number; bestStreak: number;
  turns: number; seconds: number; fastestWin: number;
  totals?: DuelStats; best?: DuelStats;
  first?: string; last?: string; recent: MatchSummary[];
}
export interface Profile {
  user: { id: string; name: string; guest?: boolean; admin?: boolean; joined?: string; };
  me: boolean; friend: boolean;
  record: DuelRecord;
  decks: NamedTally[]; rivals: NamedTally[]; maps: NamedTally[];
  collection: { decks: number; publicDecks: number; maps: number; friends: number; };
  /** Rarity points their cards have earned, by card number (cards with none are left out). */
  cardPoints: Record<string, number>;
  /** The decks they built: sent to themselves and to administrators only. */
  ownDecks?: DeckSummary[];
  /** The viewer may change ownDecks in the deck builder. */
  canEdit?: boolean;
}
/** Leave out the name for your own profile. */
export const loadProfile = (token: string, name?: string) =>
  request<Profile>(`${GAME_URL}/api/profile${name ? `/${encodeURIComponent(name)}` : ''}`, {}, token);

/** Your cards' rarity points, by card number (cards with none are left out). See Rarity in types.ts. */
export const loadRarity = (token: string) =>
  request<{ points: Record<string, number>; }>(`${GAME_URL}/api/rarity`, {}, token).then((r) => r.points);

// --- game server: cards, decks, maps ---
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
/** `fresh` revalidates with the server instead of taking the browser's cached copy. */
export const loadCatalog = (fresh = false) =>
  request<{ version: string; cards: CatalogCard[]; }>(`${GAME_URL}/api/cards`, fresh ? { cache: 'no-cache' } : {});
export const starterDecks = () => request<DeckSummary[]>(`${GAME_URL}/api/decks/starter`);
export const myDecks = (token: string) => request<DeckSummary[]>(`${GAME_URL}/api/decks`, {}, token);
/** Decks we built for other people. */
export const decksMadeByMe = (token: string) => request<DeckSummary[]>(`${GAME_URL}/api/decks?made=1`, {}, token);
export const saveDeck = (token: string, deck: DeckInput, id?: string) =>
  request<DeckSummary>(id ? `${GAME_URL}/api/decks/${encodeURIComponent(id)}` : `${GAME_URL}/api/decks`, json(id ? 'PUT' : 'POST', deck), token);
export const deleteDeck = (token: string, id: string) =>
  request<void>(`${GAME_URL}/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);
export const listMaps = (token: string | null) => request<MapSummary[]>(`${GAME_URL}/api/maps`, {}, token);
export const saveMap = (token: string, map: MapInput, id?: string) =>
  request<MapSummary>(id ? `${GAME_URL}/api/maps/${encodeURIComponent(id)}` : `${GAME_URL}/api/maps`, json(id ? 'PUT' : 'POST', map), token);
export const deleteMap = (token: string, id: string) =>
  request<void>(`${GAME_URL}/api/maps/${encodeURIComponent(id)}`, { method: 'DELETE' }, token);

/** `watch` says how to spectate: "user:<id>", "seat:<n>", "team:<n>", "admin", or "all" (a duel between computer players only). Leave it out to play. */
export function wsUrl(room: string, token: string, deck: string, watch?: string): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  const origin = (explicit ?? GAME_URL.replace(/^http/, 'ws')).replace(/\/+$/, '');
  const query = new URLSearchParams({ token });
  if (deck) query.set('deck', deck);
  if (watch) query.set('spectate', watch);
  return `${origin}/ws/${encodeURIComponent(room)}?${query}`;
}

// --- game server: replays (recorded duels; anyone may watch any of them) ---
export interface ReplayPlayer { userId?: string; name: string; team: number; bot?: boolean; deck?: string; }
export interface ReplayMeta {
  id: string; room: string; mode: string; map: string; started: string; ended: string;
  /** False for a duel the room closed on before anyone won. */
  finished: boolean;
  /** -1: a draw, or not finished. */
  winnerTeam: number;
  turns: number; steps: number; players: ReplayPlayer[];
}
/** An action as the server recorded it: fields it left empty are missing. */
export interface ReplayAction { type: string; cardId?: number; cardIds?: number[]; x: number; y: number; flip?: boolean; defense?: boolean; choice?: number; }
/** One step of a recorded duel: the board after it, with nothing hidden, and what caused it. */
export interface ReplayFrame {
  /** Milliseconds since the duel was dealt. */
  at: number;
  /** Who acted; -1 for the deal. */
  seat: number;
  action?: ReplayAction;
  /** An administrator's test tool, if one made this step. */
  tool?: string;
  state: GameView;
  events?: GameEvent[];
}
export interface ReplayDoc {
  v: number;
  room: RoomInfo;
  frames: ReplayFrame[];
  end: { finished: boolean; winnerTeam: number; turns: number; ended: string; };
}
/** The latest recorded duels, newest first: everyone's, or one account's. */
export const listReplays = (user?: string, before?: string) => {
  const query = new URLSearchParams();
  if (user) query.set('user', user);
  if (before) query.set('before', before);
  return request<ReplayMeta[]>(`${GAME_URL}/api/replays${query.size ? `?${query}` : ''}`);
};
export const loadReplay = (id: string) => request<ReplayDoc>(`${GAME_URL}/api/replays/${encodeURIComponent(id)}/frames`);
