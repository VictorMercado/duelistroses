import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import {
  acceptScouted, getCardScout, rejectScouted, rescanScouted, retryScoutedAssets, scanCardScout, setCardScoutRunning, uploadScoutCard,
  type ScoutOption, type ScoutState, type ScoutStatus, type ScoutSuggestion,
} from "@/net/api";
import { poll } from "@/net/poll";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0 border border-white/20 bg-black/60 px-2 py-1 text-xs outline-none focus:border-fuchsia-300";

type Notice = { text: string; bad?: boolean; } | null;
type Filter = ScoutStatus | "all";
const FILTERS: { id: Filter; label: string; }[] = [
  { id: "pending", label: "To review" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
const stat = (v: number | null) => (v == null ? "?" : String(v));
const when = (t: string) => (t ? new Date(t).toLocaleString() : "never");

/**
 * The card scout's review table. A worker on the server goes through the
 * outside card database (Synchro monsters, oldest first) and has Claude
 * suggest up to two ways each card could work here; nothing reaches the
 * catalog until an administrator accepts an option. Accepting saves the card
 * and builds its art, WebP copies and holo mask on the server.
 */
export default function CardScoutPanel({ token, active, onNotice }: { token: string; active: boolean; onNotice: (notice: Notice) => void; }) {
  const [state, setState] = useState<ScoutState | null>(null);
  const [rows, setRows] = useState<ScoutSuggestion[] | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(() => {
    getCardScout(token).then((r) => { setState(r.status); setRows(r.suggestions); })
      .catch((e: Error) => onNotice({ text: e.message, bad: true }));
  }, [token, onNotice]);

  // Refreshes while the tab is shown: new suggestions and asset builds land on their own.
  useEffect(() => (active ? poll(load, 10000) : undefined), [active, load]);

  const act = async (key: string, task: () => Promise<unknown>, done: string) => {
    setBusy(key);
    onNotice(null);
    try {
      await task();
      onNotice({ text: done });
      load();
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    } finally {
      setBusy("");
    }
  };

  // Cards Claude is still reading are listed with the ones to review.
  const inFilter = (r: ScoutSuggestion) => filter === "all" || r.status === filter || (filter === "pending" && r.status === "working");
  const shown = (rows ?? []).filter(inFilter);
  const count = (s: Filter) => (s === "pending" ? (state?.counts.pending ?? 0) + (state?.counts.working ?? 0) : s === "all" ? 0 : state?.counts[s] ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2 border border-white/15 bg-black/60 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${state?.running ? "bg-emerald-400" : "bg-white/30"}`} />
          <span className="font-bold">{state?.running ? "Scouting" : "Paused"}</span>
          {state?.busy && <span className="text-fuchsia-300">· adapting {state.busy}…</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              className={small}
              disabled={!state?.available || busy !== ""}
              onClick={() => act("run", () => setCardScoutRunning(token, !state?.running), state?.running ? "Scout paused." : "Scout started: it adapts one card at a time.")}
            >
              {state?.running ? "⏸ Pause" : "▶ Start scouting"}
            </button>
            <button className={small} disabled={!state?.available || busy !== "" || !!state?.busy} onClick={() => act("scan", () => scanCardScout(token), "Scouting the next card now.")}>
              Scout next card now
            </button>
            <button className={small} onClick={load}>Refresh</button>
          </span>
        </div>
        {state && !state.available && <p className="text-xs text-rose-300">No Anthropic credentials on this server: the scout cannot run.</p>}
        {state && (
          <p className="text-xs text-white/60">
            Synchro monsters, oldest first · {state.model} · one card every {Math.round(state.intervalSeconds / 60)} min, up to {state.dailyLimit} a day ({state.today} today)
            {state.left >= 0 && <> · {state.left} left to scout</>} · spent {money(state.spentUsd)} · last scan {when(state.lastScan)}
          </p>
        )}
        {state?.lastError && <p className="text-xs text-rose-300">Last error: {state.lastError}</p>}
      </section>

      <AddCard token={token} disabled={!state?.available} onNotice={onNotice} onAdded={() => { setFilter("pending"); load(); }} />

      <nav className="flex flex-wrap gap-1" aria-label="Filter suggestions">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`${small} ${filter === f.id ? "border-fuchsia-300 bg-white/10" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}{f.id !== "all" && ` (${count(f.id)})`}
          </button>
        ))}
      </nav>

      {rows === null ? <p className="text-sm text-white/60">Loading…</p> : shown.length === 0 ? (
        <p className="text-sm text-white/60">{filter === "pending" ? "Nothing to review yet. Start the scout, or scout the next card now." : "None."}</p>
      ) : (
        // The table scrolls sideways on a phone instead of squeezing its columns.
        <div className="overflow-x-auto border border-white/15 bg-black/60">
          <table className="w-full min-w-[56rem] border-collapse text-left text-xs">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="w-44 p-2 font-normal">Card</th>
                <th className="w-64 p-2 font-normal">Original effect</th>
                <th className="p-2 font-normal">Option 1</th>
                <th className="p-2 font-normal">Option 2</th>
                <th className="w-40 p-2 font-normal">Decision</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.id} row={r} busy={busy} onAct={act} token={token} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ row: r, busy, token, onAct }: {
  row: ScoutSuggestion; busy: string; token: string;
  onAct: (key: string, task: () => Promise<unknown>, done: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const s = r.source;
  const pending = r.status === "pending";
  return (
    <tr className="border-t border-white/10 align-top">
      <td className="p-2">
        <div className="flex flex-col gap-1">
          {s.imageSmall && <img src={s.imageSmall} alt="" loading="lazy" className="w-24 border border-white/15" />}
          {s.url
            ? <a href={s.url} target="_blank" rel="noreferrer" className="font-bold text-fuchsia-200 underline-offset-2 hover:underline">{r.name}</a>
            : <span className="font-bold text-fuchsia-200">{r.name}</span>}
          {s.type && <span className="text-white/60">{s.type}</span>}
          {s.race && <span className="text-white/60">{s.race} · {s.attribute} · Lv {s.level}</span>}
          {(s.atk != null || s.def != null || s.race) && <span className="text-white/60">ATK {stat(s.atk)} / DEF {stat(s.def)}</span>}
          {s.uploaded ? <span className="text-sky-200">Uploaded</span> : <span className="text-white/40">{r.released || "no release date"}</span>}
          {s.artThumb && (
            <span className="flex flex-col gap-0.5 text-white/50">
              Art for the game
              <img src={s.artThumb} alt="" className="w-16 border border-white/15" />
            </span>
          )}
        </div>
      </td>
      <td className="whitespace-pre-line p-2 text-white/80">
        {r.status === "working" ? <span className="text-fuchsia-300">Claude is reading the card…</span> : s.desc}
        {s.hint && <p className="mt-2 text-white/50">Your notes: {s.hint}</p>}
      </td>
      {[0, 1].map((i) => (
        <td key={i} className={`p-2 ${r.chosen === i ? "bg-emerald-500/10" : ""}`}>
          {r.options[i] ? (
            <OptionCell
              option={r.options[i]}
              chosen={r.chosen === i}
              accept={pending ? () => onAct(`accept${r.id}`, () => acceptScouted(token, r.id, i), `${r.name} added to the catalog; its art, WebP copies and mask are being built.`) : undefined}
              disabled={busy !== ""}
            />
          ) : <span className="text-white/40">{i === 1 && r.options.length === 1 ? "No effect to adapt: one option." : r.status === "working" ? "…" : ""}</span>}
        </td>
      ))}
      <td className="p-2">
        <div className="flex flex-col gap-2">
          <span className={statusColor(r.status)}>{r.status}{r.decidedBy && ` by ${r.decidedBy}`}</span>
          {r.note && <p className="text-white/70">{r.note}</p>}
          {r.status === "accepted" && r.cardNum != null && (
            <>
              <span>Card #{r.cardNum}</span>
              <span className={r.assets === "done" ? "text-emerald-300" : r.assets === "failed" ? "text-rose-300" : "text-amber-200"}>
                Assets: {r.assets === "done" ? "art, WebP and mask ready" : r.assets === "working" ? "building…" : r.assets || "not built"}
              </span>
              {r.assetsLog && (
                <details>
                  <summary className="cursor-pointer text-white/50">Asset log</summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-white/60">{r.assetsLog}</pre>
                </details>
              )}
              {r.assets === "failed" && (
                <button className={small} disabled={busy !== ""} onClick={() => onAct(`assets${r.id}`, () => retryScoutedAssets(token, r.id), "Building the assets again.")}>
                  Retry assets
                </button>
              )}
            </>
          )}
          {(pending || r.status === "failed") && (
            <button className={small} disabled={busy !== ""} onClick={() => onAct(`reject${r.id}`, () => rejectScouted(token, r.id), `${r.name} rejected.`)}>
              Reject
            </button>
          )}
          {r.status !== "accepted" && r.status !== "working" && (
            <details>
              <summary className="cursor-pointer text-white/60">Ask Claude again</summary>
              <div className="mt-1 flex flex-col gap-1">
                <textarea className={`${input} h-16`} placeholder="What to change (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                <button
                  className={small}
                  disabled={busy !== ""}
                  onClick={() => onAct(`rescan${r.id}`, () => rescanScouted(token, r.id, feedback), `Asking Claude again about ${r.name}.`)}
                >
                  Redo options
                </button>
              </div>
            </details>
          )}
          <span className="text-white/40">{money(r.costUsd)}</span>
        </div>
      </td>
    </tr>
  );
}

function OptionCell({ option: o, chosen, accept, disabled }: { option: ScoutOption; chosen: boolean; accept?: () => void; disabled: boolean; }) {
  const c = o.card as Record<string, unknown>;
  const behaviour = { effect: c.effect, abilities: c.abilities, favors: c.favors };
  const hasBehaviour = Object.values(behaviour).some((v) => v != null);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-bold text-white">{o.title || "Option"}{chosen && " ✓"}</span>
      <p className="text-white/80">{o.summary}</p>
      {typeof c.text === "string" && c.text && <p className="border-l-2 border-white/20 pl-2 italic text-white/70">{c.text}</p>}
      <span className="text-white/50">
        {String(c.type)} · {String(c.attribute)} · Lv {String(c.level)} · {String(c.atk)}/{String(c.def)} · deck cost {String(c.deckCost ?? "?")}
      </span>
      {o.newBehaviour && (
        <details className="text-amber-200">
          <summary className="cursor-pointer">Needs new engine work</summary>
          <p className="whitespace-pre-line text-amber-100/80">{o.newBehaviour}</p>
        </details>
      )}
      {o.warnings.length > 0 && <p className="text-amber-200">⚠ {o.warnings.join("; ")}</p>}
      {hasBehaviour && (
        <details>
          <summary className="cursor-pointer text-white/50">Effect JSON</summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-white/60">{JSON.stringify(behaviour, null, 1)}</pre>
        </details>
      )}
      {accept && <button className={`${small} mt-1 self-start border-emerald-300/60 text-emerald-200`} disabled={disabled} onClick={accept}>Accept this option</button>}
    </div>
  );
}

function statusColor(s: ScoutStatus) {
  return s === "accepted" ? "text-emerald-300" : s === "rejected" ? "text-white/50" : s === "failed" ? "text-rose-300" : s === "working" ? "text-fuchsia-300" : "text-amber-200";
}

/**
 * Two drop points for a card to add by hand: the image of the real card,
 * which Claude reads, and (optionally) the art the card is drawn with here.
 */
function AddCard({ token, disabled, onNotice, onAdded }: { token: string; disabled: boolean; onNotice: (notice: Notice) => void; onAdded: () => void; }) {
  const [card, setCard] = useState<File | null>(null);
  const [art, setArt] = useState<File | null>(null);
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!card || sending) return;
    setSending(true);
    onNotice(null);
    try {
      await uploadScoutCard(token, card, art, hint.trim());
      onNotice({ text: "Claude is reading the card: its options appear in the table below in a minute or two." });
      setCard(null);
      setArt(null);
      setHint("");
      onAdded();
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 border border-white/15 bg-black/60 p-3 text-sm">
      <h2 className="font-bold">Add a card from images</h2>
      <p className="text-xs text-white/60">
        Drop the real card: Claude reads its effect and suggests Duelist Roses versions in the table below. Nothing is added until you accept one.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <DropZone label="Yu-Gi-Oh card" note="Required: the whole card, so its text can be read" file={card} onFile={setCard} />
        <DropZone label="Template / art for the game" note="Optional: the picture this card is drawn with. Without one, the art box is cut out of the card." file={art} onFile={setArt} />
      </div>
      <textarea
        className={`${input} h-14`}
        placeholder="Notes for Claude (optional), e.g. make it a field-wide aura"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
      />
      <button className={`${small} self-start border-fuchsia-300/60`} disabled={disabled || !card || sending} onClick={send}>
        {sending ? "Sending…" : "Read card and suggest"}
      </button>
    </section>
  );
}

function DropZone({ label, note, file, onFile }: { label: string; note: string; file: File | null; onFile: (file: File | null) => void; }) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  // The object URL is freed once the image changes or the zone goes away.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = (files: FileList | null | undefined) => {
    const image = Array.from(files ?? []).find((f) => f.type.startsWith("image/"));
    if (image) onFile(image);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); };
  const paste = (e: ClipboardEvent) => take(e.clipboardData.files);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}: drop, paste or choose an image`}
      className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed p-2 text-center text-xs outline-none focus:border-fuchsia-300 ${over ? "border-fuchsia-300 bg-fuchsia-300/10" : "border-white/25 hover:border-white/50"}`}
      onClick={() => picker.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onPaste={paste}
    >
      <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <span className="font-bold text-white">{label}</span>
      {preview ? (
        <>
          <img src={preview} alt="" className="max-h-40 max-w-full border border-white/15 object-contain" />
          <span className="max-w-full truncate text-white/50">{file?.name}</span>
          <button className={small} onClick={(e) => { e.stopPropagation(); onFile(null); }}>Remove</button>
        </>
      ) : (
        <>
          <span className="text-white/60">Drop an image here, paste one, or tap to choose</span>
          <span className="text-white/40">{note}</span>
        </>
      )}
    </div>
  );
}
