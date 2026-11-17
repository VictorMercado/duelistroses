import { useDeferredValue, useMemo, useState } from "react";
import { allCards, catalogCard } from "@/game/catalog";
import { useInteraction } from "@/game/interaction";
import { session } from "@/net/session";
import { useGameStore } from "@/stores/gameStore";
import CardFace from "@/components/ui/CardFace";
import { ThoughtList } from "@/components/ui/GameOverlays";

const button = " border border-white/20 px-2 py-1 hover:border-fuchsia-300 disabled:opacity-40 pointer-coarse:py-2";
const KINDS = ["all", "monster", "spell", "trap", "ritual"] as const;

/**
 * An administrator's test tools while playing: any card into the hand or
 * onto the field, the deck in any order, and a fresh turn. The server checks
 * that the player really is an administrator; everyone in the duel sees in
 * the log that the tools were used.
 *
 * Phones and tablets show it in the HUD, under the right-hand player stats
 * (`inHud`); desktops keep it on the left of the screen.
 */
export default function TestTools({ inHud = false }: { inHud?: boolean }) {
  const tools = useGameStore((s) => s.tools);
  const playing = useGameStore((s) => s.view?.phase === "playing");
  const sandbox = useGameStore((s) => !!s.sandbox);
  // A sandbox is all about the tools: they start open there.
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? sandbox;
  const thoughts = useGameStore((s) => s.thoughts.length);
  const [chosen, setTab] = useState<"cards" | "deck" | "thinking">("cards");
  if (!tools || !playing) return null;
  // The thinking tab is there only while a Claude player has thought something.
  const tab = chosen === "thinking" && thoughts === 0 ? "cards" : chosen;
  const tabs = thoughts > 0 ? (["cards", "deck", "thinking"] as const) : (["cards", "deck"] as const);
  const label = { cards: "Any card", deck: "My deck", thinking: `🧠 Thinking (${thoughts})` };

  return (
    <div className={`font-mono text-[11px] text-white ${inHud ? "relative lg:hidden" : "absolute left-2 top-24 z-30 max-lg:hidden"}`}>
      <button className="border border-fuchsia-400/60 bg-black/80 px-2 py-1 font-bold text-fuchsia-300 pointer-coarse:py-2" onClick={() => setOpen(!open)}>
        {sandbox ? "🧪 Sandbox" : "🛠 Test tools"} {open ? "−" : "+"}
      </button>
      {open && (
        <div className={`mt-1 flex w-[min(22rem,calc(100vw-1rem))] flex-col ${inHud ? "absolute right-0 top-full max-h-[60dvh]" : "max-h-[70dvh]"} gap-2  border border-fuchsia-400/50 bg-black/85 p-2`}>
          {sandbox && <SandboxControls />}
          <SeatControls />
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button key={t} className={`${button} ${tab === t ? "border-fuchsia-300 text-fuchsia-200" : ""}`} onClick={() => setTab(t)}>
                {label[t]}
              </button>
            ))}
            <button className={`${button} ml-auto`} title="Full summoning power, a card to play, and every piece ready to act" onClick={() => session.adminTool({ op: "refresh" })}>
              ⟳ Refresh turn
            </button>
          </div>
          {tab === "cards" ? <CardBrowser /> : tab === "deck" ? <DeckEditor /> : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><ThoughtList /></div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The sandbox's own controls: which seat we play, whether that follows the
 * turn, and whether cards are free.
 */
function SandboxControls() {
  const sandbox = useGameStore((s) => s.sandbox);
  const seat = useGameStore((s) => s.seat);
  const seats = useGameStore((s) => s.view?.seats.length ?? 2);
  const turn = useGameStore((s) => s.view?.turn ?? -1);
  if (!sandbox) return null;
  const name = (i: number) => (i === 0 ? "Your side" : "Opponent");
  return (
    <div className="flex flex-col gap-1 border border-fuchsia-400/30 p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-white/60">Control:</span>
        {Array.from({ length: seats }, (_, i) => (
          <button
            key={i}
            className={`${button} ${seat === i ? "border-fuchsia-300 bg-fuchsia-900/50 text-fuchsia-100" : ""}`}
            title="Play this seat: its hand, its moves, and the tools act on it"
            onClick={() => session.adminTool({ op: "control", seat: i })}
          >
            {name(i)}{turn === i ? " ⏵" : ""}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5" title="Switch to whichever seat's turn it is, or who has a choice to make">
        <input type="checkbox" checked={sandbox.follow} onChange={(e) => session.adminTool({ op: "follow", on: e.target.checked })} />
        Follow the turn
      </label>
      <label className="flex items-center gap-1.5" title="Every seat has full summoning power and unlimited plays; no 5-card field limit">
        <input type="checkbox" checked={sandbox.unlimited} onChange={(e) => session.adminTool({ op: "unlimited", on: e.target.checked })} />
        Free play (no star cost, unlimited plays and field slots)
      </label>
    </div>
  );
}

/** Life points for the seat we play, and taking the card under the cursor off the field. */
function SeatControls() {
  const lp = useGameStore((s) => s.view?.seats[s.seat]?.lp);
  const cursor = useInteraction((s) => s.cursor);
  const target = useGameStore((s) => s.view?.cards.find((c) => c.x === cursor.x && c.y === cursor.y));
  const [draft, setDraft] = useState("");
  const setLP = () => {
    const value = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(value)) session.adminTool({ op: "lp", num: Math.round(value) });
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setLP(); }}>
        <input
          className="w-20 border border-white/20 bg-black/60 px-2 py-1 outline-none focus:border-fuchsia-300"
          inputMode="numeric"
          placeholder={`LP ${lp ?? ""}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9-]/g, ""))}
        />
        <button className={button} disabled={!draft}>Set LP</button>
      </form>
      <button
        className={`${button} ml-auto`}
        disabled={!target}
        title="Sends the card under the board cursor to its owner's graveyard"
        onClick={() => target && session.adminTool({ op: "remove", num: target.id })}
      >
        🗑 Remove ({cursor.x}, {cursor.y})
      </button>
    </div>
  );
}

function CardBrowser() {
  const [query, setQuery] = useState("");
  const [faceUp, setFaceUp] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [picked, setPicked] = useState<number | null>(null);
  const cursor = useInteraction((s) => s.cursor);
  const search = useDeferredValue(query.trim().toLowerCase());

  const matches = useMemo(() => {
    const byNum = /^\d+$/.test(search) ? Number(search) : null;
    return allCards()
      .filter((c) => kind === "all" || c.kind === kind)
      .filter((c) => !search || c.num === byNum || c.name.toLowerCase().includes(search) || c.type?.includes(search))
      .slice(0, 100);
  }, [search, kind]);

  const card = picked !== null ? catalogCard(picked) : undefined;
  return (
    <>
      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 border border-white/20 bg-black/60 px-2 py-1 text-[12px] outline-none focus:border-fuchsia-300"
          placeholder="Search name, number or type"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="border border-white/20 bg-black/60 px-1" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {card && (
        <div className="flex gap-2 border border-white/10 p-1.5">
          <CardFace num={card.num} className="w-24 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-bold text-yellow-200">{card.name}</p>
            <p className="text-white/60">#{card.num} · {card.kind}{card.type ? ` · ${card.type}` : ""}{card.kind === "monster" ? ` · ${card.atk}/${card.def}` : ""}</p>
            {card.text && <p className="line-clamp-4 text-white/70">{card.text}</p>}
            <div className="mt-auto flex flex-wrap gap-1">
              <button className={button} onClick={() => session.adminTool({ op: "give", num: card.num, field: false })}>+ Hand</button>
              <button
                className={button}
                title="Lands on the square under the board cursor, for the seat you play: tap a square first"
                onClick={() => session.adminTool({ op: "give", num: card.num, field: true, x: cursor.x, y: cursor.y, up: faceUp })}
              >
                + Field ({cursor.x}, {cursor.y})
              </button>
              <label className="flex items-center gap-1 text-white/70" title="Put it on the field face up (its flip effect does not run)">
                <input type="checkbox" checked={faceUp} onChange={(e) => setFaceUp(e.target.checked)} /> face up
              </label>
            </div>
          </div>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {matches.map((c) => (
          <li key={c.num}>
            <button
              className={`flex w-full justify-between gap-2 px-1 py-0.5 text-left hover:bg-white/10 pointer-coarse:py-1.5 ${c.num === picked ? "bg-fuchsia-900/50" : ""}`}
              onClick={() => setPicked(c.num)}
            >
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 text-white/50">{c.kind === "monster" ? `${c.atk}/${c.def}` : c.kind}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="text-white/50">No card matches.</li>}
      </ul>
    </>
  );
}

/** The rest of our deck, next draw first. Each change is sent at once. */
function DeckEditor() {
  const deck = useGameStore((s) => s.view?.deck);
  const [dragging, setDragging] = useState<number | null>(null);
  if (!deck) return <p className="text-white/50">The deck is not available yet.</p>;
  if (deck.length === 0) return <p className="text-white/50">The deck is empty.</p>;

  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= deck.length) return;
    const next = [...deck];
    const [card] = next.splice(from, 1);
    next.splice(to, 0, card);
    session.adminTool({ op: "deck", deck: next });
  };
  const shuffle = () => {
    const next = [...deck];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    session.adminTool({ op: "deck", deck: next });
  };

  return (
    <>
      <p className="flex items-center justify-between text-white/60">
        {deck.length} cards, next draw first. Drag, or use the arrows.
        <button className={button} onClick={shuffle}>Shuffle</button>
      </p>
      <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {deck.map((num, i) => (
          <li
            key={`${i}-${num}`}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragging !== null) reorder(dragging, i); setDragging(null); }}
            onDragEnd={() => setDragging(null)}
            className={`flex items-center gap-1 px-1 py-0.5 hover:bg-white/10 ${dragging === i ? "opacity-40" : ""}`}
          >
            <span className="w-5 shrink-0 text-right text-white/40">{i + 1}</span>
            <span className="min-w-0 flex-1 cursor-grab truncate">{catalogCard(num)?.name ?? `#${num}`}</span>
            <button className="px-1 text-white/60 hover:text-white disabled:opacity-20" disabled={i === 0} title="To the top" onClick={() => reorder(i, 0)}>⤒</button>
            <button className="px-1 text-white/60 hover:text-white disabled:opacity-20" disabled={i === 0} title="Up" onClick={() => reorder(i, i - 1)}>↑</button>
            <button className="px-1 text-white/60 hover:text-white disabled:opacity-20" disabled={i === deck.length - 1} title="Down" onClick={() => reorder(i, i + 1)}>↓</button>
            <button className="px-1 text-white/60 hover:text-white disabled:opacity-20" disabled={i === deck.length - 1} title="To the bottom" onClick={() => reorder(i, deck.length - 1)}>⤓</button>
          </li>
        ))}
      </ol>
    </>
  );
}
