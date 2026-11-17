import { useCallback, useEffect, useState } from "react";
import { getArena, startArena, stopArena, type ArenaJob, type ArenaKind, type ArenaSide, type ArenaSpec } from "@/net/api";
import { poll } from "@/net/poll";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0  border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-fuchsia-300";
const label = "flex min-w-0 flex-col gap-1 text-[11px] text-white/60";

type Notice = { text: string; bad?: boolean; } | null;

const money = (usd: number) => (usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
const isLLM = (kind: string) => kind.startsWith("llm:");

/**
 * Test games between computer players, run on the server many at a time:
 * the rule-based bot against an LLM, one personality against another, and
 * what the LLM's calls cost. Games come in mirrored pairs (same decks and
 * map, sides swapped), so an even number of games is fairest.
 */
export default function ArenaPanel({ token, onNotice }: { token: string; onNotice: (notice: Notice) => void; }) {
  const [kinds, setKinds] = useState<ArenaKind[] | null>(null);
  const [jobs, setJobs] = useState<ArenaJob[]>([]);
  const [spec, setSpec] = useState<ArenaSpec>({ a: "bot", b: "bot", games: 20, parallel: 4, mode: "1v1", budgetUsd: 1 });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () => getArena(token).then((r) => {
      setKinds(r.kinds);
      setJobs(r.jobs);
      // Untouched form: put the cheapest LLM on side B, if there is one.
      const llm = r.kinds.find((k) => k.model && k.id.includes("haiku")) ?? r.kinds.find((k) => k.model);
      if (llm) setSpec((s) => (s.a === "bot" && s.b === "bot" ? { ...s, b: llm.id } : s));
    }).catch((e: Error) => onNotice({ text: e.message, bad: true })),
    [token, onNotice],
  );
  const running = jobs.some((j) => j.status === "running");
  // Every 5 s while a job runs; otherwise only now and after a change.
  useEffect(() => (running ? poll(refresh, 5000) : (refresh(), undefined)), [running, refresh]);

  const start = async () => {
    setBusy(true);
    onNotice(null);
    try {
      await startArena(token, spec);
      await refresh();
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
    setBusy(false);
  };

  const stop = async (job: ArenaJob) => {
    onNotice(null);
    try {
      await stopArena(token, job.id);
      await refresh();
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
  };

  const usesLLM = isLLM(spec.a) || isLLM(spec.b);
  const priceOf = (id: string) => kinds?.find((k) => k.id === id)?.model;
  const set = (patch: Partial<ArenaSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const kindSelect = (value: string, onChange: (v: string) => void) => (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      {kinds?.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
    </select>
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-bold text-fuchsia-200">
        Arena <span className="text-xs font-normal text-white/60">· test games between bots and LLMs, played on the server</span>
      </h2>

      <form
        className="grid grid-cols-2 gap-2 border border-fuchsia-400/30 bg-black/75 p-3 sm:grid-cols-6"
        onSubmit={(e) => { e.preventDefault(); start(); }}
      >
        <label className={`${label} col-span-2 sm:col-span-2`}>Side A{kindSelect(spec.a, (a) => set({ a }))}</label>
        <label className={`${label} col-span-2 sm:col-span-2`}>Side B{kindSelect(spec.b, (b) => set({ b }))}</label>
        <label className={label}>
          Mode
          <select className={input} value={spec.mode} onChange={(e) => set({ mode: e.target.value as ArenaSpec["mode"] })}>
            <option value="1v1">1v1</option>
            <option value="2v2">2v2</option>
          </select>
        </label>
        <label className={label}>
          Games
          <input className={input} type="number" min={1} max={200} value={spec.games} onChange={(e) => set({ games: Number(e.target.value) })} />
        </label>
        <label className={label}>
          At once
          <input className={input} type="number" min={1} max={16} value={spec.parallel} onChange={(e) => set({ parallel: Number(e.target.value) })} />
        </label>
        <label className={label}>
          Budget (USD)
          <input
            className={input} type="number" min={0.01} step={0.25} disabled={!usesLLM}
            value={spec.budgetUsd} onChange={(e) => set({ budgetUsd: Number(e.target.value) })}
          />
        </label>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-4">
          <p className="min-w-0 flex-1 text-[11px] text-white/50">
            {[spec.a, spec.b].filter(isLLM).map((id) => {
              const m = priceOf(id);
              return m ? <span key={id} className="mr-3">{m.label}: ${m.inputPerM}/M in · ${m.outputPerM}/M out</span> : null;
            })}
            {usesLLM ? "The job stops when the budget is spent." : "Rule-based games are free and finish in seconds."}
            {spec.games % 2 === 1 && " An even number of games keeps the mirrored pairs complete."}
          </p>
          <button type="submit" className={`${small} border-fuchsia-300/60 text-fuchsia-100`} disabled={busy || !kinds}>
            ▶ Run games
          </button>
        </div>
      </form>

      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onStop={() => stop(job)} onAgain={() => setSpec(job.spec)} />
        ))}
        {kinds && jobs.length === 0 && <li className="text-sm text-white/50">No test jobs yet.</li>}
      </ul>
    </section>
  );
}

function JobCard({ job, onStop, onAgain }: { job: ArenaJob; onStop: () => void; onAgain: () => void; }) {
  const [a, b] = job.sides;
  const finished = job.games.filter((g) => g.status === "done");
  const playing = job.games.filter((g) => g.status === "playing").length;
  const decided = a.wins + b.wins;
  // Share of decided games A won, with a rough 95% margin.
  const rate = decided ? a.wins / decided : 0;
  const margin = decided ? 1.96 * Math.sqrt((rate * (1 - rate)) / decided) : 0;
  const avg = (f: (g: ArenaJob["games"][number]) => number) => (finished.length ? finished.reduce((t, g) => t + f(g), 0) / finished.length : 0);
  const firstWins = finished.filter((g) => (g.winner === "A") === g.aFirst && g.winner !== "draw").length;
  const state = job.status === "running" ? `running · ${playing} playing` : job.status === "stopped" ? `stopped: ${job.stopped}` : "done";

  return (
    <li className="flex flex-col gap-2 border border-white/15 bg-black/75 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate font-bold text-yellow-200">
          {a.label} <span className="font-normal text-white/50">vs</span> {b.label}
          <span className="ml-2 text-xs font-normal text-white/60">{job.spec.mode} · {state}</span>
        </p>
        <button className={small} onClick={onAgain} title="Copy these settings into the form">↺ Same again</button>
        <button className={`${small} border-rose-400/60 text-rose-200 hover:border-rose-300`} onClick={onStop}>
          {job.status === "running" ? "Stop" : "Remove"}
        </button>
      </div>

      {/* Progress and score. */}
      <div className="flex h-2 overflow-hidden bg-white/10" title={`${job.done} of ${job.spec.games} games finished`}>
        <div className="bg-sky-400" style={{ width: `${(a.wins / job.spec.games) * 100}%` }} />
        <div className="bg-white/40" style={{ width: `${(job.draws / job.spec.games) * 100}%` }} />
        <div className="bg-orange-400" style={{ width: `${(b.wins / job.spec.games) * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-sky-300">A {a.wins}</span>
        <span className="text-white/60">draws {job.draws}</span>
        <span className="text-orange-300">B {b.wins}</span>
        <span className="text-white/60">{job.done}/{job.spec.games} finished</span>
        {decided > 0 && (
          <span className="text-white/80">
            A wins {(rate * 100).toFixed(0)}% ± {(margin * 100).toFixed(0)}
            {decided < 30 && <span className="text-white/40"> (few games: noisy)</span>}
          </span>
        )}
        {finished.length > 0 && (
          <span className="text-white/60">
            avg {avg((g) => g.turns).toFixed(0)} turns · {avg((g) => g.seconds).toFixed(1)} s · first mover won {firstWins}/{finished.length}
          </span>
        )}
        {job.costUsd > 0 && (
          <span className="text-emerald-300">
            {money(job.costUsd)}{job.spec.budgetUsd > 0 && ` of ${money(job.spec.budgetUsd)}`}
          </span>
        )}
      </div>

      {[a, b].map((side, i) => side.usage && <UsageLine key={i} side={side} name={i ? "B" : "A"} games={finished.length} />)}

      <details className="text-xs">
        <summary className="cursor-pointer text-white/60 hover:text-white">Games</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="text-white/50">
              <tr><th className="pr-2">#</th><th className="pr-2">state</th><th className="pr-2">winner</th><th className="pr-2">first</th><th className="pr-2">turns</th><th className="pr-2">LP A / B</th><th className="pr-2">decks A / B</th><th>time</th></tr>
            </thead>
            <tbody>
              {job.games.map((g) => (
                <tr key={g.n} className="border-t border-white/10 align-top">
                  <td className="pr-2 text-white/50">{g.n}</td>
                  <td className="pr-2">{g.status}{g.error && <span className="text-rose-300"> · {g.error}</span>}</td>
                  <td className={`pr-2 ${g.winner === "A" ? "text-sky-300" : g.winner === "B" ? "text-orange-300" : ""}`} title={g.reason}>{g.winner ?? ""}</td>
                  <td className="pr-2">{g.aFirst ? "A" : "B"}</td>
                  <td className="pr-2">{g.status === "queued" ? "" : g.turns}</td>
                  <td className="pr-2">{g.status === "done" || g.status === "error" ? `${g.lpA} / ${g.lpB}` : ""}</td>
                  <td className="max-w-56 truncate pr-2 text-white/60" title={`${g.deckA} / ${g.deckB}`}>{g.deckA && `${g.deckA} / ${g.deckB}`}</td>
                  <td>{g.seconds ? `${g.seconds.toFixed(1)} s` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {job.games.some((g) => g.said?.length) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-white/60 hover:text-white">What the LLM said</summary>
          <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {job.games.filter((g) => g.said?.length).map((g) => (
              <div key={g.n}>
                <p className="text-white/50">Game {g.n}{g.winner && ` · ${g.winner === "draw" ? "draw" : `${g.winner} won`}`}</p>
                {g.said!.map((line, i) => <p key={i} className="text-white/80">{line}</p>)}
              </div>
            ))}
          </div>
        </details>
      )}
    </li>
  );
}

/** What an LLM side spent: calls, tokens, fallbacks and money, with a projection per 100 games. */
function UsageLine({ side, name, games }: { side: ArenaSide; name: string; games: number; }) {
  const u = side.usage!;
  const per = (n: number) => (u.calls ? Math.round(n / u.calls) : 0);
  const perGame = games ? side.costUsd / games : 0;
  return (
    <p className="text-[11px] text-white/60">
      <span className="text-white/80">{name} · {side.label}:</span> {u.calls} calls
      {u.fallbacks > 0 && <span className="text-amber-300"> · {u.fallbacks} fell back to the rule-based move ({((u.fallbacks / Math.max(u.calls, 1)) * 100).toFixed(0)}%)</span>}
      {" · "}~{per(u.input + u.cacheRead + u.cacheWrite).toLocaleString()} in / {per(u.output).toLocaleString()} out tokens per call
      {" · "}<span className="text-emerald-300">{money(side.costUsd)}</span>
      {games > 0 && <> · {money(perGame)} per game · ≈{money(perGame * 100)} per 100 games</>}
    </p>
  );
}
