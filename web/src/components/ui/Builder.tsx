import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playSfx } from "@/game/sfx";
import { ASSET_URL } from "@/const";
import { allCards, catalogCard, ensureCatalog } from "@/game/catalog";
import {
  decksMadeByMe, deleteDeck, deleteMap, friendsList, listMaps, myDecks, saveDeck, saveMap, starterDecks,
  type CatalogCard, type DeckSummary, type MapSummary,
} from "@/net/api";
import { useSessionStore } from "@/stores/sessionStore";
import { useMenuStore, type MenuScreen } from "@/stores/menuStore";
import CardFace from "./CardFace";
import { CardInspector } from "./CardPreview";

const DECK_SIZE = 40;
// The deck leader has its own slot on top of the 40: 41 in all.
const CAPACITY = DECK_SIZE + 1;
/** Cards the grid adds per "Show more". */
const PAGE = 240;
const MAX_COPIES = 3;
const TERRAINS = ["normal", "sogen", "forest", "wasteland", "mountain", "umi", "yami", "toon", "crush", "labyrinth"];
const terrainUrl = (name: string) => `${ASSET_URL}/terrains/${name}.png`;
// The classic card back, for the deck stack.
const CARD_BACK = `${ASSET_URL}/textures/cardBack.jpg`;

const field = "min-w-0  border border-white/20 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-yellow-400";
// The card filters: small on phones so the cards get the screen.
const filter = "min-w-0  border border-white/20 bg-black/60 px-1.5 py-1 text-[11px] text-white outline-none focus:border-yellow-400  lg:px-3 lg:py-2 lg:text-sm";
const button = " bg-yellow-600 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-40 pointer-coarse:min-h-11";
const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-11";
const danger = " border border-rose-400/50 px-3 py-2 text-sm text-rose-300 hover:border-rose-300 disabled:opacity-40 pointer-coarse:min-h-11";
const mini = " border border-white/25 px-2 text-xs hover:border-yellow-400 pointer-coarse:min-h-9 pointer-coarse:px-3";
const panel = "flex min-h-0 flex-col gap-3  border border-white/15 bg-black/80 p-3 sm:p-4 md:backdrop-blur";

type Notice = { text: string; bad?: boolean; } | null;
type Notify = (notice: Notice) => void;

// --- decks -----------------------------------------------------------------

/** ownerId/ownerName are set when the deck already belongs to someone: an administrator may edit anyone's. */
interface Draft { id?: string; name: string; leaderNum: number; cards: number[]; isPublic: boolean; ownerId?: string; ownerName?: string; }
const emptyDraft = (): Draft => ({ name: "New deck", leaderNum: -1, cards: [], isPublic: false });
const draftOf = (deck: DeckSummary, asCopy: boolean): Draft => ({
  id: asCopy ? undefined : deck.id,
  name: asCopy ? `${deck.name} (copy)`.slice(0, 40) : deck.name,
  leaderNum: deck.leaderNum,
  cards: [...deck.cards],
  isPublic: asCopy ? false : !!deck.isPublic,
  ownerId: asCopy ? undefined : deck.ownerId,
  ownerName: asCopy ? undefined : deck.ownerName,
});
const KIND_ORDER = ["monster", "ritual", "spell", "trap"];

function DeckBuilder({ token, notify }: { token: string; notify: Notify; }) {
  const setDeckId = useSessionStore((s) => s.setDeckId);
  const userId = useSessionStore((s) => s.user?.id);
  const guest = useSessionStore((s) => s.user?.guest ?? true);
  const showProfile = useMenuStore((s) => s.showProfile);
  const [cards, setCards] = useState<CatalogCard[]>(allCards);
  const [mine, setMine] = useState<DeckSummary[]>([]);
  // Decks we built for friends, and the friends we can build for.
  const [made, setMade] = useState<DeckSummary[]>([]);
  const [friends, setFriends] = useState<{ id: string; name: string; }[]>([]);
  const [starters, setStarters] = useState<DeckSummary[]>([]);
  // A deck sent here from a profile page opens straight away; so does a new
  // deck for the person whose page sent us.
  const [draft, setDraft] = useState<Draft>(() => {
    const { editDeck, buildFor } = useMenuStore.getState();
    if (editDeck) return draftOf(editDeck, false);
    return buildFor ? { ...emptyDraft(), ownerId: buildFor.id, ownerName: buildFor.name } : emptyDraft();
  });
  useEffect(() => { useMenuStore.getState().clearEditDeck(); }, []);
  // Someone else's deck (a friend's, or anyone's for an administrator): saving keeps it theirs.
  const foreign = !!draft.ownerId && draft.ownerId !== userId;
  // Who the deck can be built for: us, our friends, and whoever it is already for.
  const targets = useMemo(() => {
    const list = [...friends];
    if (foreign && !list.some((f) => f.id === draft.ownerId)) list.unshift({ id: draft.ownerId!, name: draft.ownerName ?? "?" });
    return list;
  }, [friends, foreign, draft.ownerId, draft.ownerName]);
  const [focus, setFocus] = useState<number | null>(null);
  // The card open in the preview modal, and the list its ‹ › buttons step through.
  const [inspect, setInspect] = useState<{ num: number; list: number[]; } | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [maxLevel, setMaxLevel] = useState(12);
  const [workingOnly, setWorkingOnly] = useState(true);

  const reload = useCallback(() => {
    myDecks(token).then(setMine).catch((e: Error) => notify({ text: e.message, bad: true }));
    decksMadeByMe(token).then(setMade).catch(() => { });
  }, [token, notify]);
  useEffect(() => {
    if (guest) return;
    friendsList(token).then((list) => setFriends(list.friends.map(({ id, name }) => ({ id, name })))).catch(() => { });
  }, [token, guest]);
  useEffect(() => {
    ensureCatalog().then(() => setCards(allCards())).catch((e: Error) => notify({ text: e.message, bad: true }));
    starterDecks().then(setStarters).catch(() => { });
    reload();
  }, [reload, notify]);

  const types = useMemo(() => [...new Set(cards.map((card) => card.type).filter(Boolean) as string[])].sort(), [cards]);
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const num of draft.cards) map.set(num, (map.get(num) ?? 0) + 1);
    return map;
  }, [draft.cards]);

  // The grid draws this many cards at a time (each is a few images); "Show more" adds a page.
  const [limit, setLimit] = useState(PAGE);
  // New filters start again from the first page.
  const [filters, setFilters] = useState("");
  const filterKey = `${search}|${kind}|${type}|${maxLevel}|${workingOnly}`;
  if (filters !== filterKey) { setFilters(filterKey); setLimit(PAGE); }
  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) =>
      (!term || card.name.toLowerCase().includes(term) || card.text?.toLowerCase().includes(term)) &&
      (!kind || card.kind === kind) &&
      (!type || card.type === type) &&
      (card.kind !== "monster" || (card.level ?? 0) <= maxLevel) &&
      // Locked cards (the Gods) are always shown, so players see what they can earn.
      (!workingOnly || card.implemented !== false || card.locked)
    );
  }, [cards, search, kind, type, maxLevel, workingOnly]);
  const shown = useMemo(() => matching.slice(0, limit), [matching, limit]);

  /** How many more copies of a card fit, or why none do. */
  const room = (card: CatalogCard): { free: number; why?: string; } => {
    if (card.locked) return { free: 0, why: `${card.name} is locked.` };
    const space = DECK_SIZE - draft.cards.length;
    const copies = MAX_COPIES - (counts.get(card.num) ?? 0);
    if (space <= 0) return { free: 0, why: `The deck is full (${DECK_SIZE} cards).` };
    if (copies <= 0) return { free: 0, why: `At most ${MAX_COPIES} copies of ${card.name}.` };
    return { free: Math.min(space, copies) };
  };

  const add = (card: CatalogCard, copies = 1) => {
    const n = Math.min(copies, room(card).free);
    if (n <= 0) return;
    notify(null);
    setDraft((d) => ({
      ...d,
      cards: [...d.cards, ...Array(n).fill(card.num)],
    }));
  };

  const open = (num: number, list: number[]) => { playSfx("infoUp", 0.4); setFocus(num); setInspect({ num, list }); };
  const step = useCallback((by: number) => setInspect((cur) => {
    if (!cur) return cur;
    const at = cur.list.indexOf(cur.num);
    if (at < 0 || cur.list.length < 2) return cur;
    const num = cur.list[(at + by + cur.list.length) % cur.list.length];
    setFocus(num);
    return { ...cur, num };
  }), []);

  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, select, textarea")) return;
      if (e.key === "Escape") setInspect(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect, step]);

  const remove = (num: number) => setDraft((d) => {
    const index = d.cards.lastIndexOf(num);
    const next = d.cards.filter((_, i) => i !== index);
    return { ...d, cards: next };
  });

  // A copy goes to whoever a new deck is being built for.
  const load = (deck: DeckSummary, asCopy: boolean) => {
    const next = draftOf(deck, asCopy);
    if (asCopy && !draft.id) Object.assign(next, { ownerId: draft.ownerId, ownerName: draft.ownerName });
    setDraft(next);
    notify(null);
  };
  /** Starts a new deck for someone: "" is ourselves. */
  const startFor = (id: string) => {
    const person = targets.find((t) => t.id === id);
    setDraft((d) => ({ ...d, id: undefined, ownerId: person?.id, ownerName: person?.name }));
    notify(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveDeck(token, {
        name: draft.name, leaderNum: draft.leaderNum, cards: draft.cards, isPublic: draft.isPublic,
        ownerId: draft.id ? undefined : draft.ownerId,
      }, draft.id);
      setDraft((d) => ({ ...d, id: saved.id }));
      if (foreign) {
        notify({ text: `Saved "${saved.name}" for ${draft.ownerName ?? "its owner"}.` });
      } else {
        setDeckId(saved.id); // the lobby picks it next time
        notify({ text: `Saved "${saved.name}". It's now your selected deck.` });
      }
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (!draft.id || !confirm(`Delete "${draft.name}"?`)) return;
    try {
      await deleteDeck(token, draft.id);
      if (useSessionStore.getState().deckId === draft.id) setDeckId("");
      setDraft(emptyDraft());
      notify(null);
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    }
  };

  const cost = draft.cards.reduce((sum, num) => sum + (catalogCard(num)?.deckCost ?? 0), 0);
  const entries = [...counts.entries()]
    .map(([num, count]) => ({ card: catalogCard(num)!, count }))
    .filter((entry) => entry.card)
    .sort((a, b) => KIND_ORDER.indexOf(a.card.kind) - KIND_ORDER.indexOf(b.card.kind) || (b.card.level ?? 0) - (a.card.level ?? 0) || a.card.name.localeCompare(b.card.name));
  const problem = draft.cards.length !== DECK_SIZE ? `${DECK_SIZE - draft.cards.length} more card(s) needed` : draft.leaderNum < 0 ? "choose a deck leader" : "";
  const leaderCard = draft.leaderNum >= 0 ? catalogCard(draft.leaderNum) : undefined;
  // Everything in the deck, the leader's slot included: out of CAPACITY.
  const filled = draft.cards.length + (leaderCard ? 1 : 0);
  const focused = focus !== null ? catalogCard(focus) : undefined;
  const inspected = inspect ? catalogCard(inspect.num) : undefined;

  // The deck being built: beside the cards on wide screens, in a sheet on phones.
  const deckPanel = (
    <>
        {/* Who the deck is for. A saved deck stays whoever's it is; a new one can go to a friend. */}
        {(targets.length > 0 || foreign) && (
          <label className="flex items-center gap-2 text-xs text-white/60">
            Build for
            <select
              className={`${field} flex-1 py-1 text-xs`}
              value={draft.ownerId && foreign ? draft.ownerId : ""}
              disabled={!!draft.id}
              title={draft.id ? "A saved deck stays with its owner. Press New to start one for someone else." : undefined}
              onChange={(e) => startFor(e.target.value)}
            >
              <option value="">Me</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        {foreign && (
          <div className="flex flex-wrap items-center gap-2 border border-fuchsia-400/50 bg-fuchsia-950/40 p-2 text-xs text-fuchsia-100">
            <span className="flex-1">
              {draft.id ? <>Editing <b>{draft.ownerName}</b>'s deck. Saving changes it for them; it stays theirs.</>
                : <>Building a deck for <b>{draft.ownerName}</b>. When you save, it goes into their decks.</>}
            </span>
            <button className={mini} onClick={() => showProfile(draft.ownerName)}>← Their page</button>
          </div>
        )}
        <div className="flex gap-2">
          <input className={`${field} flex-1`} value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <button className={ghost} onClick={() => { setDraft({ ...emptyDraft(), ownerId: draft.ownerId, ownerName: draft.ownerName }); notify(null); }}>New</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <b className={filled === CAPACITY ? "text-emerald-300" : "text-yellow-300"}>{filled}/{CAPACITY}</b>
          <span className="text-white/60">{draft.cards.length}/{DECK_SIZE} cards + leader</span>
          <span className="text-white/60">deck cost {cost}</span>
          <label className="flex items-center gap-1.5 text-white/70"><input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} /> public</label>
        </div>

        {/* The leader's own slot: any monster, apart from the 40 cards. */}
        <div className="flex items-center gap-2 border border-dashed border-yellow-400/50 bg-yellow-950/20 p-1.5 text-xs">
          {leaderCard ? (
            <>
              <button onClick={() => open(leaderCard.num, [leaderCard.num])} className="shrink-0" title="Preview">
                <CardFace num={leaderCard.num} className="w-10" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-yellow-300/80">♛ Deck leader</p>
                <p className="truncate font-bold text-yellow-200">{leaderCard.name}</p>
                <p className="text-white/50">★{leaderCard.level} {leaderCard.atk}/{leaderCard.def}</p>
              </div>
              <button className={mini} title="Clear the leader slot" onClick={() => setDraft({ ...draft, leaderNum: -1 })}>✕</button>
            </>
          ) : (
            <>
              <div className="grid aspect-[68/98] w-10 shrink-0 place-items-center border border-dashed border-white/30 text-lg text-white/40">♛</div>
              <p className="text-white/60"><b className="text-yellow-200">Deck leader</b> — open any monster and tap <i>Set as leader</i>. It does not take one of the 40 slots.</p>
            </>
          )}
        </div>

        <div className="min-h-20 flex-1 overflow-y-auto overscroll-contain">
          {entries.length === 0 && <p className="text-xs text-white/50">Empty. Add cards from the list, or start from a deck below.</p>}
          {entries.map(({ card, count }) => (
            <div key={card.num} className="flex items-center gap-2 border-t border-white/10 py-1 text-xs" onMouseEnter={() => setFocus(card.num)}>
              <span className="text-white/50">{count}×</span>
              <button
                className="flex-1 truncate text-left hover:text-yellow-200"
                title="Preview"
                onClick={() => open(card.num, entries.map((e) => e.card.num))}
              >{card.name}</button>
              <span className="text-white/50">{card.kind === "monster" ? `★${card.level}` : card.kind}</span>
              <button className={mini} title="Remove one" onClick={() => remove(card.num)}>−</button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={!!problem || busy} onClick={save}>{draft.id ? "Save changes" : "Save deck"}</button>
          <button className={ghost} disabled={filled === 0} onClick={() => setPreviewOpen(true)}>👁 Preview</button>
          <button
            className={ghost}
            disabled={filled === 0}
            title="Take every card and the leader out of this deck"
            onClick={() => {
              if (confirm(`Clear all ${filled} card${filled === 1 ? "" : "s"} from "${draft.name}"? ${draft.id ? "The saved deck stays as it was until you save." : "This can't be undone."}`)) {
                setDraft((d) => ({ ...d, cards: [], leaderNum: -1 }));
              }
            }}
          >🗑 Clear</button>
          {draft.id && <button className={danger} onClick={destroy}>Delete</button>}
          {problem && <span className="text-xs text-white/50">{problem}</span>}
        </div>

        <div className="max-h-[30%] shrink-0 overflow-y-auto overscroll-contain text-xs lg:max-h-56">
          <p className="text-white/60">Your decks</p>
          {mine.length === 0 && <p className="text-white/40">None yet.</p>}
          {mine.map((deck) => (
            <div key={deck.id} className="flex items-center gap-2 border-t border-white/10 py-1">
              <span className="flex-1 truncate">{deck.name}{deck.madeByName && <span className="text-white/40"> · made by {deck.madeByName}</span>}</span>
              <span className="text-white/50">{deck.deckCost}</span>
              <button className={mini} onClick={() => load(deck, false)}>Edit</button>
            </div>
          ))}
          {made.length > 0 && <p className="mt-2 text-white/60">Decks you made for friends</p>}
          {made.map((deck) => (
            <div key={deck.id} className="flex items-center gap-2 border-t border-white/10 py-1">
              <span className="flex-1 truncate">{deck.name} <span className="text-white/40">· for {deck.ownerName}</span></span>
              <span className="text-white/50">{deck.deckCost}</span>
              <button className={mini} onClick={() => load(deck, false)}>Edit</button>
            </div>
          ))}
          <p className="mt-2 text-white/60">Starter decks</p>
          {starters.map((deck) => (
            <div key={deck.id} className="flex items-center gap-2 border-t border-white/10 py-1" title={deck.description}>
              <span className="flex-1 truncate">{deck.name}</span><span className="text-white/50">{deck.deckCost}</span>
              <button className={mini} onClick={() => load(deck, true)}>Copy</button>
            </div>
          ))}
        </div>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-3">
      <section className={`${panel} min-h-0 flex-1 gap-2 p-2 sm:p-3 lg:gap-3 lg:p-4`}>
        <div className="flex flex-wrap gap-1 lg:gap-2">
          <input className={`${filter} w-full lg:w-auto lg:flex-[1_1_10rem]`} placeholder="Search name or effect…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={`${filter} flex-1 lg:flex-none`} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {KIND_ORDER.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className={`${filter} flex-1 lg:flex-none`} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={`${filter} flex-1 lg:flex-none`} value={maxLevel} onChange={(e) => setMaxLevel(Number(e.target.value))} title="Highest monster level">
            {[12, 8, 6, 4, 3].map((level) => <option key={level} value={level}>level ≤ {level}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-white/70 lg:gap-1.5 lg:text-xs">
            <input type="checkbox" checked={workingOnly} onChange={(e) => setWorkingOnly(e.target.checked)} /> working only
          </label>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] content-start gap-1.5 overflow-y-auto overscroll-contain pb-28 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] lg:gap-2 lg:pb-0">
          {cards.length === 0 && <p className="col-span-full text-sm text-white/50">Loading cards…</p>}
          {shown.map((card) => (
            <button
              key={card.num}
              onClick={() => open(card.num, shown.map((c) => c.num))}
              onMouseEnter={() => setFocus(card.num)}
              title={card.text}
              className={`relative border border-white/15 bg-black/50 p-1 text-left hover:border-yellow-400 active:border-yellow-400 ${card.implemented === false && !card.locked ? "opacity-50 grayscale" : ""}`}
            >
              <CardFace num={card.num} className="w-full" />
              {card.locked && <span className="absolute inset-x-1 top-1 flex aspect-[68/98] items-center justify-center bg-black/55 text-2xl" title="Locked">🔒</span>}
              {card.num === draft.leaderNum && <span className="absolute left-1.5 top-1.5 bg-black/80 px-1 text-[11px] text-yellow-300 shadow" title="Deck leader">♛</span>}
              {counts.has(card.num) && <span className="absolute right-1.5 top-1.5 bg-yellow-400 px-1.5 text-[11px] font-bold text-black shadow">{counts.get(card.num)}</span>}
              <span className="mt-0.5 block truncate text-[10px] lg:mt-1 lg:text-[11px]">{card.name}</span>
              <span className="block truncate text-[9px] text-white/50 lg:text-[10px]">{card.kind === "monster" ? `★${card.level} ${card.atk}/${card.def}` : card.kind} · {card.deckCost ?? 0}</span>
            </button>
          ))}
          {matching.length > shown.length && (
            <div className="col-span-full flex flex-col items-center gap-1 py-2 text-xs text-white/50">
              Showing {shown.length} of {matching.length} cards
              <button className={ghost} onClick={() => setLimit((n) => n + PAGE)}>Show more</button>
            </div>
          )}
        </div>

        <div className="hidden min-h-24 gap-3 border-t border-white/10 pt-2 text-xs lg:flex">
          {focused ? (
            <>
              <CardFace num={focused.num} className="w-24 shrink-0" />
              <div className="min-w-0">
                <b className="text-yellow-200">{focused.name}</b>{" "}
                <span className="text-white/50">#{focused.num} · {focused.kind === "monster" ? `${focused.type} · ${focused.attribute} · level ${focused.level} · ${focused.atk}/${focused.def}` : focused.kind} · deck cost {focused.deckCost ?? 0}</span>
                <p className="mt-1">{focused.text || <span className="text-white/50">No effect.</span>}</p>
                {focused.locked ? <p className="text-yellow-300/80">🔒 Locked: this card cannot be added to a deck yet.</p>
                  : focused.implemented === false && <p className="text-white/50">This card's effect is not available in the game yet.</p>}
                {focused.abilityPending && <p className="text-white/50">The monster plays normally; its special ability is not active yet.</p>}
              </div>
            </>
          ) : <span className="text-white/50">Tap a card to preview it and add it to the deck. Hover to read it.</span>}
        </div>
      </section>

      {/* Wide screens: the deck sits beside the cards. */}
      <aside className={`${panel} hidden lg:flex lg:min-h-0`}>
        {deckPanel}
      </aside>

      {/* Phones and tablets: the deck is a stack of card backs at the right; tap it for the deck. */}
      <button
        onClick={() => setDeckOpen(true)}
        className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-50 h-24 w-[4.25rem] lg:hidden"
        aria-label={`Your deck: ${filled} of ${CAPACITY} slots filled (${DECK_SIZE} cards and the leader)`}
      >
        {[2, 1, 0].map((i) => (
          <img
            key={i}
            src={CARD_BACK}
            alt=""
            draggable={false}
            className="absolute bottom-0 left-0 w-14 shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
            style={{ transform: `translate(${i * 4}px, ${-i * 4}px)`, opacity: draft.cards.length > i || i === 0 ? 1 : 0.35 }}
          />
        ))}
        <span className={`absolute -right-1 -top-1 px-1.5 py-0.5 font-mono text-[11px] font-bold text-black shadow ${filled === CAPACITY ? "bg-emerald-400" : "bg-yellow-400"}`}>
          {filled}/{CAPACITY}
        </span>
      </button>

      {deckOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/80 px-[max(0.5rem,env(safe-area-inset-left))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[calc(var(--hud-top)+3rem)] lg:hidden"
          onClick={() => setDeckOpen(false)}
        >
          <div className={`${panel} min-h-0 flex-1`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <b className="text-yellow-300">Your deck</b>
              <button className={mini} onClick={() => setDeckOpen(false)} aria-label="Close the deck">✕ Close</button>
            </div>
            {deckPanel}
          </div>
        </div>
      )}

      {previewOpen && (
        <DeckPreview
          name={draft.name}
          leader={leaderCard?.num}
          cards={entries.flatMap(({ card, count }) => Array<number>(count).fill(card.num))}
          filled={filled}
          cost={cost}
          onOpen={(num, list) => open(num, list)}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {inspected && (
        <CardInspector num={inspected.num} onClose={() => setInspect(null)}>
          <DeckActions
            card={inspected}
            count={counts.get(inspected.num) ?? 0}
            total={draft.cards.length}
            leader={draft.leaderNum === inspected.num}
            room={room(inspected)}
            position={inspect && inspect.list.length > 1 && inspect.list.includes(inspected.num) ? `${inspect.list.indexOf(inspected.num) + 1}/${inspect.list.length}` : ""}
            onAdd={(n) => { add(inspected, n); setInspect(null); }}
            onRemove={() => remove(inspected.num)}
            onLeader={(on) => { setDraft((d) => ({ ...d, leaderNum: on ? inspected.num : -1 })); if (on) setInspect(null); }}
            onStep={step}
            onClose={() => setInspect(null)}
          />
        </CardInspector>
      )}
    </div>
  );
}

/**
 * The deck being built, every card laid out on one full screen: the leader
 * first, then each copy of each card in the deck list's order. Tapping a card
 * opens it in the inspector, which sits above this.
 */
function DeckPreview({ name, leader, cards, filled, cost, onOpen, onClose }: {
  name: string; leader?: number; cards: number[]; filled: number; cost: number;
  onOpen: (num: number, list: number[]) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const list = [...new Set(leader != null ? [leader, ...cards] : cards)];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
      className="fixed inset-0 z-[70] flex flex-col gap-3 bg-black/95 px-[max(0.75rem,env(safe-area-inset-left))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] font-mono text-white md:backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-yellow-300">{name}</p>
          <p className="text-xs text-white/60">{filled}/{CAPACITY} cards · deck cost {cost}</p>
        </div>
        <button className={ghost} onClick={onClose} aria-label="Close the preview">✕ Close</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
          {leader != null && (
            <button className="relative ring-2 ring-yellow-400" title="Deck leader" onClick={() => onOpen(leader, list)}>
              <CardFace num={leader} className="w-full" />
              <span className="absolute left-1 top-1 bg-yellow-400 px-1 text-[10px] font-bold text-black">♛ Leader</span>
            </button>
          )}
          {cards.map((num, i) => (
            <button key={i} className="hover:ring-2 hover:ring-yellow-300" onClick={() => onOpen(num, list)}>
              <CardFace num={num} className="w-full" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DeckActionsProps {
  card: CatalogCard;
  count: number;
  total: number;
  leader: boolean;
  room: { free: number; why?: string; };
  position: string;
  onAdd: (copies: number) => void;
  onRemove: () => void;
  /** Put this card in the leader slot (true), or empty the slot (false). */
  onLeader: (on: boolean) => void;
  onStep: (by: number) => void;
  onClose: () => void;
}

/** The deck controls under the previewed card. */
function DeckActions({ card, count, total, leader, room, position, onAdd, onRemove, onLeader, onStep, onClose }: DeckActionsProps) {
  const monster = card.kind === "monster";
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-white/70">
        <span>In deck <b className="text-white">{count}/{MAX_COPIES}</b></span>
        <span>Deck <b className={total === DECK_SIZE ? "text-emerald-300" : "text-white"}>{total}/{DECK_SIZE}</b></span>
        <span>Deck cost <b className="text-white">{card.deckCost ?? 0}</b></span>
        {leader && <span className="text-yellow-300">♛ Deck leader</span>}
      </div>
      {card.locked ? <p className="text-yellow-300/80">🔒 Locked: this card cannot be added to a deck yet.</p>
        : card.implemented === false && <p className="text-white/50">This card's effect is not available in the game yet.</p>}

      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={room.free < 1} onClick={() => onAdd(1)} autoFocus>Add to deck</button>
        {room.free > 1 && <button className={ghost} onClick={() => onAdd(room.free)}>Add ×{room.free}</button>}
        {/* The leader has its own slot: setting one never uses up a deck slot. */}
        {monster && !leader && !card.locked && <button className={ghost} onClick={() => onLeader(true)}>Set as leader ♛</button>}
        {leader && <button className={ghost} onClick={() => onLeader(false)}>Remove as leader</button>}
        {count > 0 && <button className={danger} onClick={onRemove}>Remove one</button>}
      </div>
      {room.why && <p className="text-yellow-300/80">{room.why}</p>}

      <div className="flex items-center gap-2">
        {position && (
          <>
            <button className={ghost} onClick={() => onStep(-1)} aria-label="Previous card">‹</button>
            <span className="text-white/50">{position}</span>
            <button className={ghost} onClick={() => onStep(1)} aria-label="Next card">›</button>
          </>
        )}
        <button className={`${ghost} ml-auto`} onClick={() => { playSfx("cancel", 0.4); onClose(); }}>Cancel</button>
      </div>
    </div>
  );
}

// --- maps ------------------------------------------------------------------

function MapEditor({ token, userId, notify }: { token: string; userId: string; notify: Notify; }) {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState("New map");
  const [size, setSize] = useState(7);
  const [tiles, setTiles] = useState<string[]>(() => Array(49).fill("normal"));
  const [brush, setBrush] = useState("forest");
  const [mirror, setMirror] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [painting, setPainting] = useState(false);
  const [busy, setBusy] = useState(false);
  const board = useRef<HTMLElement>(null);

  const reload = useCallback(() => listMaps(token).then(setMaps).catch((e: Error) => notify({ text: e.message, bad: true })), [token, notify]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const stop = () => setPainting(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => { window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
  }, []);

  const resize = (next: number) => { setSize(next); setTiles(Array(next * next).fill("normal")); };

  const paint = (index: number) => setTiles((current) => {
    const next = [...current];
    next[index] = brush;
    // Mirroring through the centre keeps the map fair for both sides.
    if (mirror) next[current.length - 1 - index] = brush;
    return next;
  });

  // Touch dragging keeps firing on the square it started on, so find the square under the finger.
  const paintAt = (x: number, y: number) => {
    const index = (document.elementFromPoint(x, y) as HTMLElement | null)?.dataset.tile;
    if (index !== undefined) paint(Number(index));
  };

  // Tiles are stored from the south-west corner; draw the north row first.
  const half = Math.floor(size / 2);
  const rows = Array.from({ length: size }, (_, row) => size - 1 - row);
  const isStart = (x: number, y: number) => (x === half && (y === 0 || y === size - 1)) || (y === half && (x === 0 || x === size - 1));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveMap(token, { name, size, tiles, isPublic }, id);
      setId(saved.id);
      notify({ text: `Saved "${saved.name}". Pick it from the map list in the menu.` });
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const load = (map: MapSummary) => {
    // Default maps are read-only: loading one starts a copy.
    const own = !map.preset && map.ownerId === userId;
    setId(own ? map.id : undefined);
    setName(own ? map.name : `${map.name} (copy)`.slice(0, 40));
    setSize(map.size);
    setTiles([...map.tiles]);
    setIsPublic(own ? !!map.isPublic : false);
    notify(null);
    // On phones the map list is below the board: bring the loaded map into view.
    if (window.matchMedia("(max-width: 1023px)").matches) board.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const destroy = async () => {
    if (!id || !confirm(`Delete "${name}"?`)) return;
    try {
      await deleteMap(token, id);
      setId(undefined);
      notify(null);
      reload();
    } catch (e) {
      notify({ text: (e as Error).message, bad: true });
    }
  };

  return (
    // Phones: the screen scrolls, so neither panel may shrink below its content
    // (panels are min-h-0), or the settings would be drawn over the board.
    <div className="flex flex-col gap-3 max-lg:flex-none lg:min-h-0 lg:flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section ref={board} className={`${panel} scroll-mt-2 items-center max-lg:shrink-0 max-lg:min-h-fit lg:min-h-0`}>
        <div className="flex flex-wrap justify-center gap-1.5">
          {TERRAINS.map((terrain) => (
            <button key={terrain} className={`flex items-center gap-1.5 border px-2 py-1 text-xs capitalize pointer-coarse:min-h-10 ${brush === terrain ? "border-yellow-400 text-yellow-200" : "border-white/20"}`} onClick={() => setBrush(terrain)}>
              <i className="inline-block h-4 w-4 bg-cover" style={{ backgroundImage: `url(${terrainUrl(terrain)})` }} />{terrain}
            </button>
          ))}
        </div>
        <div
          className="grid aspect-square w-full max-w-[min(100%,70dvh)] shrink-0 touch-none select-none gap-0.5"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
          onPointerMove={(e) => painting && e.pointerType !== "mouse" && paintAt(e.clientX, e.clientY)}
        >
          {rows.flatMap((y) => Array.from({ length: size }, (_, x) => {
            const index = y * size + x;
            return (
              <div
                key={index}
                data-tile={index}
                className="relative bg-cover"
                style={{ backgroundImage: `url(${terrainUrl(tiles[index])})` }}
                onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); setPainting(true); paint(index); }}
                onPointerEnter={(e) => painting && e.pointerType === "mouse" && paint(index)}
              >
                {isStart(x, y) && <span className="pointer-events-none absolute inset-0 grid place-items-center text-white [text-shadow:0_0_4px_#000]">★</span>}
              </div>
            );
          }))}
        </div>
        <p className="text-xs text-white/50">Tap or drag to paint. ★ marks where deck leaders start (south and north; east and west too in 2v2). A leader's own square is cleared to normal ground when a duel begins.</p>
      </section>

      <aside className={`${panel} max-lg:shrink-0 max-lg:min-h-fit lg:min-h-0`}>
        <input className={field} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
          <label className="flex items-center gap-1.5">size
            <select className={field} value={size} onChange={(e) => resize(Number(e.target.value))}>
              {[5, 7, 9, 11, 13].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirror</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> public</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={save}>{id ? "Save changes" : "Save map"}</button>
          <button className={ghost} onClick={() => { setId(undefined); setName("New map"); setTiles(Array(size * size).fill("normal")); notify(null); }}>New</button>
          {id && <button className={danger} onClick={destroy}>Delete</button>}
        </div>
        {/* Phones: the whole list, scrolled with the page; wide screens: it scrolls on its own. */}
        <div className="text-xs lg:min-h-20 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          <p className="text-white/60">Maps</p>
          {maps.length === 0 && <p className="text-white/40">None yet.</p>}
          {maps.map((map) => (
            <div key={map.id} className="flex items-center gap-2 border-t border-white/10 py-1">
              <span className="flex-1 truncate">{map.name}</span>
              <span className="text-white/50">{map.size}×{map.size} · {map.preset ? <span className="text-yellow-300">Default</span> : map.ownerName}</span>
              <button className={mini} onClick={() => load(map)}>{!map.preset && map.ownerId === userId ? "Edit" : "Copy"}</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** The deck builder and map editor, reached from the menu. */
export default function Builder() {
  const { token, user } = useSessionStore();
  const screen = useMenuStore((s) => s.screen);
  const setScreen = useMenuStore((s) => s.setScreen);
  const [notice, setNotice] = useState<Notice>(null);

  const go = (next: MenuScreen) => { setNotice(null); setScreen(next); };

  // Signed out (or the session expired): back to the menu to sign in.
  useEffect(() => { if (!token || !user) setScreen("lobby"); }, [token, user, setScreen]);
  // Good news fades on its own; problems stay until dismissed or replaced.
  useEffect(() => {
    if (!notice || notice.bad) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!token || !user) return null;

  // Header buttons: small on phones.
  const headerButton = " border border-white/25 px-2.5 py-1 text-xs hover:border-white active:border-yellow-400 lg:px-3 lg:py-2 lg:text-sm pointer-coarse:lg:min-h-11";
  const tab = (target: MenuScreen, label: string) => (
    <button className={`${headerButton} lg:order-3 ${screen === target ? "border-yellow-400 text-yellow-200" : ""}`} onClick={() => go(target)}>{label}</button>
  );

  return (
    <div className={`absolute inset-0 z-40 flex flex-col gap-2 overscroll-contain bg-black/40 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-(--hud-top) font-mono text-white lg:gap-3 lg:overflow-hidden lg:p-3 lg:pr-[max(0.75rem,env(safe-area-inset-right))] lg:pt-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] ${screen === "maps" ? "overflow-y-auto" : "overflow-hidden"}`}>
      <header className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
        {/* Room on the right for the settings gear. */}
        <h1 className="pr-12 text-lg font-bold leading-tight text-yellow-300 lg:order-2 lg:mr-2 lg:pr-0 lg:text-xl">{screen === "maps" ? "Map editor" : "Deck builder"}</h1>
        <div className="flex items-center gap-1.5 lg:contents">
          <button className={`${headerButton} lg:order-1`} onClick={() => go("lobby")}>← Menu</button>
          {tab("decks", "Decks")}
          {tab("maps", "Maps")}
          <span className="ml-auto truncate text-[11px] text-white/60 lg:order-4 lg:text-xs">{user.name}{user.guest && " (guest)"}</span>
        </div>
      </header>
      {/* Phones: a toast above everything (the deck sheet included); tap to dismiss. */}
      {notice && (
        <p
          onClick={() => setNotice(null)}
          className={`text-sm max-lg:fixed max-lg:inset-x-2 max-lg:top-[calc(var(--hud-top)+3rem)] max-lg:z-[70] max-lg:border max-lg:border-white/20 max-lg:bg-black/95 max-lg:px-3 max-lg:py-2 max-lg:text-xs ${notice.bad ? "text-rose-300" : "text-emerald-300"}`}
        >
          {notice.text}
        </p>
      )}
      {screen === "maps"
        ? <MapEditor token={token} userId={user.id} notify={setNotice} />
        : <DeckBuilder token={token} notify={setNotice} />}
    </div>
  );
}
