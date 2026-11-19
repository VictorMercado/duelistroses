import { useEffect, useRef, useState } from "react";
import { selectCanPause, selectPerspective, useGameStore } from "@/stores/gameStore";
import { session } from "@/net/session";
import { useReplaying } from "@/net/replay";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import TestTools from "@/components/ui/TestTools";
import { SEAT_COLORS } from "@/const";
import { canWatchFrom, inspectLeader, pointGraveyard, watchFrom } from "@/game/interaction";
import { cardArt, catalogCard } from "@/game/catalog";
import { GRADIENT_ENEMY, GRADIENT_MINE } from "./GameOverlays";

export function Countdown({ deadline }: { deadline: number; }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={`tabular-nums ${seconds <= 10 ? "text-red-400" : "text-white/70"}`}>{seconds}s</span>;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Life points as shown: when they change, the number runs quickly to the new
 * total instead of jumping, and each loss is listed so it can float over it.
 */
function useLifePoints(lp: number) {
  const [shown, setShown] = useState(lp);
  const [hits, setHits] = useState<{ id: number; amount: number; }[]>([]);
  const shownRef = useRef(lp);
  const target = useRef(lp);
  const nextId = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const lost = target.current - lp;
    target.current = lp;
    if (lost > 0) setHits((h) => [...h, { id: nextId.current++, amount: lost }]);
    if (from === lp) return;
    const set = (value: number) => { shownRef.current = value; setShown(value); };
    if (reducedMotion()) { set(lp); return; }

    // Bigger swings take a little longer, but never drag.
    const duration = Math.min(900, 350 + Math.abs(lp - from) / 4);
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      set(Math.round(from + (lp - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [lp]);

  const done = (id: number) => setHits((h) => h.filter((x) => x.id !== id));
  return { shown, hits, done, counting: shown !== lp };
}

/**
 * The team on the left of the top bar, in green; the other is on the right, in
 * red. A player's own team. Watching (a spectator, a replay), always the first
 * seat's: switching whose side we watch from turns the board, never the bar.
 */
const selectLeftTeam = (s: ReturnType<typeof useGameStore.getState>) =>
  s.view?.seats[s.seat >= 0 ? s.seat : 0]?.team;

type SeatView = NonNullable<ReturnType<typeof useGameStore.getState>["view"]>["seats"][number];

/** One duelist: deck leader, name, life points, stars, cards. The panel of whoever is playing glows and says so. */
function SeatPanel({ s, align }: { s: SeatView; align: "left" | "right"; }) {
  const view = useGameStore((st) => st.view)!;
  const room = useGameStore((st) => st.room)!;
  const seat = useGameStore((st) => st.seat);
  const perspective = useGameStore(selectPerspective);
  const homeTeam = useGameStore(selectLeftTeam);
  const info = room.seats[s.index];
  const active = view.turn === s.index && view.phase === "playing";
  const friendly = s.team === homeTeam;
  const mine = s.index === seat;
  const life = useLifePoints(s.lp);
  const onField = view.cards.reduce((n, c) => n + (c.owner === s.index ? 1 : 0), 0);
  const leader = s.leaderNum >= 0 ? catalogCard(s.leaderNum) : undefined;
  const right = align === "right";
  // Watching: tap a duelist's panel to watch from their side (see watchFrom).
  // Its own buttons (deck leader, graveyard) keep their taps.
  useGameStore((st) => st.watch); // re-render when the side we watch from changes
  const switchable = canWatchFrom(s.index);
  const name = info?.name || `Seat ${s.index + 1}`;

  return (
    <div
      onClick={switchable ? (e) => { if (!(e.target as HTMLElement).closest("button")) watchFrom(s.index); } : undefined}
      role={switchable ? "button" : undefined}
      tabIndex={switchable ? 0 : undefined}
      onKeyDown={switchable ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); watchFrom(s.index); } } : undefined}
      title={switchable ? `Watch from ${name}'s side` : undefined}
      aria-label={switchable ? `Watch from ${name}'s side` : undefined}
      className={`flex min-w-0 items-center gap-1.5 border max-sm:flex-1 px-1.5 py-1 sm:w-44 lg:w-60 ${switchable ? "cursor-pointer hover:brightness-125 active:brightness-150" : ""} ${right ? "flex-row-reverse text-right" : ""} ${friendly ? GRADIENT_MINE : GRADIENT_ENEMY} ${!s.alive ? "border-white/10 opacity-40" : active ? "border-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.35)]" : "border-yellow-600/80"}`}
    >
      {/* The deck leader: its rank, then its portrait (tap it for the full card). */}
      {leader && (
        <div className="flex shrink-0 flex-col items-center leading-none">
          <span
            className="mb-0.5 text-[9px] font-bold text-yellow-200"
            title="Deck leader rank: destroy enemy monsters to rank up. Higher ranks make a Destiny Draw likelier once you are down to half your life points."
          >
            R{s.rank ?? 1}
          </span>
          <button
            onClick={() => inspectLeader(s.index)}
            className={`size-8 overflow-hidden border-2 bg-black sm:size-9 lg:size-10 ${friendly ? "border-sky-400/70" : "border-rose-400/70"}`}
            title={`Deck leader: ${leader.name}`}
            aria-label={`Deck leader: ${leader.name}`}
          >
            <img src={cardArt(s.leaderNum).art} alt="" draggable={false} className="size-full object-cover" />
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className={`flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          {/* The colour of this duelist's badges on the board. */}
          <span className="inline-block size-2.5 shrink-0 border border-black/40" style={{ backgroundColor: SEAT_COLORS[s.index] }} aria-hidden />
          <span className={`min-w-0 truncate font-bold ${friendly ? "text-sky-300" : "text-rose-300"}`}>
            {info?.name || `Seat ${s.index + 1}`}{mine && " (you)"}{seat < 0 && s.index === perspective && " (watching)"}
          </span>
          {info?.kind === "human" && !info.connected && <span className="shrink-0 text-red-400">offline</span>}
          {active && (
            <span className={`shrink-0 px-1 text-[9px] font-bold ${right ? "mr-auto" : "ml-auto"} ${mine ? "bg-green-500 text-black" : "bg-yellow-400 text-black"}`}>
              TURN
            </span>
          )}
        </div>
        <div className={`flex items-baseline justify-between gap-2 ${right ? "flex-row-reverse" : ""}`}>
          <span className="relative text-sm font-bold tabular-nums">
            <span className={`transition-colors ${life.counting && life.shown > s.lp ? "text-red-400" : ""}`}>{life.shown}</span>{" "}
            <span className="text-[10px] font-normal text-white/60">LP</span>
            {life.hits.map((h) => (
              <span
                key={h.id}
                onAnimationEnd={() => life.done(h.id)}
                className={`lp-hit pointer-events-none absolute bottom-full z-10 font-black text-red-500 [text-shadow:0_0_6px_rgba(0,0,0,0.9),0_1px_0_#000] text-base sm:text-lg ${right ? "right-0" : "left-0"}`}
              >
                -{h.amount}
              </span>
            ))}
          </span>
          <span className="text-yellow-300" title="Summoning stars">★{s.stars}/{view.maxStars}</span>
        </div>
        <div className={`flex items-center gap-1 text-[10px] text-white/60 ${right ? "justify-end" : ""}`}>
          <span className="truncate">field {onField} ·</span>
          {/* Graveyards are public: tap to look through this one. */}
          <button className="shrink-0 underline decoration-dotted underline-offset-2 hover:text-yellow-300 pointer-coarse:-my-1 pointer-coarse:py-1" onClick={() => pointGraveyard(s.index)}>
            grave {s.graveyard.length}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The top of the screen during a duel: the duelists on either side, and the
 * turn count, clock and connection between them.
 */
export default function Hud() {
  const view = useGameStore((s) => s.view);
  const room = useGameStore((s) => s.room);
  const seat = useGameStore((s) => s.seat);
  const deadline = useGameStore((s) => s.deadline);
  const latency = useGameStore((s) => s.latency);
  const status = useGameStore((s) => s.status);
  const myTeam = useGameStore(selectLeftTeam);
  const user = useSessionStore((s) => s.user);
  // A replay is only watched: no pausing, ending or reconnecting (there is no room behind it).
  const replaying = useReplaying();
  const canPause = useGameStore((s) => selectCanPause(s, user)) && !replaying;
  if (!view || !room) return null;
  // A duel nobody plays can be ended by whoever set it up, or an administrator (see Room.endBotsDuel).
  const canEnd = !replaying && seat < 0 && room.seats.every((s) => s.kind === "bot") && !!user && (room.hostId === user.id || !!user.admin);

  // Our team on the left of the clock, theirs on the right (2v2 stacks two per side).
  // Spectators see the team of the seat they watch through on the left. With more
  // than two teams (a free-for-all), half the seats go on each side.
  const teams = new Set(view.seats.map((s) => s.team));
  const half = Math.ceil(view.seats.length / 2);
  const [left, right] = teams.size === 2 && myTeam !== undefined
    ? [view.seats.filter((s) => s.team === myTeam), view.seats.filter((s) => s.team !== myTeam)]
    : [view.seats.slice(0, half), view.seats.slice(half)];
  const offline = !replaying && (status === "closed" || status === "reconnecting");
  // On phones and tablets the settings gear sits in the row under your own side (the one you
  // watch from, when spectating). Desktops have room for it in the screen's top-right corner (App).
  // Watching, the gear stays on the left with the green side, whoever we watch from.
  const own = seat >= 0 ? seat : left[0]?.index;
  const ownLeft = left.some((s) => s.index === own);
  const ownRight = right.some((s) => s.index === own);
  const gear = (
    <button
      onClick={() => useUIStore.getState().setShowControlPanel(true)}
      className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center border border-white/20 bg-black/80 text-sm hover:border-yellow-500 lg:hidden"
      title="Settings"
      aria-label="Settings"
    >
      ⚙️
    </button>
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-1 py-1.5 pl-[max(0.375rem,env(safe-area-inset-left))] pr-[max(0.375rem,env(safe-area-inset-right))] pt-(--hud-top) font-mono text-xs text-white sm:px-2">
      {/* The duel at a glance: our side, the clock card, their side, all one height. */}
      <div className="flex items-stretch justify-center gap-1.5 sm:gap-2">
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col gap-1 sm:flex-none sm:flex-row">
          {left.map((s) => <SeatPanel key={s.index} s={s} align="left" />)}
        </div>
        <div className="pointer-events-auto flex shrink-0">
          {/* The clock card. In a duel against computer players it is the pause button too: tap to pause, tap again to play. */}
          {(() => {
            const pausable = canPause && view.phase === "playing";
            const paused = pausable && room.paused;
            const body = (
              <>
                <span className="text-[10px] uppercase text-white/50">{view.phase === "finished" ? "over" : "round"}</span>
                <span className="text-sm font-bold tabular-nums">{view.round ?? view.turnCount}</span>
                <Countdown deadline={deadline} />
                <span className="text-[10px] text-white/40 max-sm:hidden" title="Round trip to the game server">
                  {status === "open" ? (latency === null ? "…" : `${latency}ms`) : status}
                </span>
                {paused && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/75 text-2xl font-black text-yellow-300" aria-hidden>
                    ❚❚
                  </span>
                )}
              </>
            );
            const card = `relative flex min-w-12 flex-col items-center justify-center gap-0.5  border bg-black/70 px-2 py-1 text-center leading-tight ${paused ? "border-yellow-400" : "border-white/15"}`;
            return pausable ? (
              <button
                className={`${card} cursor-pointer hover:border-yellow-400 active:scale-95`}
                title={paused ? "Resume the duel" : "Pause the duel"}
                aria-label={paused ? "Resume the duel" : "Pause the duel"}
                aria-pressed={paused}
                onClick={() => session.pause(!paused)}
              >
                {body}
              </button>
            ) : (
              <div className={card}>{body}</div>
            );
          })()}
        </div>
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col gap-1 sm:flex-none sm:flex-row">
          {right.map((s) => <SeatPanel key={s.index} s={s} align="right" />)}
        </div>
      </div>

      {/* Underneath: settings on your side, surrender (and the like) in the middle, the test tools on the right. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1.5 sm:gap-2">
        <div className="flex justify-start">{ownLeft && gear}</div>
        <div className="pointer-events-auto flex flex-col items-center gap-1 whitespace-nowrap">
          {offline && (
            <button className="bg-yellow-600 px-2 py-0.5 font-bold text-black hover:bg-yellow-500 pointer-coarse:py-1.5" onClick={() => session.reconnect()}>Reconnect</button>
          )}
          {canEnd && view.phase === "playing" && (
            <button className="border border-white/15 bg-black/70 px-2 py-0.5 text-[10px] text-white/60 hover:text-red-400 pointer-coarse:py-1" title="Stop this duel between computer players and close the room" onClick={() => { if (confirm("End this duel for everyone watching?")) session.endBotsDuel(); }}>■ end duel</button>
          )}
          {seat >= 0 && view.seats[seat]?.alive && view.phase === "playing" && (
            <button className="border border-white/15 bg-black/70 px-2 py-0.5 text-[10px] text-white/60 hover:border-red-400 hover:text-red-400 pointer-coarse:py-1" title={`Surrender (room ${room.id})`} onClick={() => { if (confirm("Surrender this duel?")) session.send({ type: "concede" }); }}>⚑ surrender</button>
          )}
        </div>
        <div className="pointer-events-auto flex items-start justify-end gap-1.5">
          <TestTools inHud />
          {ownRight && gear}
        </div>
      </div>
    </div>
  );
}
