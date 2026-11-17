import { useEffect, useMemo, useState } from "react";
import {
  getCardRevisions, getEffectReference, getStoredCard, saveCard,
  type CardRevision, type EffectReference, type StoredCard,
} from "@/net/api";
import { allCards, ensureCatalog, reloadCatalog } from "@/game/catalog";
import CardFace from "./CardFace";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const input = "min-w-0  border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-fuchsia-300";
const label = "flex min-w-0 flex-col gap-1 text-[11px] text-white/60";

type Notice = { text: string; bad?: boolean; } | null;

/** The fields with their own inputs; everything else is edited as JSON. */
const FORM_FIELDS = ["name", "kind", "type", "attribute", "level", "atk", "def", "deckCost", "image", "text"] as const;
const NUMBER_FIELDS = new Set(["level", "atk", "def", "deckCost"]);
/** Added by the server when the catalog is served; never saved. */
const COMPUTED = new Set(["num", "frame", "template", "attributeIcon"]);
const KINDS = ["monster", "spell", "trap", "ritual"];

const extrasOf = (card: StoredCard) =>
  Object.fromEntries(Object.entries(card).filter(([k]) => !(FORM_FIELDS as readonly string[]).includes(k) && !COMPUTED.has(k)));
const pretty = (v: unknown) => (Object.keys(v as object).length ? JSON.stringify(v, null, 2) : "{}");

const nextFreeNum = () => allCards().reduce((n, c) => Math.max(n, c.num + 1), 0);

export interface CardDraft { card: StoredCard; /** Where it came from, shown above the editor. */ from?: string; }

/**
 * The card editor: find a card, change its stats, text, effect and
 * abilities, and save it; or make a new one. Saving runs every check the
 * server has (the card, its effect against the engine, the whole catalog), so
 * a card that would not play is refused with the reasons. Cards from the
 * Card Lab open here (`initial`).
 */
export default function CardsPanel({ token, onNotice, initial, onAsk }: {
  token: string; onNotice: (notice: Notice) => void; initial?: CardDraft; onAsk: (message: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [num, setNum] = useState<number | null>(initial ? (initial.card.num ?? null) : null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<StoredCard>(initial?.card ?? {});
  const [extras, setExtras] = useState(initial ? pretty(extrasOf(initial.card)) : "{}");
  const [from, setFrom] = useState(initial?.from ?? "");
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<CardRevision[]>([]);
  const [reference, setReference] = useState<EffectReference | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0); // bumps when the catalog is reloaded

  useEffect(() => {
    let live = true;
    ensureCatalog().then(() => {
      if (!live) return;
      setReady(true);
      // A proposal from the lab with no number is a new card.
      if (initial && initial.card.num === undefined) { setNum(nextFreeNum()); setIsNew(true); }
      else if (initial && !allCards().some((c) => c.num === initial.card.num)) setIsNew(true);
    }).catch((e: Error) => live && onNotice({ text: e.message, bad: true }));
    getEffectReference(token).then((r) => live && setReference(r)).catch(() => {});
    return () => { live = false; };
  }, [token, onNotice, initial]);

  useEffect(() => {
    if (num === null || isNew) return;
    let live = true;
    getCardRevisions(token, num).then((list) => live && setRevisions(list)).catch(() => live && setRevisions([]));
    return () => { live = false; };
  }, [token, num, isNew, version]);

  const list = useMemo(() => {
    if (!ready) return [];
    const q = query.trim().toLowerCase();
    return allCards()
      .filter((c) => (!kind || c.kind === kind) && (!q || c.name.toLowerCase().includes(q) || String(c.num) === q || (c.text ?? "").toLowerCase().includes(q)))
      .slice(0, 150);
    // version: the list is rebuilt after a save reloads the catalog.
  }, [ready, query, kind, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const { types, attributes } = useMemo(() => {
    const t = new Set<string>(), a = new Set<string>();
    if (ready) for (const c of allCards()) { if (c.type) t.add(c.type); if (c.attribute) a.add(c.attribute); }
    return { types: [...t].sort(), attributes: [...a].sort() };
  }, [ready]);

  const load = (card: StoredCard, cardNum: number, isNewCard: boolean, source = "") => {
    setNum(cardNum);
    setIsNew(isNewCard);
    setForm(card);
    setExtras(pretty(extrasOf(card)));
    setFrom(source);
    setWarnings([]);
    setNote("");
  };

  const open = async (cardNum: number) => {
    onNotice(null);
    try {
      const { card } = await getStoredCard(token, cardNum);
      load(card, cardNum, false);
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
  };

  let parsedExtras: Record<string, unknown> | null = null;
  let extrasError = "";
  try {
    const v = JSON.parse(extras || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) parsedExtras = v;
    else extrasError = "must be a JSON object";
  } catch (e) {
    extrasError = (e as Error).message;
  }

  const draft = (): StoredCard => {
    const card: StoredCard = { ...(parsedExtras ?? {}) };
    for (const field of FORM_FIELDS) {
      const v = form[field];
      if (v === undefined || v === "" || v === null) continue;
      (card as Record<string, unknown>)[field] = NUMBER_FIELDS.has(field) ? Number(v) : v;
    }
    return card;
  };

  const save = async () => {
    if (num === null || parsedExtras === null) return;
    if (isNew && allCards().some((c) => c.num === num) && !confirm(`Card ${num} already exists. Replace it?`)) return;
    setBusy(true);
    onNotice(null);
    try {
      const result = await saveCard(token, num, draft(), note || (isNew ? "created" : "edited"));
      setWarnings(result.warnings);
      await reloadCatalog();
      setVersion((v) => v + 1);
      setIsNew(false);
      setNote("");
      onNotice({ text: `Saved card ${num}${result.warnings.length ? " (with warnings)" : ""}. New duels use it now.` });
    } catch (e) {
      onNotice({ text: (e as Error).message, bad: true });
    }
    setBusy(false);
  };

  const set = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));
  const monster = (form.kind ?? "monster") === "monster";
  const field = (name: (typeof FORM_FIELDS)[number], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={label}>
      {name}
      <input className={input} value={(form[name] as string | number | undefined) ?? ""} onChange={(e) => set(name, e.target.value)} {...props} />
    </label>
  );

  return (
    <section className="grid gap-3 md:grid-cols-[16rem_1fr]">
      {/* Finding a card. */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex gap-2">
          <input className={`${input} flex-1`} placeholder="Search name, text or #" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">all</option>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button className={`${small} border-fuchsia-300/60 text-fuchsia-100`} disabled={!ready} onClick={() => load({ kind: "monster" }, nextFreeNum(), true)}>
          ＋ New card
        </button>
        <ul className="flex max-h-[24rem] flex-col overflow-y-auto border border-white/15 bg-black/75 md:max-h-[70vh]">
          {list.map((c) => (
            <li key={c.num}>
              <button
                className={`flex w-full gap-2 px-2 py-1 text-left text-xs hover:bg-white/10 pointer-coarse:min-h-10 ${c.num === num && !isNew ? "bg-fuchsia-900/50" : ""}`}
                onClick={() => open(c.num)}
              >
                <span className="w-8 shrink-0 text-white/40">{c.num}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-white/40">{c.kind}</span>
              </button>
            </li>
          ))}
          {!ready && <li className="p-2 text-xs text-white/50">loading…</li>}
        </ul>
      </div>

      {/* Editing it. */}
      {num === null ? (
        <p className="text-sm text-white/50">Pick a card to edit, or make a new one. Cards Claude designs in the Card Lab open here too.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3 border border-white/15 bg-black/75 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-yellow-200">{isNew ? "New card" : `Card ${num}`}{form.name ? `: ${form.name}` : ""}</h3>
            {from && <span className="bg-fuchsia-900/70 px-1.5 text-[11px] text-fuchsia-200">{from}</span>}
            <button
              className={`${small} ml-auto`}
              title="Send this card to the Card Lab and ask Claude about it"
              onClick={() => onAsk(`About card ${num}${isNew ? " (not saved yet)" : ""}:\n${JSON.stringify(draft())}\n\n`)}
            >
              ✨ Ask Claude
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {isNew && (
                <label className={label}>
                  num
                  <input className={input} type="number" min={0} value={num} onChange={(e) => setNum(Number(e.target.value))} />
                </label>
              )}
              <div className="col-span-2">{field("name", { maxLength: 60 })}</div>
              <label className={label}>
                kind
                <select className={input} value={(form.kind as string) ?? "monster"} onChange={(e) => set("kind", e.target.value)}>
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              {monster && (
                <>
                  {field("type", { list: "card-types" })}
                  {field("attribute", { list: "card-attributes" })}
                  {field("level", { type: "number", min: 1, max: 12 })}
                  {field("atk", { type: "number", min: 0, step: 100 })}
                  {field("def", { type: "number", min: 0, step: 100 })}
                </>
              )}
              {field("deckCost", { type: "number", min: 0 })}
              <div className="col-span-2">{field("image", { placeholder: "cards/123.png" })}</div>
              <label className={`${label} col-span-2 sm:col-span-4`}>
                text
                <textarea className={`${input} min-h-16`} value={(form.text as string) ?? ""} onChange={(e) => set("text", e.target.value)} />
              </label>
            </div>
            {!isNew && <CardFace key={`${num}-${version}`} num={num} className="w-full max-w-36 self-start" />}
          </div>
          <datalist id="card-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="card-attributes">{attributes.map((a) => <option key={a} value={a} />)}</datalist>

          <label className={label}>
            <span>
              effect, abilities and everything else (JSON)
              {extrasError && <span className="ml-2 text-rose-300">{extrasError}</span>}
            </span>
            <textarea
              className={`${input} min-h-40 font-mono text-xs ${extrasError ? "border-rose-400/70" : ""}`}
              spellCheck={false}
              value={extras}
              onChange={(e) => setExtras(e.target.value)}
            />
          </label>

          {warnings.length > 0 && (
            <ul className="text-xs text-amber-300">{warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input className={`${input} min-w-40 flex-1`} placeholder="What changed (for the history)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className={`${small} border-emerald-300/60 text-emerald-100`} disabled={busy || !!extrasError || !form.name} onClick={save}>
              {busy ? "Saving…" : isNew ? "Create card" : "Save card"}
            </button>
          </div>
          <p className="text-[11px] text-white/40">
            Saves go to this server's database and apply to new duels straight away. To ship a card to other servers, export the catalog
            (/api/admin/cards/export) or write a migration.
          </p>

          {revisions.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-white/60 hover:text-white">History ({revisions.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {revisions.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-white/70">
                      {r.changedAt ? new Date(r.changedAt).toLocaleString() : "original"} · {r.changedBy}{r.note && ` · ${r.note}`}
                    </span>
                    <button className={small} onClick={() => load(r.card, num, false, `revision ${r.id}`)}>Load</button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {reference && <OpsReference reference={reference} />}
        </div>
      )}
    </section>
  );
}

/** Every op the engine carries out, for writing effects by hand. */
function OpsReference({ reference }: { reference: EffectReference; }) {
  // An older server may leave lists out (abilities came later): show what there is.
  const byKind: Record<string, string[]> = {};
  for (const [op, kind] of Object.entries(reference.effects ?? {})) (byKind[kind] ??= []).push(op);
  const abilities = Object.entries(reference.abilities ?? {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-white/60 hover:text-white">Ops the engine carries out</summary>
      <div className="mt-2 flex flex-col gap-2 text-white/70">
        {Object.entries(byKind).sort().map(([kind, ops]) => (
          <p key={kind}><span className="text-white/50">effect.op for a {kind}:</span> {ops.sort().join(", ")}</p>
        ))}
        {abilities.length > 0 && (
          <p>
            <span className="text-white/50">abilities[].op (with its "on" moments):</span>{" "}
            {abilities.sort().map(([op, on]) => `${op} (${(on ?? []).map((m) => m || "passive").join("/")})`).join(", ")}
          </p>
        )}
        <p><span className="text-white/50">leader.op:</span> {(reference.leaders ?? []).join(", ")}</p>
        <p className="text-white/40">An op not listed here saves with a warning and does nothing until it is added to the engine.</p>
      </div>
    </details>
  );
}
