import { useEffect, useRef, useState, type ReactNode } from "react";
import { SEAT_COLORS } from "@/const";
import { cardArt, cardName, catalogCard } from "@/game/catalog";
import { commitPicked, inspectCursorCard, inspectCursorTile, pointHand, press, stagedDefense, useInteraction, visibleHand, type Mode } from "@/game/interaction";
import type { InputAction } from "@/input/actions";
import type { GameView } from "@/net/protocol";
import { useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { session } from "@/net/session";
import { useWakeLock } from "@/hooks/useWakeLock";
import CardFace from "./CardFace";
import { VoiceButton } from "./Voice";
import { Countdown } from "./Hud";
import { StrengthChip } from "./GameOverlays";
import { buttonColor, hintsFor, terrainOf, trackBarHeight, type Hint } from "@/game/hints";

/**
 * A player's phone while an arena display shows the board: their hand, the
 * graveyards and the buttons, with no board of its own (no 3D at all, which
 * spares the battery). What is under the cursor shows here in small, and in
 * full with Inspect; the cursor itself, and what a picked-up piece may do,
 * light up on the display. Orders go to the server like any other: what it
 * accepts shows on the display, what it refuses buzzes and is said here.
 */
export default function Controller() {
  useWakeLock(true);
  const view = useGameStore((s) => s.view);
  const seat = useGameStore((s) => s.seat);
  if (!view) return null;
  const out = view.seats[seat] && !view.seats[seat].alive;

  return (
    <div className="absolute inset-0 z-10 flex select-none flex-col gap-2 bg-[radial-gradient(ellipse_at_top,#1c2a22,#050806_70%)] px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] font-mono text-white [touch-action:manipulation]">
      <Seats view={view} seat={seat} />
      <Notice />
      {out ? (
        <p className="m-auto max-w-xs text-center text-sm text-white/70">You are out of the duel. The rest of it plays on the arena display.</p>
      ) : (
        <>
          <Focus view={view} />
          <HandStrip view={view} />
          <Pad view={view} seat={seat} />
        </>
      )}
    </div>
  );
}

/** Every seat's life points, whose turn it is and how long is left of it. */
function Seats({ view, seat }: { view: GameView; seat: number; }) {
  const players = useGameStore((s) => s.players);
  const deadline = useGameStore((s) => s.deadline);
  const myTurn = view.phase === "playing" && view.turn === seat && !view.pending;
  return (
    <div className={`shrink-0 border p-2 text-xs ${myTurn ? "border-emerald-400/70 bg-emerald-950/60" : "border-white/15 bg-black/50"}`}>
      <div className="mb-1 flex items-center justify-between">
        <b className={myTurn ? "text-emerald-300" : "text-white/70"}>{myTurn ? "Your turn" : `${players[view.turn]?.name || `Seat ${view.turn + 1}`}'s turn`}</b>
        <span className="flex items-center gap-2">
          <Countdown deadline={deadline} />
          <button className="flex h-9 items-center border border-white/15 px-2 text-[10px] text-white/60" onClick={() => { if (confirm("Surrender this duel?")) session.send({ type: "concede" }); }}>⚑</button>
          <VoiceButton className="!h-9 !w-9" />
          <button className="flex h-9 w-9 items-center justify-center border border-white/20" onClick={() => useUIStore.getState().setShowControlPanel(true)} aria-label="Settings">⚙️</button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {view.seats.map((s) => (
          <span key={s.index} className={`flex min-w-0 items-center gap-1.5 ${s.alive ? "" : "opacity-40 line-through"}`}>
            <span className="h-2 w-2 shrink-0" style={{ background: SEAT_COLORS[s.index] }} />
            <span className={`truncate ${s.index === seat ? "font-bold text-yellow-200" : ""}`}>{players[s.index]?.name || `Seat ${s.index + 1}`}{s.index === seat && " (you)"}</span>
            <span className="ml-auto tabular-nums">{s.lp}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** What the server just refused, or anything else that went wrong, for a few seconds. */
function Notice() {
  const last = useGameStore((s) => s.log[s.log.length - 1]);
  const [shown, setShown] = useState<{ id: number; text: string; } | null>(null);
  useEffect(() => {
    if (!last || last.tone !== "bad") return;
    // Shown for a moment, then cleared: the log keeps it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown({ id: last.id, text: last.text });
    const timer = setTimeout(() => setShown((s) => (s?.id === last.id ? null : s)), 3500);
    return () => clearTimeout(timer);
  }, [last]);
  if (!shown) return null;
  return <p role="alert" className="shrink-0 border border-rose-400/60 bg-rose-950/80 px-3 py-1.5 text-xs text-rose-100">{shown.text}</p>;
}

/** What the current mode is about, in words, since the board it acts on is on the display. */
function modeLine(view: GameView, mode: Mode): string {
  switch (mode.kind) {
    case "card": {
      const card = view.cards.find((c) => c.id === mode.cardId);
      return `Holding ${card && !card.hidden ? cardName(card.num) : "your card"}: choose a lit square on the arena.`;
    }
    case "leader": return "Holding your deck leader: step to a lit square, or summon.";
    case "place": return "Summoning: choose a lit square next to your leader.";
    case "hand": return mode.target ? "Choose the card to play. Up marks cards to fuse." : "Your hand.";
    case "grave": return "Looking through the graveyards.";
    default: return "";
  }
}

/** The square under the cursor: its ground and whatever stands on it. Tap either for the details. */
function Focus({ view }: { view: GameView; }) {
  const cursor = useInteraction((s) => s.cursor);
  const mode = useInteraction((s) => s.mode);
  const half = Math.floor(view.size / 2);
  const terrain = terrainOf(view.tiles[(cursor.y + half) * view.size + (cursor.x + half)] ?? "normal");
  const card = view.cards.find((c) => c.x === cursor.x && c.y === cursor.y);
  const leader = view.seats.find((s) => s.alive && s.leaderX === cursor.x && s.leaderY === cursor.y && s.leaderNum >= 0);
  const num = card ? card.num : leader?.leaderNum;
  const name = card ? (card.hidden ? "Face-down card" : catalogCard(card.num)?.name ?? "Card") : leader ? "Deck leader" : "Nothing here";
  const line = modeLine(view, mode);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 border border-white/15 bg-black/40 p-2">
      <div className="flex min-h-0 flex-1 gap-2">
        <button onClick={inspectCursorTile} className="flex w-1/2 min-w-0 flex-col overflow-hidden border-2 border-yellow-700 bg-black text-left" aria-label={`${terrain.name} terrain: details`}>
          <img src={terrain.textureUrl} alt="" className="min-h-0 w-full flex-1 object-cover" draggable={false} />
          <span className="block truncate px-1.5 py-1 text-[11px] font-bold text-yellow-400">{terrain.name} <span className="font-normal text-white/40">({cursor.x}, {cursor.y})</span></span>
        </button>
        <button
          onClick={inspectCursorCard}
          disabled={num === undefined}
          className="flex w-1/2 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden border-2 border-yellow-700 bg-black p-1 disabled:border-white/10"
          aria-label={card ? "Card details" : leader ? "Deck leader details" : "No card here"}
        >
          {num !== undefined && !card ? <img src={cardArt(num).art} alt="" draggable={false} className="min-h-0 w-full flex-1 object-contain" />
            : num !== undefined ? <CardFace num={num} atk={card?.atk} def={card?.def} terrain={card?.terrain} className="max-h-full min-h-0 w-auto max-w-full flex-1 object-contain" /> : <span className="text-[11px] text-white/30">Empty square</span>}
          <span className="w-full truncate text-center text-[11px] text-white/70">{name}</span>
        </button>
      </div>
      <StrengthChip mode={mode} />
      {line && <p className="shrink-0 text-center text-[11px] text-sky-200">{line}</p>}
    </div>
  );
}

/** The hand, always in view. In the hand it moves the highlight; elsewhere a tap opens it. */
function HandStrip({ view }: { view: GameView; }) {
  const mode = useInteraction((s) => s.mode);
  const handIndex = useInteraction((s) => s.handIndex);
  const handSeat = useInteraction((s) => s.handSeat);
  const seat = useGameStore((s) => s.seat);
  const watch = useGameStore((s) => s.watch);
  const hand = visibleHand(view, seat, watch, handSeat);
  const me = view.seats[seat];
  const open = mode.kind === "hand";

  const tap = (index: number) => {
    if (!open) { press("HAND"); return; }
    // Only looking (not summoning): a second tap on the highlighted card inspects it.
    if (!mode.target && index === handIndex) { press("DETAILS"); return; }
    pointHand(index);
  };

  return (
    <div className={`shrink-0 border p-2 ${open ? "border-yellow-400/70 bg-yellow-950/30" : "border-white/15 bg-black/40"}`}>
      <div className="flex items-end gap-1">
        {hand.length === 0 && <p className="w-full py-4 text-center text-xs text-white/40">No cards in hand</p>}
        {hand.map((card, index) => {
          const def = catalogCard(card.num);
          const tooCostly = def?.kind === "monster" && (def.level ?? 0) > (me?.stars ?? 0);
          const picked = open && mode.picked.includes(card.id);
          const current = open && index === handIndex;
          return (
            <button key={card.id} onClick={() => tap(index)} className={`relative min-w-0 max-w-24 flex-1 basis-0 transition-transform ${current ? "-translate-y-2" : open ? "opacity-80" : ""}`}>
              <CardFace num={card.num} className={`w-full ${current ? "ring-4 ring-yellow-400" : ""} ${picked ? "ring-4 ring-emerald-400" : ""} ${tooCostly ? "grayscale" : ""}`} />
              {picked && open && <span className="absolute -top-2 right-0 bg-emerald-500 px-1 text-[10px] font-bold text-black">FUSE {mode.picked.indexOf(card.id) + 1}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[10px] text-white/50">★ {me?.stars ?? 0} summoning stars · {me?.playsLeft ? "1 card may be played this turn" : "no card play left this turn"}</p>
    </div>
  );
}

const REPEAT_DELAY = 320; // ms held before a direction starts repeating, as on a controller
const REPEAT_RATE = 110;

/** A d-pad button: one step on a tap, repeating while held. */
function Hold({ action, label, className }: { action: InputAction; label: string; className: string; }) {
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval>; }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        stop();
        press(action);
        timers.current.delay = setTimeout(() => { timers.current.repeat = setInterval(() => press(action), REPEAT_RATE); }, REPEAT_DELAY);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex items-center justify-center border border-white/25 bg-white/10 text-xl active:bg-yellow-700/70 ${className}`}
    >
      {label}
    </button>
  );
}

/** A face button: its glyph, and what it does right now (from the same hints as the action bar). */
function Face({ action, glyph, hints, color, className = "" }: { action: InputAction; glyph: string; hints: Hint[]; color: string; className?: string; }) {
  const text = hints.find(([a]) => a === action)?.[1];
  return (
    <button
      onClick={() => press(action)}
      className={`flex flex-col items-center justify-center border-2 leading-tight ${text ? color : "border-white/15 bg-black/50 text-white/40"} ${className}`}
    >
      <b className="text-lg">{glyph}</b>
      <span className="max-w-full truncate px-1 text-[9px]">{text ?? ""}</span>
    </button>
  );
}

function Small({ action, children, hints }: { action: InputAction; children: ReactNode; hints: Hint[]; }) {
  const text = hints.find(([a]) => a === action)?.[1];
  return (
    <button onClick={() => press(action)} className={`flex min-h-11 min-w-0 flex-1 items-center justify-center border px-1 text-[11px] ${text ? buttonColor(action, text) : "border-white/15 bg-black/50 text-white/60"}`}>
      <span className="truncate">{children}</span>
    </button>
  );
}

/** The buttons, laid out like a controller: d-pad on the left, A B X Y on the right. */
function Pad({ view, seat }: { view: GameView; seat: number; }) {
  const mode = useInteraction((s) => s.mode);
  const busy = useInteraction((s) => s.busy);
  const choosing = view.pending?.seat === seat;
  const myTurn = view.turn === seat && !view.pending;
  const hints = hintsFor(mode, choosing, stagedDefense(view, mode), myTurn);
  const staged = mode.kind === "card" && (mode.flip || mode.switchPosition);

  return (
    // Its height is the --bar-h the graveyard and choice panels sit above.
    <div ref={trackBarHeight} className={`flex shrink-0 flex-col gap-2 transition-opacity ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="grid h-36 w-36 shrink-0 grid-cols-3 grid-rows-3 gap-1">
          <Hold action="UP" label="▲" className="col-start-2 row-start-1" />
          <Hold action="LEFT" label="◀" className="col-start-1 row-start-2" />
          <Hold action="RIGHT" label="▶" className="col-start-3 row-start-2" />
          <Hold action="DOWN" label="▼" className="col-start-2 row-start-3" />
        </div>
        <div className="grid h-40 w-40 shrink-0 grid-cols-3 grid-rows-3">
          <Face action="HAND" glyph="Y" hints={hints} color="border-yellow-400 bg-yellow-800/80" className="col-start-2 row-start-1 h-14 w-14 justify-self-center" />
          <Face action="FLIP" glyph="X" hints={hints} color="border-sky-400 bg-sky-800/80" className="col-start-1 row-start-2 h-14 w-14 self-center" />
          <Face action="CANCEL" glyph="B" hints={hints} color="border-red-400 bg-red-800/80" className="col-start-3 row-start-2 h-14 w-14 self-center justify-self-end" />
          <Face action="CONFIRM" glyph="A" hints={hints} color="border-emerald-400 bg-emerald-800/80" className="col-start-2 row-start-3 h-14 w-14 justify-self-center self-end" />
        </div>
      </div>
      <div className="flex gap-1">
        <Small action="PREV" hints={hints}>◀ LB</Small>
        <Small action="GRAVE" hints={hints}>Grave</Small>
        <Small action="DETAILS" hints={hints}>Inspect</Small>
        <Small action="POSITION" hints={hints}>{hints.find(([a]) => a === "POSITION")?.[1] ?? "Atk/Def"}</Small>
        <Small action="NEXT" hints={hints}>RB ▶</Small>
      </div>
      {(staged || myTurn) && (
        <div className="flex gap-1">
          {staged && <button onClick={commitPicked} className="min-h-11 flex-1 border border-yellow-400/70 bg-yellow-900/70 text-xs font-bold">Confirm change</button>}
          {myTurn && <button onClick={() => press("END_TURN")} disabled={busy} className="min-h-11 flex-1 border border-green-500/60 bg-green-900/90 text-xs font-bold disabled:opacity-50">End turn</button>}
        </div>
      )}
    </div>
  );
}
