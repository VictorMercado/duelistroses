import { useEffect, useRef, useState } from "react";
import { catalogCard } from "@/game/catalog";
import { ApiError, getDeckAssistant, sendDeckAssistant, type DeckProposal, type LLMModelInfo } from "@/net/api";
import CardFace from "./CardFace";

const small = "border border-white/25 px-2 py-1 text-xs hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-10";
const primary = "bg-yellow-600 px-3 py-1 text-xs font-bold text-black hover:bg-yellow-500 disabled:opacity-40 pointer-coarse:min-h-10";

type Entry =
  | { role: "you"; text: string; }
  | { role: "claude"; text: string; steps: string[]; proposals: DeckProposal[]; model: string; };

const STARTERS = [
  "Build me a dragon deck with strong fusions.",
  "Make a cheap aggressive deck that hits the enemy leader fast.",
  "Improve the deck I have open: what would you swap?",
  "Which fusions does my current deck have?",
];

export interface AssistantDraft { name: string; leaderNum: number; cards: number[]; id?: string; }

/**
 * A conversation with Claude about decks. Claude sees the deck open in the
 * builder with every message, searches the catalog and fusions, and proposes
 * decks checked against the save rules; the player loads one with a tap and
 * saves it as usual. The conversation lives on the server until it restarts.
 */
export default function DeckAssistant({ token, guest, draft, open, onClose, onUse }: {
  token: string; guest: boolean; draft: AssistantDraft; open: boolean; onClose: () => void;
  /** asNew: start a new deck from it instead of replacing the open one's cards. */
  onUse: (proposal: DeckProposal, asNew: boolean) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  // The model new chats use. Administrators get a picker (models); players get the one chosen for them.
  const [model, setModel] = useState("");
  const [models, setModels] = useState<LLMModelInfo[]>([]);
  const [session, setSession] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || available !== null) return;
    getDeckAssistant(token).then((r) => {
      setAvailable(r.available);
      setModel(r.model ?? "");
      setModels(r.models ?? []);
    }).catch(() => setAvailable(false));
  }, [open, available, token]);
  useEffect(() => { if (open) box.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries.length, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const reset = () => { setSession(""); setEntries([]); setError(""); };

  const send = async (message = text.trim()) => {
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setEntries((list) => [...list, { role: "you", text: message }]);
    setText("");
    try {
      const reply = await sendDeckAssistant(token, {
        session, model, message, draft: { name: draft.name, leaderNum: draft.leaderNum, cards: draft.cards },
      });
      setSession(reply.session);
      setEntries((list) => [...list, { role: "claude", text: reply.text, steps: reply.steps, proposals: reply.proposals, model: reply.model }]);
    } catch (e) {
      const gone = e instanceof ApiError && e.status === 410;
      if (gone) reset();
      setError(gone ? "That conversation expired. Send your message again to start a new one." : (e as Error).message);
      setText(message);
      if (!gone) setEntries((list) => list.slice(0, -1));
    }
    setBusy(false);
  };

  return (
    <div
      className={`${open ? "flex" : "hidden"} fixed inset-0 z-[65] flex-col bg-black/80 px-[max(0.5rem,env(safe-area-inset-left))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[calc(var(--hud-top)+3rem)] lg:inset-auto lg:bottom-3 lg:right-[max(0.75rem,env(safe-area-inset-right))] lg:top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] lg:w-[26rem] lg:bg-transparent lg:p-0`}
      onClick={onClose}
    >
      <section
        className="flex min-h-0 flex-1 flex-col gap-2 border border-yellow-400/40 bg-black/90 p-3 font-mono text-white shadow-2xl md:backdrop-blur"
        onClick={(e) => e.stopPropagation()}
        aria-label="Deck assistant"
      >
        <div className="flex items-center gap-2">
          <b className="text-yellow-300">✨ Ask Claude</b>
          {models.length > 0 ? (
            <select
              className="min-w-0 border border-white/20 bg-black/60 px-1 py-0.5 text-[11px] text-white outline-none focus:border-yellow-400 disabled:opacity-60"
              value={model}
              disabled={!!session || busy}
              title={session ? "Start a new chat to change the model" : "Model for this chat (administrators only)"}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Claude model"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.inputPerM !== undefined ? ` · $${m.inputPerM}/$${m.outputPerM} per M` : ""}</option>)}
            </select>
          ) : model && <span className="text-[11px] text-white/40">{model.replace(/^claude-/, "")}</span>}
          <button className={`${small} ml-auto`} disabled={busy || entries.length === 0} onClick={reset}>New chat</button>
          <button className={small} onClick={onClose} aria-label="Close the deck assistant">✕</button>
        </div>

        {guest ? (
          <p className="text-sm text-white/60">Make an account to have Claude build decks for you.</p>
        ) : available === false ? (
          <p className="text-sm text-white/60">The deck assistant is not available on this server.</p>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
              {entries.length === 0 && (
                <div className="flex flex-col gap-2 text-sm text-white/60">
                  <p>Ask for a deck, or for help with the one you have open. Claude sees your current deck, checks fusions and makes sure every deck it suggests is legal.</p>
                  <div className="flex flex-col gap-1.5">
                    {STARTERS.map((s) => <button key={s} className={`${small} text-left`} onClick={() => send(s)}>{s}</button>)}
                  </div>
                </div>
              )}
              {entries.map((entry, i) =>
                entry.role === "you" ? (
                  <p key={i} className="ml-8 self-end whitespace-pre-wrap bg-yellow-900/40 px-3 py-2 text-sm">{entry.text}</p>
                ) : (
                  <div key={i} className="flex flex-col gap-2">
                    {entry.steps.length > 0 && (
                      <details className="text-[11px] text-white/40">
                        <summary className="cursor-pointer hover:text-white/70">{entry.steps.length} lookups</summary>
                        <ul className="ml-3 list-disc">{entry.steps.map((s, j) => <li key={j}>{s}</li>)}</ul>
                      </details>
                    )}
                    {models.length > 0 && <span className="text-[10px] text-white/30">{entry.model.replace(/^claude-/, "")}</span>}
                    {entry.text && <p className="whitespace-pre-wrap text-sm text-white/90">{entry.text}</p>}
                    {entry.proposals.map((p, j) => <ProposalCard key={j} proposal={p} editing={!!draft.id} onUse={(asNew) => onUse(p, asNew)} />)}
                  </div>
                ),
              )}
              {busy && <p className="animate-pulse text-sm text-white/50">Claude is building… (looking up cards and fusions can take a minute)</p>}
              <div ref={end} />
            </div>

            {error && <p className="text-xs text-rose-300">{error}</p>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <textarea
                ref={box}
                rows={2}
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Build me a deck that…"
                className="min-w-0 flex-1 resize-none border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-yellow-400"
              />
              <button className={primary} disabled={busy || !text.trim()}>Send</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ProposalCard({ proposal, editing, onUse }: { proposal: DeckProposal; editing: boolean; onUse: (asNew: boolean) => void; }) {
  const leader = catalogCard(proposal.leaderNum);
  const counts = new Map<number, number>();
  for (const n of proposal.cards) counts.set(n, (counts.get(n) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-2 border border-yellow-400/40 bg-yellow-950/20 p-2 text-xs">
      <div className="flex gap-2">
        {leader && <CardFace num={leader.num} className="w-12 shrink-0" />}
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm text-yellow-200">{proposal.name}</b>
          <span className="text-white/50">♛ {leader?.name ?? `#${proposal.leaderNum}`} · {proposal.cards.length} cards · cost {proposal.deckCost} · {proposal.fusions} fusions</span>
          {proposal.summary && <p className="mt-1 text-white/80">{proposal.summary}</p>}
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-white/50 hover:text-white/80">Card list</summary>
        <ul className="mt-1 columns-2 gap-3">
          {[...counts.entries()].map(([num, count]) => (
            <li key={num} className="truncate">{count}× {catalogCard(num)?.name ?? `#${num}`}</li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <button className={primary} onClick={() => onUse(true)}>Load as new deck</button>
            <button className={small} onClick={() => onUse(false)}>Replace open deck</button>
          </>
        ) : (
          <button className={primary} onClick={() => onUse(false)}>Load into builder</button>
        )}
      </div>
    </div>
  );
}
