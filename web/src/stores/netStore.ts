import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ConnectionStatus } from '@/net/gameSocket';
import type { NetRole, ServerUser } from '@/net/protocol';

interface NetState {
  status: ConnectionStatus;
  /** Room to join, also used as the /ws/{roomId} path segment. */
  roomId: string;
  playerName: string;
  /** Role we asked for; the server can downgrade a player to spectator. */
  requestedRole: NetRole;
  /** Role the server actually handed us on INIT_STATE. */
  assignedRole: NetRole | null;
  assignedPlayerId: string | null;
  /** Everybody connected to the room, players and spectators alike. */
  users: ServerUser[];
  /** This connection's own user. */
  me: ServerUser | null;
  lastError: string | null;
  /** Short human readable log of the last few events, handy while testing. */
  eventLog: string[];

  setStatus: (status: ConnectionStatus) => void;
  setRoomId: (roomId: string) => void;
  setPlayerName: (name: string) => void;
  setRequestedRole: (role: NetRole) => void;
  setAssignment: (playerId: string | null, role: NetRole | null) => void;
  setUsers: (users: ServerUser[]) => void;
  setMe: (me: ServerUser | null) => void;
  setLastError: (message: string | null) => void;
  pushEvent: (entry: string) => void;
  clearEvents: () => void;
}

const MAX_LOG_ENTRIES = 30;

export const useNetStore = create<NetState>()(persist((set) => ({
  status: 'idle',
  roomId: 'lobby',
  playerName: 'Duelist',
  requestedRole: 'player',
  assignedRole: null,
  assignedPlayerId: null,
  users: [],
  me: null,
  lastError: null,
  eventLog: [],

  setStatus: (status) => set({ status }),
  setRoomId: (roomId) => set({ roomId }),
  setPlayerName: (playerName) => set({ playerName }),
  setRequestedRole: (requestedRole) => set({ requestedRole }),
  setAssignment: (assignedPlayerId, assignedRole) => set({ assignedPlayerId, assignedRole }),
  setUsers: (users) => set({ users }),
  setMe: (me) => set({ me }),
  setLastError: (lastError) => set({ lastError }),
  pushEvent: (entry) => set((state) => ({
    eventLog: [`${new Date().toLocaleTimeString()} ${entry}`, ...state.eventLog].slice(0, MAX_LOG_ENTRIES)
  })),
  clearEvents: () => set({ eventLog: [] }),
}), {
  name: 'net-storage',
  // Only the connection form is worth remembering between reloads.
  partialize: (state) => ({
    roomId: state.roomId,
    playerName: state.playerName,
    requestedRole: state.requestedRole,
  }),
}));
