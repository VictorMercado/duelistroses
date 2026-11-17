/**
 * Wire protocol shared with the Go server (game/client.go, game/engine/view.go).
 * The server is authoritative: the client sends intents and renders the state
 * that comes back. It never computes game rules itself.
 */

export interface Pos { x: number; y: number; }

export interface CardView {
  id: number;
  /** Card number in the catalog; HIDDEN_NUM (-1) when the server hid the card from us. 0 is a real card. */
  num: number;
  owner: number;
  x: number;
  y: number;
  faceDown: boolean;
  defense: boolean;
  acted: boolean;
  hidden?: boolean;
  borrowed?: boolean;
  /** Fused from two teammates' monsters: whichever of the team is taking its turn controls it. */
  shared?: boolean;
  spellbound?: number;
  atk: number;
  def: number;
  atkMod?: number;
  defMod?: number;
  /** What its square adds to ATK and DEF (already counted in atk and def): + strong there, - weak. */
  terrain?: number;
  /** What class of card a hidden card is, when we have found out (a scout, Tainted Wisdom, The Inexperienced Spy). */
  class?: 'monster' | 'spell' | 'trap' | 'ritual' | 'power-up';
  /** A hidden monster's type, while The Inexperienced Spy shows it. */
  type?: string;
}

export interface SeatView {
  index: number;
  team: number;
  alive: boolean;
  lp: number;
  stars: number;
  leaderX: number;
  leaderY: number;
  leaderActed: boolean;
  /** The deck leader's card number, drawn on its emblem (-1: none). */
  leaderNum: number;
  handCount: number;
  deckCount: number;
  playsLeft: number;
  graveyard: number[];
  /** The deck leader's rank this duel, 1 to 10: earned by destroying enemy monsters, it makes a Destiny Draw likelier (only possible at half LP or less). */
  rank: number;
}

export interface PendingView {
  seat: number;
  kind: string;
  prompt: string;
  /** For a card in a graveyard, `from` is whose graveyard and `slot` its place in it (0 = oldest). */
  /** `seat` is set when the option is a player (whose LP to restore). */
  options?: { label: string; num?: number; from?: number; slot?: number; seat?: number; }[];
}

export interface LegalView {
  moves: Record<string, Pos[]>;
  /** A face-down monster's moves if it turns face up as it moves (it may reach further). */
  flipMoves?: Record<string, Pos[]>;
  summon: Pos[];
  leader: Pos[];
  /** Each of our monsters' ATK and DEF on every terrain of the map: card ID, then terrain name as in `tiles`. */
  strength?: Record<string, Record<string, { atk: number; def: number; }>>;
}

export interface GameView {
  phase: 'playing' | 'finished';
  size: number;
  /** Terrain names, row by row from the south-west corner. */
  tiles: string[];
  turn: number;
  /** Every seat's turn so far: names one turn. Players count `round` instead. */
  turnCount: number;
  /** The round being played, from 1: every duelist still in has one turn a round. Missing from an older server. */
  round?: number;
  winnerTeam: number;
  maxStars: number;
  /** Field limits per duelist (a team shares maxMonsters × its duelists). Missing from an older server. */
  maxMonsters?: number;
  maxSpells?: number;
  seats: SeatView[];
  cards: CardView[];
  hand: HandCardView[];
  pending?: PendingView;
  /** Present only when it is our turn: everything we may do. */
  legal?: LegalView;
  /** Administrators only: every seat's hand and remaining deck (top card first). */
  reveal?: { hands: HandCardView[][]; decks: number[][]; };
  /** An administrator playing a duel: their own remaining deck, top card first. */
  deck?: number[];
  /** The opponents' hands, during the turn we cast The Eye of Truth. */
  peek?: { seat: number; cards: number[]; }[];
}

export interface HandCardView { id: number; num: number; }

export interface GameEvent {
  type: string;
  seat: number;
  cardId?: number;
  num?: number;
  target?: number;
  x: number;
  y: number;
  amount?: number;
  text?: string;
  /** A fusionChain event's merges, in order. */
  steps?: ChainStep[];
}

/**
 * One merge of cards played together: add came to base and result is what
 * remained. Card numbers are -1 (a mystery card) when the viewer may not see
 * the hand they came from. board: base was already standing on the square.
 */
export interface ChainStep {
  base: number;
  add: number;
  result: number;
  kind: 'fuse' | 'bonk' | 'equip';
  amount?: number;
  board?: boolean;
}

export interface SeatInfo {
  index: number;
  team: number;
  kind: 'human' | 'bot' | 'puppet';
  name: string;
  userId?: string;
  deckName?: string;
  connected: boolean;
  open: boolean;
}

export interface RoomInfo {
  id: string;
  mode: '1v1' | '2v2';
  size: number;
  mapName: string;
  started: boolean;
  finished: boolean;
  spectators: number;
  seats: SeatInfo[];
  /** True while players may still change seats and teams. */
  lobby: boolean;
  private: boolean;
  /** The user who may configure and start the lobby. */
  hostId?: string;
  /** The players have silenced spectator chat. */
  spectatorsMuted: boolean;
  /** Nobody but computer players sits with the one player, so the duel may be paused. */
  pausable: boolean;
  /** The duel is paused: no clock, no bot moves, no actions. */
  paused: boolean;
  /** An arena display shows the board: the players' phones are controllers. */
  display: boolean;
  /** Quarter turns the display has given the board (counter-clockwise), for the phones' d-pads. */
  displayTurn: number;
  /** With a display: each player's d-pad "up" is away from their own edge, not up the display's screen. */
  seatControls: boolean;
}

/** What a player has picked up and where it may go, as the arena display lights it. */
export interface Selection {
  kind: '' | 'card' | 'leader' | 'place' | 'hand';
  from?: Pos;
  targets: Pos[];
}

/** What a player can ask of a lobby before the duel starts. */
export type LobbyMessage =
  | { t: 'sit'; seat: number; }
  | { t: 'stand'; }
  /** kind 'bot:llm:<model id>' picks the model; plain 'bot:llm' gets the server's default.
   *  'bot:<personality>' is honoured for administrators only; a plain 'bot' plays a random personality. */
  | { t: 'seat'; seat: number; kind: 'human' | 'bot' | 'bot:balanced' | 'bot:aggressive' | 'bot:builder' | 'bot:defensive' | 'bot:llm' | `bot:llm:${string}`; }
  | { t: 'mode'; mode: '1v1' | '2v2'; }
  | { t: 'start'; };

/** An administrator's test tools (game/room.go adminTool). */
export type AdminTool =
  | { op: 'give'; num: number; field: false; }
  | { op: 'give'; num: number; field: true; x: number; y: number; /** Face up rather than face down. */ up?: boolean; }
  | { op: 'deck'; deck: number[]; }
  | { op: 'refresh'; }
  | { op: 'lp'; num: number; }
  /** Sends the card with this id from the field to its owner's graveyard. */
  | { op: 'remove'; num: number; }
  // The sandbox's own controls (Options.Sandbox in game/room.go).
  | { op: 'control'; seat: number; }
  | { op: 'follow'; on: boolean; }
  | { op: 'unlimited'; on: boolean; };

/** An administrator's sandbox: they play every seat. */
export interface SandboxInfo {
  /** The controls switch to whichever seat the game waits on. */
  follow: boolean;
  /** Cards are free to play and the field limits are off. */
  unlimited: boolean;
}

export type Action =
  | { type: 'summon'; cardIds: number[]; x: number; y: number; }
  | { type: 'move'; cardId: number; x: number; y: number; flip?: boolean; /** Switch out of defense into attack first. */ attack?: boolean; }
  | { type: 'flip'; cardId: number; }
  | { type: 'position'; cardId: number; defense: boolean; flip?: boolean; }
  | { type: 'leader'; x: number; y: number; }
  | { type: 'discard'; cardIds: number[]; }
  | { type: 'choose'; choice: number; }
  | { type: 'endTurn'; }
  | { type: 'concede'; };

export type ServerMessage =
  | { t: 'welcome'; you: { userId: string; name: string; seat: number; /** Seat a spectator watches through, -1 for none. */ watch: number; /** Watching with nothing hidden. */ admin?: boolean; /** An administrator in a seat: the test tools are on. */ tools?: boolean; /** Playing a sandbox: `seat` is the side controlled now. */ sandbox?: SandboxInfo; /** This screen is the room's arena display. */ display?: boolean; }; room: RoomInfo; }
  | { t: 'chat'; cid: number; name: string; seat: number; spectator?: boolean; message: string; }
  | { t: 'cursor'; cid: number; name?: string; seat: number; x: number; y: number; spectator?: boolean; gone?: boolean; }
  | { t: 'room'; room: RoomInfo; }
  | { t: 'sel'; cid: number; seat: number; name?: string; sel: Selection; }
  | { t: 'state'; seq: number; state: GameView; events?: GameEvent[]; id?: number; deadline?: number; }
  | { t: 'error'; id?: number; message: string; }
  | { t: 'say'; seat: number; message: string; }
  /** An LLM bot's reasoning and the move it led to; sent to administrators only. */
  | { t: 'thought'; seat: number; name: string; message: string; action?: string; }
  | { t: 'pong'; ts: number; };
