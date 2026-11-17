/**
 * The deck builder talks to two servers. Its own API (same origin) holds the
 * cards, decks, maps and assets. Accounts live on the game server: signing in
 * happens there, and the token it issues is what this API accepts.
 */
export const AUTH_URL = ((import.meta.env.VITE_AUTH_URL as string | undefined) ?? 'http://localhost:8080').replace(/\/+$/, '');

export interface Card {
  num: number;
  name: string;
  kind: 'monster' | 'spell' | 'trap' | 'ritual';
  type?: string;
  attribute?: string;
  level?: number;
  atk?: number;
  def?: number;
  deckCost: number;
  text?: string;
  image?: string;
  imageHd?: string;
  implemented?: boolean;
  abilityPending?: boolean;
}

export interface Deck {
  id: string;
  name: string;
  leaderNum: number;
  cards: number[];
  isPublic: boolean;
  deckCost: number;
  starter?: boolean;
  description?: string;
}

export interface GameMap {
  id: string;
  name: string;
  size: number;
  tiles: string[];
  isPublic: boolean;
  ownerId: string;
  ownerName: string;
}

export interface User { id: string; name: string; guest: boolean; }

let token: string | null = localStorage.getItem('duelist-token');

export function setToken(next: string | null) {
  token = next;
  if (next) localStorage.setItem('duelist-token', next);
  else localStorage.removeItem('duelist-token');
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(`Cannot reach ${url.startsWith('http') ? new URL(url).host : 'the content service'}.`);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (response.status === 401) throw new Error('Your session has expired. Sign in again.');
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data as T;
}

export const api = {
  signIn: (kind: 'guest' | 'login' | 'register', name: string, password: string) =>
    request<{ token: string; user: User; }>(`${AUTH_URL}/api/auth/${kind}`, 'POST', { name, password }),
  me: () => request<User>(`${AUTH_URL}/api/auth/me`),

  cards: () => request<{ cards: Card[]; }>('/api/cards'),
  starterDecks: () => request<Deck[]>('/api/decks/starter'),
  decks: () => request<Deck[]>('/api/decks'),
  saveDeck: (deck: Pick<Deck, 'name' | 'leaderNum' | 'cards' | 'isPublic'>, id?: string) =>
    request<Deck>(id ? `/api/decks/${id}` : '/api/decks', id ? 'PUT' : 'POST', deck),
  deleteDeck: (id: string) => request<void>(`/api/decks/${id}`, 'DELETE'),

  maps: () => request<GameMap[]>('/api/maps'),
  saveMap: (map: Pick<GameMap, 'name' | 'size' | 'tiles' | 'isPublic'>, id?: string) =>
    request<GameMap>(id ? `/api/maps/${id}` : '/api/maps', id ? 'PUT' : 'POST', map),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, 'DELETE'),
};

export const artUrl = (card: Card) => `/assets/${card.image ?? 'cards/hd/mysteryCard.png'}`;
