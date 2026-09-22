/**
 * Wire protocol shared with the Go server (game/messages.go).
 * Keep the string literals and payload shapes in sync with the backend.
 */

export const NetEvent = {
  MOVE_CARD: 'MOVE_CARD',
  DRAW_CARD: 'DRAW_CARD',
  CARD_DESTROYED: 'CARD_DESTROYED',
  CARD_PLAYED: 'CARD_PLAYED',
  CARD_ATTACKED: 'CARD_ATTACKED',
  CARD_ACTIVATED: 'CARD_ACTIVATED',
  CARD_CHANGED_POSITION: 'CARD_CHANGED_POSITION',
  END_TURN: 'END_TURN',
  INIT_STATE: 'INIT_STATE',
  STATE_SYNC: 'STATE_SYNC',
  USER_JOINED: 'USER_JOINED',
  USER_LEFT: 'USER_LEFT',
  ERROR: 'ERROR',
} as const;

export type NetEventType = typeof NetEvent[keyof typeof NetEvent];

export type NetRole = 'player' | 'spectator';

/**
 * game/user.go -> User. One per connection, above the game itself: a user is
 * either a player holding a seat or a spectator watching. `playerId` is the
 * seat, and is absent for spectators.
 */
export interface ServerUser {
  id: string;
  name: string;
  role: NetRole;
  /** Set once the user sits down; absent for spectators. */
  clan?: string;
  owner?: 'player' | 'opponent';
  textureUrl?: string;
}

export interface NetVector3 {
  x: number;
  y: number;
  z: number;
}

/** game/models.go -> Card */
export interface ServerCard {
  id: number;
  position: NetVector3;
  owner: 'player' | 'opponent';
  name: string;
  attack: number;
  defense: number;
  description: string;
  level: number;
  monster: { monster: string; strongIn: string[]; weakIn: string[]; } | null;
  type: string;
  templateUrl: string;
  attribute: { type: string; attributeUrl: string; };
  rarity: string;
  textureUrl: string;
  maskUrl?: string;
  isFaceDown: boolean;
  isDefenseMode: boolean;
  hasMoved: boolean;
  /** True when the server withheld this card's identity from us. */
  hidden?: boolean;
}

/**
 * game/models.go -> PlayerView. A seat, with the identity of the user sitting
 * in it joined in. `id` is that user's id, empty when the seat is free. The
 * server projects this per client: `hand` only lists ids for the client that
 * owns it, everyone else gets counts.
 */
export interface ServerPlayer {
  id: string;
  position: NetVector3;
  owner: 'player' | 'opponent';
  name: string;
  clan: string;
  textureUrl: string;
  hand: number[];
  graveyard: number[];
  cardsInPlay: number[];
  boardSide: 'N' | 'S' | 'E' | 'W';
  /** Which edge of the board this seat looks from. */
  facing: 'N' | 'S' | 'E' | 'W';
  firstMove: boolean;
  connected: boolean;
  deckCount: number;
  handCount: number;
}

/** game/models.go -> GameStateView */
export interface ServerGameState {
  players: ServerPlayer[];
  cards: ServerCard[];
  playerTurnIndex: number;
  gridSize: number;
}

// --- Payloads ---

export interface MoveCardPayload {
  cardId: number;
  targetTile: NetVector3;
}

export interface DrawCardPayload {
  playerId: string;
}

export interface CardDestroyedPayload {
  cardId: number;
}

export interface CardPlayedPayload {
  cardId: number;
  position: NetVector3;
}

export interface CardAttackedPayload {
  attackerCardId: number;
  targetCardId: number;
}

export interface CardActivatedPayload {
  cardId: number;
}

export interface CardChangedPositionPayload {
  cardId: number;
  isDefenseMode: boolean;
  isFaceDown: boolean;
  /** Present only when the card ended up face up, i.e. publicly revealed. */
  card?: ServerCard;
}

export interface EndTurnPayload {
  nextPlayerId: string;
}

export interface InitStatePayload {
  gameState: ServerGameState;
  /** The seat we hold, which is our own user id. Empty for spectators. */
  yourId: string;
  yourRole: NetRole;
  /** Card objects for this client's own hand (never anyone else's). */
  yourHand: ServerCard[];
  /** This connection's user, and everybody currently in the room. */
  you: ServerUser;
  users: ServerUser[];
}

/** game/messages.go -> UserPayload */
export interface UserPayload {
  user: ServerUser;
  users: ServerUser[];
}

export interface ErrorPayload {
  message: string;
}

/** Maps every event to the payload the server sends back for it. */
export interface ServerPayloads {
  [NetEvent.MOVE_CARD]: MoveCardPayload;
  [NetEvent.DRAW_CARD]: DrawCardPayload;
  [NetEvent.CARD_DESTROYED]: CardDestroyedPayload;
  [NetEvent.CARD_PLAYED]: CardPlayedPayload;
  [NetEvent.CARD_ATTACKED]: CardAttackedPayload;
  [NetEvent.CARD_ACTIVATED]: CardActivatedPayload;
  [NetEvent.CARD_CHANGED_POSITION]: CardChangedPositionPayload;
  [NetEvent.END_TURN]: EndTurnPayload;
  [NetEvent.INIT_STATE]: InitStatePayload;
  [NetEvent.STATE_SYNC]: InitStatePayload;
  [NetEvent.USER_JOINED]: UserPayload;
  [NetEvent.USER_LEFT]: UserPayload;
  [NetEvent.ERROR]: ErrorPayload;
}

export interface OutgoingMessage<T extends NetEventType = NetEventType> {
  type: T;
  payload: unknown;
}

export interface IncomingMessage<T extends NetEventType = NetEventType> {
  type: T;
  payload: T extends keyof ServerPayloads ? ServerPayloads[T] : unknown;
}

/**
 * Resolves the websocket origin. Vite proxies /ws to the Go server in dev
 * (see vite.config.ts), and in production the Go server serves web/dist itself,
 * so same-origin is correct in both cases. Override with VITE_WS_URL.
 */
export function resolveWsOrigin(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit.replace(/\/+$/, '');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function buildWsUrl(roomId: string, role: NetRole): string {
  return `${resolveWsOrigin()}/ws/${encodeURIComponent(roomId)}?role=${role}`;
}

// --- Board map (REST: GET /api/rooms/{roomId}/map) ---

/** game/board.go -> MapTile */
export interface ServerMapTile {
  x: number;
  y: number;
  terrain: string;
}

/** game/board.go -> GameMap */
export interface ServerGameMap {
  gridSize: number;
  seed: number;
  tiles: ServerMapTile[];
}

/** Same origin as the websocket, over http(s). */
export function resolveHttpOrigin(): string {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return explicit.replace(/\/+$/, '');
  return window.location.origin;
}

export function buildRoomMapUrl(roomId: string): string {
  return `${resolveHttpOrigin()}/api/rooms/${encodeURIComponent(roomId)}/map`;
}
