import { useEffect, useState } from "react";
import { useGameStore } from "@/stores/gameStore";
import { listReplays, type ReplayMeta } from "@/net/api";
import { closeReplay, describe, seek, setPlaying, setSpeed, SPEEDS, step, stepTurn, useReplayStore, watchReplay } from "@/net/replay";

const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-11";
const TEAM_TONES = ["text-rose-300", "text-sky-200"];

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The latest recorded duels, anyone's (or one account's), each a tap from watching. */
export function ReplayList({ user, limit = 10 }: { user?: string; limit?: number; }) {
  const [list, setList] = useState<ReplayMeta[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    listReplays(user).then((l) => live && setList(l)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [user]);

  if (error) return <p className="text-xs text-rose-300">{error}</p>;
  if (!list) return <p className="text-xs text-white/40">Loading…</p>;
  if (!list.length) return <p className="text-sm text-white/50">No recorded duels yet.</p>;
  return (
    <ul>
      {list.slice(0, limit).map((r) => {
        const teams = [0, 1].map((team) => r.players.filter((p) => p.team === team).map((p) => p.name).join(" & "));
        const result = !r.finished ? "unfinished" : r.winnerTeam < 0 ? "draw" : `${teams[r.winnerTeam]} won`;
        return (
          <li key={r.id} className="flex items-center justify-between gap-2 border-t border-white/10 py-2 text-sm">
            <span className="min-w-0">
              <span className={TEAM_TONES[0]}>{teams[0]}</span> <span className="text-white/40">vs</span> <span className={TEAM_TONES[1]}>{teams[1]}</span>
              <span className="block text-[11px] text-white/40">{r.mode} · {r.map || "generated map"} · {r.turns} turns · {result} · {ago(r.ended)}</span>
            </span>
            <button className={`${ghost} shrink-0`} onClick={() => watchReplay(r.id)}>▶ Watch</button>
          </li>
        );
      })}
    </ul>
  );
}

/** Shown while a replay loads, or when it could not be. */
export function ReplayLoading() {
  const loading = useReplayStore((s) => s.loading);
  const error = useReplayStore((s) => s.error);
  // Loaded, but the first board is still waiting on its cards' art.
  const loaded = useReplayStore((s) => s.doc !== null);
  const shown = useGameStore((s) => s.view !== null);
  const dealing = loaded && !shown;
  if (!loading && !error && !dealing) return null;
  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 font-mono text-white">
      <div className="border border-white/20 bg-zinc-900 px-6 py-5 text-center text-sm">
        {loading || dealing ? <p>Loading the replay…</p> : <p className="text-rose-300">{error}</p>}
        <button className={`${ghost} mt-4`} onClick={closeReplay}>Back</button>
      </div>
    </div>
  );
}

/**
 * Lifts everything that sits at the bottom of the duel's screen (the action
 * bar, the log, the hand) above the replay's controls, by setting --hud-bottom
 * to their height while they show.
 */
let liftObserver: ResizeObserver | null = null;
function liftHud(el: HTMLDivElement | null) {
  liftObserver?.disconnect();
  liftObserver = null;
  const root = document.documentElement.style;
  if (!el) { root.removeProperty("--hud-bottom"); return; }
  liftObserver = new ResizeObserver(() => root.setProperty("--hud-bottom", `calc(${el.offsetHeight}px + max(0.75rem, env(safe-area-inset-bottom)))`));
  liftObserver.observe(el);
}

/** The replay's controls, along the bottom of the board. */
export function ReplayBar() {
  const doc = useReplayStore((s) => s.doc);
  const index = useReplayStore((s) => s.index);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);

  // Arrow keys step, shift+arrows jump turns, space plays and pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") { if (e.shiftKey) stepTurn(1); else step(1); }
      else if (e.key === "ArrowLeft") { if (e.shiftKey) stepTurn(-1); else step(-1); }
      else if (e.key === " ") setPlaying(!useReplayStore.getState().playing);
      else if (e.key === "Escape") closeReplay();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!doc) return null;
  const last = doc.frames.length - 1;
  const state = doc.frames[index].state;
  const end = doc.end;
  const teams = [0, 1].map((team) => doc.room.seats.filter((s) => s.team === team).map((s) => s.name).join(" & "));
  const outcome = index === last && end.finished ? (end.winnerTeam < 0 ? "Draw" : `${teams[end.winnerTeam]} won`) : index === last ? "The duel was never finished" : "";
  const btn = "flex h-9 min-w-9 items-center justify-center border border-white/20 bg-black/60 px-2 text-sm hover:border-yellow-400 disabled:opacity-30 pointer-coarse:h-11 pointer-coarse:min-w-11";

  return (
    <div ref={liftHud} className="absolute inset-x-[max(0.375rem,env(safe-area-inset-left))] bottom-[max(0.375rem,env(safe-area-inset-bottom))] z-40 mx-auto flex flex-col gap-2 border border-white/20 bg-black/85 p-2 font-mono text-xs text-white sm:max-w-2xl">
      <div className="flex items-center gap-2">
        <span className="shrink-0 bg-fuchsia-700/80 px-1.5 py-0.5 text-[10px] font-bold">REPLAY</span>
        <span className="min-w-0 flex-1 truncate">{outcome || describe(doc, index)}</span>
        <span className="shrink-0 text-white/50">round {state.round ?? state.turnCount} · {index + 1}/{last + 1}</span>
      </div>
      <input
        type="range" min={0} max={last} value={index} aria-label="Step"
        className="w-full accent-yellow-400"
        onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
      />
      <div className="flex items-center gap-1">
        <button className={btn} title="Previous turn (shift + ←)" disabled={index === 0} onClick={() => stepTurn(-1)}>⏮</button>
        <button className={btn} title="Previous step (←)" disabled={index === 0} onClick={() => step(-1)}>◀</button>
        <button className={`${btn} min-w-14 font-bold`} title="Play / pause (space)" onClick={() => setPlaying(!playing)}>{playing ? "⏸" : "▶"}</button>
        <button className={btn} title="Next step (→)" disabled={index === last} onClick={() => step(1)}>▶︎|</button>
        <button className={btn} title="Next turn (shift + →)" disabled={index === last} onClick={() => stepTurn(1)}>⏭</button>
        <select className="h-9 border border-white/20 bg-black/60 px-1 pointer-coarse:h-11" value={speed} aria-label="Speed" onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <button className={`${btn} ml-auto`} title="Leave the replay (esc)" onClick={closeReplay}>✕ Exit</button>
      </div>
    </div>
  );
}
