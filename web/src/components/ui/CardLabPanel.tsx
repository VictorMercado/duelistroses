import { useEffect, useRef, useState } from "react";
import { ApiError, getCardLab, sendCardLab, type CardProposal, type LLMModelInfo, type StoredCard } from "@/net/api";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0  border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-fuchsia-300";

type Notice = { text: string; bad?: boolean; } | null;
type Entry =
  | { role: "you"; text: string; }
  | { role: "claude"; text: string; steps: string[]; proposals: CardProposal[]; cost: number; };

const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

const STARTERS = [
  "Design a level 4 spellcaster that heals its owner 500 LP every turn while face up.",
  "Make a trap that destroys the attacking monster if its ATK is 2000 or more.",
  "Invent a spell that swaps the positions of two leaders. If the engine can't do it yet, write the spec.",
];

/** What to hand Claude Code (or a developer) to make a new op work in the engine. */
const implementationPrompt = (p: CardProposal) => `Implement a new card behaviour in the Duelist Roses engine (game/engine).

Card (already saved or about to be saved in the catalog):
${JSON.stringify(p.card, null, 2)}

What it should do: ${p.summary}

Specification:
${p.newBehaviour}

Add the op to EffectOps or AbilityOps in game/engine/ops.go / abilities.go, carry it out in effects.go or abilities.go, and add a test.`;

/**
 * A conversation with Claude that designs cards. Claude can search the
 * catalog and check its designs against the server's rules; finished cards
 * come back as proposals to open in the card editor, where they are saved.
 * The conversation lives on the server until it restarts.
 */
export default function CardLabPanel({ token, onNotice, input: text, setInput, onOpen }: {
  token: string; onNotice: (notice: Notice) => void;
  input: string; setInput: (text: string) => void;
  onOpen: (card: StoredCard) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [models, setModels] = useState<LLMModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [session, setSession] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getCardLab(token).then((r) => {
      if (!live) return;
      setAvailable(r.available);
      setModels(r.models);
      setModel((m) => m || r.default);
    }).catch((e: Error) => live && onNotice({ text: e.message, bad: true }));
    return () => { live = false; };
  }, [token, onNotice]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries.length, busy]);

  const reset = () => { setSession(""); setEntries([]); setTotal(0); };

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    onNotice(null);
    setEntries((list) => [...list, { role: "you", text: message }]);
    setInput("");
    try {
      const reply = await sendCardLab(token, { session, model, message });
      setSession(reply.session);
      setTotal(reply.totalCostUsd);
      setEntries((list) => [...list, { role: "claude", text: reply.text, steps: reply.steps, proposals: reply.proposals, cost: reply.turnCostUsd }]);
    } catch (e) {
      const gone = e instanceof ApiError && e.status === 410;
      if (gone) reset();
      onNotice({ text: gone ? "The server forgot that conversation (it restarted or sat idle). Send your message again to start a new one." : (e as Error).message, bad: true });
      setInput(message);
      if (!gone) setEntries((list) => list.slice(0, -1));
    }
    setBusy(false);
  };

  const chosen = models.find((m) => m.id === model);
  if (available === false) {
    return <p className="text-sm text-white/60">The Card Lab needs Anthropic credentials on the server (ANTHROPIC_API_KEY, or a profile from `ant auth login`).</p>;
  }

  return (
    <section className="flex min-h-[60vh] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={model} disabled={!!session} onChange={(e) => setModel(e.target.value)} title={session ? "Start a new conversation to change model" : undefined}>
          {models.map((m) => <option key={m.id} value={m.id}>Claude {m.label} · {m.note}</option>)}
        </select>
        {chosen?.inputPerM !== undefined && (
          <span className="text-[11px] text-white/50">${chosen.inputPerM}/M in · ${chosen.outputPerM}/M out</span>
        )}
        <span className="ml-auto text-xs text-emerald-300">{total > 0 && `${money(total)} this conversation`}</span>
        <button className={small} disabled={busy || entries.length === 0} onClick={reset}>New conversation</button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto border border-white/15 bg-black/75 p-3">
        {entries.length === 0 && (
          <div className="flex flex-col gap-2 text-sm text-white/60">
            <p>
              Ask Claude for a card. It builds effects from the ops the engine already runs, so those cards play as soon as you save them.
              If an idea needs something new, it says so and writes a spec you can hand to Claude Code to implement.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => <button key={s} className={`${small} text-left`} onClick={() => setInput(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {entries.map((entry, i) =>
          entry.role === "you" ? (
            <p key={i} className="self-end whitespace-pre-wrap bg-fuchsia-900/50 px-3 py-2 text-sm">{entry.text}</p>
          ) : (
            <div key={i} className="flex flex-col gap-2">
              {entry.steps.length > 0 && (
                <details className="text-[11px] text-white/40">
                  <summary className="cursor-pointer hover:text-white/70">{entry.steps.length} lookups and checks</summary>
                  <ul className="ml-3 list-disc">{entry.steps.map((s, j) => <li key={j}>{s}</li>)}</ul>
                </details>
              )}
              {entry.text && <p className="whitespace-pre-wrap text-sm text-white/90">{entry.text}</p>}
              {entry.proposals.map((p, j) => <ProposalCard key={j} proposal={p} onOpen={() => onOpen(p.card)} onNotice={onNotice} />)}
              <span className="text-[10px] text-white/30">{money(entry.cost)}</span>
            </div>
          ),
        )}
        {busy && <p className="animate-pulse text-sm text-white/50">Claude is designing… (looking up cards and checking its work can take a minute)</p>}
        <div ref={end} />
      </div>

      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          className={`${input} min-h-16 flex-1`}
          placeholder="Describe a card or an effect… (⌘/Ctrl+Enter to send)"
          value={text}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
        />
        <button type="submit" className={`${small} border-fuchsia-300/60 text-fuchsia-100`} disabled={busy || !text.trim() || !model}>Send</button>
      </form>
    </section>
  );
}

function ProposalCard({ proposal: p, onOpen, onNotice }: { proposal: CardProposal; onOpen: () => void; onNotice: (n: Notice) => void; }) {
  const c = p.card as StoredCard & { type?: string; attribute?: string; level?: number; atk?: number; def?: number; text?: string; deckCost?: number; };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(implementationPrompt(p));
      onNotice({ text: "Copied a prompt for Claude Code: paste it in to implement the new behaviour." });
    } catch {
      onNotice({ text: "Could not copy to the clipboard.", bad: true });
    }
  };
  return (
    <div className="flex flex-col gap-2 border border-yellow-300/30 bg-black/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-bold text-yellow-200">
          #{c.num} {c.name}
          <span className="ml-2 text-xs font-normal text-white/60">
            {c.kind === "monster" ? `${c.type}/${c.attribute} · level ${c.level} · ${c.atk}/${c.def}` : c.kind}
            {c.deckCost !== undefined && ` · cost ${c.deckCost}`}
          </span>
        </p>
        <button className={`${small} border-emerald-300/60 text-emerald-100`} onClick={onOpen}>Open in card editor</button>
      </div>
      {p.replaces && <p className="text-xs text-amber-300">Replaces the existing card “{p.replaces}”.</p>}
      {c.text && <p className="text-sm italic text-white/80">{c.text}</p>}
      <p className="text-xs text-white/70">{p.summary}</p>
      {p.warnings.map((w) => <p key={w} className="text-xs text-amber-300">⚠ {w}</p>)}
      {p.newBehaviour && (
        <div className="flex flex-col gap-1 border border-amber-300/30 p-2 text-xs">
          <p className="text-amber-200">Needs engine work before it does anything in play:</p>
          <p className="whitespace-pre-wrap text-white/70">{p.newBehaviour}</p>
          <button className={`${small} self-start`} onClick={copy}>Copy prompt for Claude Code</button>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-white/50 hover:text-white">JSON</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-white/70">{JSON.stringify(p.card, null, 2)}</pre>
      </details>
    </div>
  );
}
