import { useCallback, useEffect, useMemo, useState } from "react";
import { catalogCard, ensureCatalog } from "@/game/catalog";
import { getDeckAssistOverview, setDeckAssistPlayerModel, type DeckAssistEntry, type DeckAssistOverview, type DeckAssistStats } from "@/net/api";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0 border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-fuchsia-300";

type Notice = { text: string; bad?: boolean; } | null;

const PERIODS = [1, 7, 30, 90, 365];
const money = (usd: number) => (usd === 0 ? "$0" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const short = (model: string) => model.replace(/^claude-/, "");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The deck assistant's record: how each Claude model does at building decks
 * (how often it hands back a legal deck, how many tries the rules refused,
 * how many fusions its decks hold) against what it costs and how long it
 * takes, every message sent with its cost, and the model players get.
 */
export default function DeckAIPanel({ token, onNotice }: { token: string; onNotice: (notice: Notice) => void; }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DeckAssistOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by Refresh to fetch again.
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getDeckAssistOverview(token, days)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && onNotice({ text: e.message, bad: true }))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [token, days, tick, onNotice]);
  const load = useCallback(() => { setLoading(true); setTick((t) => t + 1); }, []);
  // Card names in the deck lists.
  useEffect(() => { ensureCatalog().catch(() => { }); }, []);

  const choosePlayerModel = async (model: string) => {
    try {
      await setDeckAssistPlayerModel(token, model);
      setData((d) => d && { ...d, playerModel: model });
      onNotice({ text: `Players now get ${short(model)} for new deck assistant chats.` });
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
  };

  const log = useMemo(() => (data?.log ?? []).filter((e) => !filter || e.model === filter), [data, filter]);
  const totals = useMemo(() => {
    const s = data?.stats ?? [];
    return { queries: s.reduce((n, x) => n + x.queries, 0), cost: s.reduce((n, x) => n + x.totalCostUsd, 0) };
  }, [data]);

  if (data && !data.available) {
    return <p className="text-sm text-white/60">The deck assistant needs Anthropic credentials on the server (ANTHROPIC_API_KEY).</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          Players get
          <select className={input} value={data?.playerModel ?? ""} disabled={!data} onChange={(e) => choosePlayerModel(e.target.value)}>
            {data?.models.map((m) => (
              <option key={m.id} value={m.id}>
                Claude {m.label} · {m.note}{m.id === data.defaultModel ? " (server default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-white/40">You pick a model per chat in the deck builder.</span>
        <span className="ml-auto flex items-center gap-2">
          <select className={input} value={days} onChange={(e) => { setLoading(true); setDays(Number(e.target.value)); }} aria-label="Period">
            {PERIODS.map((d) => <option key={d} value={d}>last {d === 1 ? "24 hours" : `${d} days`}</option>)}
          </select>
          <button className={small} disabled={loading} onClick={load}>{loading ? "Loading…" : "Refresh"}</button>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-fuchsia-200">
          Models <span className="font-normal text-white/50">· {totals.queries} messages · {money(totals.cost)} spent</span>
        </h3>
        {data && data.stats.length === 0 && <p className="text-sm text-white/50">No messages in this period yet.</p>}
        {data && data.stats.length > 0 && <StatsTable stats={data.stats} onPick={(m) => setFilter((f) => (f === m ? "" : m))} picked={filter} />}
        <p className="text-[11px] text-white/40">
          <b>Gave a deck</b>: messages answered with at least one legal deck (some messages are questions, not requests).
          <b> Refused tries</b>: decks the rules checker refused before Claude got one right. <b>Fusions</b>: pairs of cards in a proposed deck that fuse.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-fuchsia-200">Messages</h3>
          <select className={`${input} text-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Only this model">
            <option value="">All models</option>
            {data?.stats.map((s) => <option key={s.model} value={s.model}>{short(s.model)}</option>)}
          </select>
          <span className="text-xs text-white/40">newest 200 · tap one for the full exchange</span>
        </div>
        <div className="flex flex-col border border-white/15 bg-black/75">
          {log.length === 0 && <p className="p-3 text-sm text-white/50">Nothing here.</p>}
          {log.map((e) => <LogRow key={e.id} entry={e} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />)}
        </div>
      </div>
    </section>
  );
}

function StatsTable({ stats, onPick, picked }: { stats: DeckAssistStats[]; onPick: (model: string) => void; picked: string; }) {
  // Bars compare models on cost and time.
  const maxCost = Math.max(...stats.map((s) => s.avgCostUsd), 1e-9);
  const maxTime = Math.max(...stats.map((s) => s.avgSeconds), 1e-9);
  const bar = (value: number, max: number, color: string) => (
    <span className="mt-0.5 block h-1 bg-white/10"><span className={`block h-1 ${color}`} style={{ width: `${(value / max) * 100}%` }} /></span>
  );
  const th = "px-2 py-1 text-left font-normal text-white/50";
  const td = "px-2 py-1 align-top tabular-nums";
  return (
    <div className="overflow-x-auto border border-white/15 bg-black/75">
      <table className="w-full min-w-[56rem] text-xs">
        <thead className="border-b border-white/15">
          <tr>
            <th className={th}>Model</th><th className={th}>Messages</th><th className={th}>Gave a deck</th><th className={th}>Decks</th>
            <th className={th}>Refused tries / msg</th><th className={th}>Fusions / deck</th><th className={th}>Avg cost</th>
            <th className={th}>Cost / deck</th><th className={th}>Avg time</th><th className={th}>API calls</th>
            <th className={th}>Output tokens</th><th className={th}>Cache hit</th><th className={th}>Failed</th><th className={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.model} className={`cursor-pointer border-t border-white/10 hover:bg-white/5 ${picked === s.model ? "bg-fuchsia-950/40" : ""}`} onClick={() => onPick(s.model)} title="Show only this model's messages">
              <td className={`${td} font-bold text-fuchsia-200`}>{short(s.model)}</td>
              <td className={td}>{s.queries}</td>
              <td className={td}>{pct(s.withDeck / s.queries)} <span className="text-white/40">({s.withDeck})</span></td>
              <td className={td}>{s.decks}</td>
              <td className={td}>{(s.refusals / s.queries).toFixed(1)}</td>
              <td className={td}>{s.decks ? s.avgFusionsPerDeck.toFixed(1) : "—"}</td>
              <td className={td}>{money(s.avgCostUsd)}{bar(s.avgCostUsd, maxCost, "bg-emerald-400")}</td>
              <td className={td}>{s.decks ? money(s.avgCostPerDeckUsd) : "—"}</td>
              <td className={td}>{s.avgSeconds.toFixed(1)}s{bar(s.avgSeconds, maxTime, "bg-sky-400")}</td>
              <td className={td}>{s.avgCalls.toFixed(1)}</td>
              <td className={td}>{Math.round(s.avgOutputTokens).toLocaleString()}</td>
              <td className={td}>{pct(s.cacheHitRate)}</td>
              <td className={`${td} ${s.failed ? "text-rose-300" : ""}`}>{s.failed}</td>
              <td className={td}>{money(s.totalCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogRow({ entry: e, open, onToggle }: { entry: DeckAssistEntry; open: boolean; onToggle: () => void; }) {
  const u = e.usage;
  return (
    <div className="border-t border-white/10 first:border-t-0">
      <button className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left text-xs hover:bg-white/5" onClick={onToggle} aria-expanded={open}>
        <span className="w-28 shrink-0 text-white/50">{when(e.at)}</span>
        <span className="w-24 shrink-0 truncate">{e.userName || e.userId}</span>
        <span className="w-24 shrink-0 text-fuchsia-200">{short(e.model)}</span>
        <span className="min-w-0 flex-1 truncate text-white/80">{e.message}</span>
        <span className={e.proposals.length ? "text-emerald-300" : "text-white/40"}>{e.proposals.length ? `${e.proposals.length} deck${e.proposals.length > 1 ? "s" : ""}` : "no deck"}</span>
        {e.refusals > 0 && <span className="text-yellow-300">{e.refusals} refused</span>}
        <span className="w-14 text-right tabular-nums">{money(e.costUsd)}</span>
        <span className="w-12 text-right tabular-nums text-white/50">{(e.durationMs / 1000).toFixed(1)}s</span>
        {e.error && <span className="text-rose-300">failed</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-white/10 bg-black/40 px-3 py-2 text-xs">
          <p className="whitespace-pre-wrap"><b className="text-white/50">Asked: </b>{e.message}</p>
          {e.error && <p className="text-rose-300">Error: {e.error}</p>}
          {e.reply && <p className="whitespace-pre-wrap text-white/85"><b className="text-white/50">Claude: </b>{e.reply}</p>}
          {e.proposals.map((p, i) => <DeckSummary key={i} name={p.name} leaderNum={p.leaderNum} cards={p.cards} cost={p.deckCost} fusions={p.fusions} summary={p.summary} />)}
          {e.steps.length > 0 && (
            <details className="text-white/50">
              <summary className="cursor-pointer">{e.steps.length} tool steps</summary>
              <ol className="ml-4 list-decimal">{e.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </details>
          )}
          <p className="text-white/40">
            {u.calls} API calls · {u.input.toLocaleString()} input · {u.cacheRead.toLocaleString()} cache read · {u.cacheWrite.toLocaleString()} cache write · {u.output.toLocaleString()} output tokens · chat {e.session}
          </p>
        </div>
      )}
    </div>
  );
}

function DeckSummary({ name, leaderNum, cards, cost, fusions, summary }: { name: string; leaderNum: number; cards: number[]; cost: number; fusions: number; summary: string; }) {
  const counts = new Map<number, number>();
  for (const n of cards) counts.set(n, (counts.get(n) ?? 0) + 1);
  return (
    <div className="border border-emerald-400/30 bg-emerald-950/20 p-2">
      <b className="text-emerald-200">{name}</b>
      <span className="text-white/50"> · ♛ {catalogCard(leaderNum)?.name ?? `#${leaderNum}`} · cost {cost} · {fusions} fusions</span>
      {summary && <p className="mt-1 text-white/70">{summary}</p>}
      <details className="mt-1">
        <summary className="cursor-pointer text-white/50">Card list</summary>
        <ul className="mt-1 columns-2 gap-4 sm:columns-3">
          {[...counts.entries()].map(([num, n]) => <li key={num} className="truncate">{n}× {catalogCard(num)?.name ?? `#${num}`}</li>)}
        </ul>
      </details>
    </div>
  );
}
