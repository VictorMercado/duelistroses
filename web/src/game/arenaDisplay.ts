import { session } from '@/net/session';
import { useGameStore } from '@/stores/gameStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

// Switching a screen to and from being the room's arena display (see
// components/ui/ArenaDisplay.tsx).

/** The room link, with ?display=1 on the display's own so a reload comes back as the display. */
export const roomLink = (room: string, display = false) => `${window.location.origin}/?room=${encodeURIComponent(room)}${display ? '&display=1' : ''}`;

function setUrl(room: string, display: boolean) {
  window.history.replaceState(null, '', `/?room=${encodeURIComponent(room)}${display ? '&display=1' : ''}`);
}

export function becomeDisplay(room: string) {
  setUrl(room, true);
  if (session.roomId !== room || !session.becomeDisplay()) session.connect(room, 'display');
}

/** Back to playing on this screen: the seat this user holds is taken back. */
export function stopDisplay(room: string) {
  setUrl(room, false);
  session.connect(room);
}

/** Whether this screen may become the room's arena display: the host's, or a seated player's (Room.mayDisplay). */
export function useMayDisplay(): boolean {
  const room = useGameStore((s) => s.room);
  const display = useGameStore((s) => s.display);
  const userId = useSessionStore((s) => s.user?.id);
  if (!room || display || !userId) return false;
  return room.hostId === userId || room.seats.some((s) => s.kind === 'human' && s.userId === userId);
}


/**
 * Keeps the room told how this display has turned the board, so the phones'
 * d-pads match it: on joining as the display, and whenever it is changed.
 * Call once.
 */
let syncing = false;

export function startDisplaySync() {
  if (syncing) return;
  syncing = true;
  let sent = '';
  const sync = () => {
    const game = useGameStore.getState();
    if (!game.display || !game.room) { sent = ''; return; }
    const { arenaTurn, arenaSeatControls } = useUIStore.getState();
    const key = `${game.room.id}:${arenaTurn}:${arenaSeatControls}`;
    // The room is the judge: tell it again if it ever disagrees (a reconnect, a new room).
    if (key === sent && game.room.displayTurn === arenaTurn && game.room.seatControls === arenaSeatControls) return;
    sent = key;
    session.orient(arenaTurn, arenaSeatControls);
  };
  useGameStore.subscribe(sync);
  useUIStore.subscribe(sync);
}
