import { useEffect } from 'react';
import { netManager } from '@/net/netManager';
import { useNetStore } from '@/stores/netStore';
import type { NetRole } from '@/net/protocol';

/**
 * Auto-joins a room when the page is opened with ?room=<id>[&role=player|spectator][&name=...].
 * Handy for opening two browser windows against the same room while testing.
 */
export function useMultiplayerBootstrap() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (!room) return;

    const roleParam = params.get('role');
    const role: NetRole = roleParam === 'spectator' ? 'spectator' : 'player';
    const name = params.get('name') ?? undefined;

    const net = useNetStore.getState();
    if (name) net.setPlayerName(name);

    netManager.connect({ roomId: room, role, name: name ?? net.playerName });

    return () => netManager.disconnect();
  }, []);
}
