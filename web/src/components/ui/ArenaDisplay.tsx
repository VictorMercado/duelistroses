import { useState } from "react";
import { session } from "@/net/session";
import { useGameStore } from "@/stores/gameStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { becomeDisplay, roomLink, stopDisplay, useMayDisplay } from "@/game/arenaDisplay";

/**
 * The arena display: a big screen (a PC on a TV or monitor) that shows the
 * board for the whole table, while each player plays from their phone, which
 * then holds only their hand, the graveyards and the buttons. The host or any
 * seated player can turn the screen they are on into the display: it rejoins
 * the room as the display, giving up its seat, and the player takes the seat
 * back by opening the room on their phone. It can be switched on and off at
 * any time, mid-duel too; when it goes, the phones become boards again.
 */

const ghost = " border border-white/25 px-3 py-1.5 hover:border-yellow-400 pointer-coarse:min-h-11";

/** "Use this screen as the arena": offered in the waiting room and the settings panel. */
export function BecomeDisplayButton({ className = "" }: { className?: string; }) {
  const room = useGameStore((s) => s.room);
  const seat = useGameStore((s) => s.seat);
  const started = useGameStore((s) => s.view !== null);
  const may = useMayDisplay();
  if (!room || !may) return null;
  const go = () => {
    // Mid-duel this screen gives up its seat until the phone joins (the seat is held meanwhile).
    if (started && seat >= 0 && !confirm("This screen will show the board for everyone. Open the room link on your phone to keep playing: your seat waits for you. Continue?")) return;
    becomeDisplay(room.id);
  };
  return (
    <button className={`${ghost} ${className}`} onClick={go} title="Show the board on this screen; everyone plays from their phone">
      🖥 Use this screen as the arena
    </button>
  );
}

const chip = (on: boolean) => ` border px-2.5 py-1 ${on ? "border-yellow-400 bg-yellow-900/50 text-yellow-100" : "border-white/20 bg-black/60 text-white/70 hover:border-white/50"}`;

/**
 * How the display shows the board, kept on this screen: turned any way
 * round, tilted (a screen standing up) or flat (lying on a table, seen from
 * every side), and whether each player's d-pad follows the screen or their
 * own edge of the table. The room is told, for the phones' d-pads.
 */
export function ArenaOptions({ compact = false }: { compact?: boolean; }) {
  const turn = useUIStore((s) => s.arenaTurn);
  const flat = useUIStore((s) => s.arenaFlat);
  const seatControls = useUIStore((s) => s.arenaSeatControls);
  const ui = useUIStore.getState();
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "text-[11px]" : "justify-center text-xs"}`}>
      <span className="text-white/50">Board</span>
      <button className={chip(false)} onClick={() => ui.setArenaTurn(turn + 1)} title="Turn the board a quarter turn to the left" aria-label="Turn the board left">⟲</button>
      <span className="w-9 text-center tabular-nums text-white/80">{turn * 90}°</span>
      <button className={chip(false)} onClick={() => ui.setArenaTurn(turn - 1)} title="Turn the board a quarter turn to the right" aria-label="Turn the board right">⟳</button>
      <span className="ml-2 text-white/50">View</span>
      <button className={chip(!flat)} onClick={() => ui.setArenaFlat(false)} title="Seen at an angle, for a screen standing up">Tilted</button>
      <button className={chip(flat)} onClick={() => ui.setArenaFlat(true)} title="Seen straight down, for a screen lying on a table">Flat</button>
      <span className="ml-2 text-white/50">D-pads</span>
      <button className={chip(!seatControls)} onClick={() => ui.setArenaSeatControls(false)} title="Up on every phone is up on this screen">Follow screen</button>
      <button className={chip(seatControls)} onClick={() => ui.setArenaSeatControls(true)} title="Up on each phone is away from that player's edge of the board: for a table everyone sits around">Follow each player's side</button>
    </div>
  );
}

/**
 * The waiting room on the display: who has joined, and how the players join
 * from their phones. Seats are taken from the phones, not here.
 */
export function DisplayLobby() {
  const room = useGameStore((s) => s.room);
  const userId = useSessionStore((s) => s.user?.id);
  if (!room) return null;
  const host = room.hostId === userId;
  const ready = room.seats.every((s) => !s.open);
  return (
    <div className="flex flex-col items-center gap-3 border border-yellow-500/40 bg-yellow-950/20 p-4 text-center">
      <p className="text-lg font-bold text-yellow-300">🖥 This screen is the arena</p>
      <p className="text-white/70">Each player opens this link on their phone and signs in. Their phone becomes their controller and holds their hand.</p>
      <p className="break-all bg-black/60 px-3 py-2 text-base text-white sm:text-xl">{roomLink(room.id)}</p>
      <ArenaOptions />
      <p className="text-xs text-white/50">Room code <b className="text-white">{room.id}</b> · {room.seats.filter((s) => !s.open).length}/{room.seats.length} seats filled</p>
      <div className="flex flex-wrap justify-center gap-2">
        {room.lobby && host && <button className="bg-yellow-600 px-4 py-1.5 font-bold text-black disabled:opacity-40 pointer-coarse:min-h-11" disabled={!ready} onClick={() => session.lobby({ t: "start" })}>Start duel</button>}
        <button className={ghost} onClick={() => stopDisplay(room.id)}>Play on this screen instead</button>
      </div>
    </div>
  );
}

/** In the duel, on the display: the room's link for latecomers, who is missing, and the way out. */
export function DisplayBadge() {
  const room = useGameStore((s) => s.room);
  const [options, setOptions] = useState(false);
  if (!room) return null;
  const missing = room.seats.filter((s) => s.kind === "human" && !s.connected && !s.open);
  return (
    <div className="pointer-events-auto absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-[max(0.5rem,env(safe-area-inset-right))] z-30 flex max-w-sm flex-col items-end gap-1 font-mono text-[11px] text-white/70">
      {missing.length > 0 && (
        <p className="border border-amber-400/60 bg-amber-950/80 px-2 py-1 text-amber-100">
          Waiting for {missing.map((s) => s.name || `Seat ${s.index + 1}`).join(", ")} to join on their phone: {roomLink(room.id)}
        </p>
      )}
      {options && <div className="bg-black/80 p-2"><ArenaOptions compact /></div>}
      <span className="flex items-center gap-2 bg-black/60 px-2 py-1">
        🖥 Arena · room {room.id}
        <button className={`border px-1.5 ${options ? "border-yellow-400" : "border-white/20 hover:border-yellow-400"}`} onClick={() => setOptions(!options)} aria-expanded={options}>Board ⚙</button>
        <button className="border border-white/20 px-1.5 hover:border-yellow-400" onClick={() => stopDisplay(room.id)}>Play here instead</button>
      </span>
    </div>
  );
}
