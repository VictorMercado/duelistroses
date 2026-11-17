import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/net/api';

interface SessionState {
  token: string | null;
  user: User | null;
  deckId: string;
  /** The map chosen in the lobby; empty for a random saved map, "generate" for a newly generated one. */
  mapId: string;
  /** The Claude model LLM opponents play as; empty for the server's default. */
  llmModel: string;
  /** The rule-based bot's personality an administrator picked; empty for a random one. */
  botStyle: BotStyle;
  setSession: (token: string | null, user: User | null) => void;
  setDeckId: (deckId: string) => void;
  setMapId: (mapId: string) => void;
  setLlmModel: (llmModel: string) => void;
  setBotStyle: (botStyle: BotStyle) => void;
}

/** The rule-based bot's personalities, as the server names them. */
export type BotStyle = '' | 'balanced' | 'aggressive' | 'builder' | 'defensive';

/** Who is signed in, with the token the game server issued. */
export const useSessionStore = create<SessionState>()(persist((set) => ({
  token: null,
  user: null,
  deckId: '',
  mapId: '',
  llmModel: '',
  botStyle: '',
  // The chosen deck and map belong to whoever chose them: another account may not use them.
  setSession: (token, user) => set((state) => (user?.id === state.user?.id ? { token, user } : { token, user, deckId: '', mapId: '' })),
  setDeckId: (deckId) => set({ deckId }),
  setMapId: (mapId) => set({ mapId }),
  setLlmModel: (llmModel) => set({ llmModel }),
  setBotStyle: (botStyle) => set({ botStyle }),
}), { name: 'duelist-session' }));
