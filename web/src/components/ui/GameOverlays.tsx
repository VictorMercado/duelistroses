import { useEffect, useRef, useState } from "react";
import { VoiceButton, VoicePanel } from "./Voice";
import { create } from "zustand";
import { selectCanPause, selectPerspective, useGameStore } from "@/stores/gameStore";
import { useSessionStore } from "@/stores/sessionStore";
import { cardArt, catalogCard, HIDDEN_NUM } from "@/game/catalog";
import { closeTilePreview, commitPicked, graveyardOf, handOwner, visibleHand, inspectCursorCard, inspectCursorTile, pointChoice, pointGraveCard, pointGraveyard, pointHand, press, selectChoice, stagedDefense, useInteraction, type Mode } from "@/game/interaction";
import { GLYPHS } from "@/input/actions";
import { keyFor } from "@/input/keyboard";
import { session } from "@/net/session";
import { useReplaying } from "@/net/replay";
import CardFace from "./CardFace";
import { buttonColor, hintsFor, terrainOf, trackBarHeight, type Hint } from "@/game/hints";
import { ASSET_URL, MONSTER_KINDS, NEGATIVE_TERRAIN, POSITIVE_TERRAIN } from "@/const";
import type { TerrainType } from "@/types";
import ExodiaOverlay from "./ExodiaOverlay";
import { useExodiaStore } from "@/stores/exodiaStore";

// What each terrain does, worked out from the type table in const.ts so the
// panel can never disagree with it.
const TERRAIN_RULES: Record<string, string> = {
  crush: "Destroys any non-Immortal monster with 1500+ ATK that enters.",
  labyrinth: "Cannot be entered.",
};

function terrainNote(terrain: string): string {
  const label = (kind: string) => kind.replace(/(^|-)\w/g, (c) => c.toUpperCase()).replace("-", " ");
  const strong = MONSTER_KINDS.filter((k) => k.strongIn.includes(terrain as TerrainType)).map((k) => label(k.monster));
  const weak = MONSTER_KINDS.filter((k) => k.weakIn.includes(terrain as TerrainType)).map((k) => label(k.monster));
  const parts: string[] = [];
  if (strong.length) parts.push(`+${POSITIVE_TERRAIN} ATK/DEF: ${strong.join(", ")}.`);
  // Almost every type is weak on toon terrain; say so instead of listing them.
  if (weak.length > MONSTER_KINDS.length / 2) parts.push(`${NEGATIVE_TERRAIN} ATK/DEF: everything else.`);
  else if (weak.length) parts.push(`${NEGATIVE_TERRAIN} ATK/DEF: ${weak.join(", ")}.`);
  if (TERRAIN_RULES[terrain]) parts.push(TERRAIN_RULES[terrain]);
  return parts.join(" ") || "No effect.";
}

/** A monster's level as a row of stars, as printed on the card. */
function LevelStars({ level }: { level: number; }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-label={`Level ${level}`} title={`Level ${level}`}>
      {Array.from({ length: level }, (_, i) => (
        <img key={i} src={ASSET_URL + "/textures/levelStar.png"} alt="" className="h-4 w-4" draggable={false} />
      ))}
    </span>
  );
}

/** A card's name, kind and text. `stars` adds a monster's level stars beside the name. */
/** The order a hand card was picked for a fusion: its number on the select-frame texture. */
export function FuseBadge({ order }: { order: number; }) {
  return (
    <span
      className="pointer-events-none absolute -top-2 right-0 grid aspect-[174/140] w-8 place-items-center bg-contain bg-center bg-no-repeat font-mono text-sm font-bold leading-none text-white [text-shadow:0_1px_2px_#000]"
      style={{ backgroundImage: `url(${ASSET_URL}/textures/selectTexture.png)` }}
      title={`Fusion material ${order}`}
    >{order}</span>
  );
}

export function CardText({ num, stars = false }: { num: number; stars?: boolean; }) {
  const card = catalogCard(num);
  if (!card) return <p className="text-white/60">Face-down card. Attack it to find out what it is.</p>;
  return (
    <>
      <CardHeading num={num} stars={stars} />
      {card.text && <p className="mt-1 text-white/85">{card.text}{card.abilityPending && <span className="text-white/40"> (ability not active yet)</span>}</p>}
    </>
  );
}

/** A card's name (with level stars) and its type line. `large` is the card inspector's size. */
export function CardHeading({ num, stars = false, large = false }: { num: number; stars?: boolean; large?: boolean; }) {
  const card = catalogCard(num);
  if (!card) return null;
  const name = <p className={`font-bold text-yellow-200 ${large ? "text-xl leading-snug" : ""}`}>{card.name}</p>;
  return (
    <>
      {stars && card.kind === "monster" && (card.level ?? 0) > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {name}
          <LevelStars level={card.level ?? 0} />
        </div>
      ) : name}
      <p className={`text-white/60 ${large ? "mt-0.5 text-base" : ""}`}>
        {card.kind === "monster" ? `${card.type} · ${card.attribute} · level ${card.level}` : card.kind}
        {card.kind !== "monster" && card.implemented === false && " · effect not available yet"}
      </p>
    </>
  );
}

/** A card's text in a padded, labelled panel, set apart for the card inspector. */
export function CardEffect({ num }: { num: number; }) {
  const card = catalogCard(num);
  const body = card?.text || card?.flavor;
  if (!card || !body) return null;
  const flavor = !card.text || (card.kind === "monster" && card.frame === "normal");
  return (
    <div className="border-l-2 border-yellow-300/70 bg-white/[0.06] px-4 py-3">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-yellow-300/80">{flavor ? "Description" : "Effect"}</p>
      <p className={`text-[15px] leading-relaxed ${flavor ? "italic text-white/85" : "text-white"}`}>{body}</p>
      {card.abilityPending && <p className="mt-2 text-xs text-white/45">Ability not active yet</p>}
    </div>
  );
}


// The portals' frame: gold, like the board's own pieces.
const PORTAL = "pointer-events-auto overflow-hidden  border-2 border-yellow-700 bg-gray-900 shadow-lg shadow-black/60 transition-transform hover:border-yellow-500 active:scale-95";

/**
 * Two small windows onto whatever is under the cursor: the ground on the
 * left, and the card (or deck leader) standing on it on the right. Tapping
 * one opens it full screen.
 */
export function FocusPortals() {
  const cursor = useInteraction((s) => s.cursor);
  const mode = useInteraction((s) => s.mode.kind);
  const view = useGameStore((s) => s.view);
  // The hand and the graveyard are in front of the board; the portals would only be in the way.
  if (!view || mode === "hand" || mode === "grave") return null;

  const half = Math.floor(view.size / 2);
  const terrain = terrainOf(view.tiles[(cursor.y + half) * view.size + (cursor.x + half)] ?? "normal");
  const card = view.cards.find((c) => c.x === cursor.x && c.y === cursor.y);
  const leader = view.seats.find((s) => s.alive && s.leaderX === cursor.x && s.leaderY === cursor.y && s.leaderNum >= 0);
  const num = card ? card.num : leader?.leaderNum;

  return (
    // Phones: one portal at each side, above the bar. Tablets keep the log at the left, so both
    // sit at the right. Desktops flank the action bar (max-w-2xl, centred): terrain to its
    // left, card to its right, bottoms level with the bar's.
    <div className="pointer-events-none absolute inset-x-[max(0.5rem,env(safe-area-inset-left))] bottom-[calc(var(--bar-h)+0.5rem+var(--hud-bottom))] z-20 flex items-end justify-between gap-2 font-mono sm:left-auto sm:right-[max(0.5rem,env(safe-area-inset-right))] sm:justify-end lg:right-auto lg:left-1/2 lg:bottom-(--hud-bottom) lg:w-[57rem] lg:-translate-x-1/2 lg:justify-between">
      <button onClick={inspectCursorTile} className={`${PORTAL} w-20 sm:w-24 md:w-28 [@media(max-height:500px)]:w-16`} aria-label={`${terrain.name} terrain: details`}>
        <img src={terrain.textureUrl} alt="" className="aspect-square w-full object-cover" draggable={false} />
        <span className="block truncate border-t-2 border-yellow-700 px-1.5 py-1 text-left text-[11px] font-bold text-yellow-400 sm:text-xs">{terrain.name}</span>
      </button>
      {num !== undefined && (
        <button onClick={inspectCursorCard} className={`${PORTAL} w-20 p-1 sm:w-24 md:w-28 [@media(max-height:500px)]:w-16`} aria-label={card ? "Card details" : "Deck leader details"}>
          {card ? <CardFace num={num} atk={card.atk} def={card.def} terrain={card.terrain} /> : <img src={cardArt(num).art} alt="" draggable={false} className="aspect-square w-full object-cover" />}
        </button>
      )}
    </div>
  );
}

/** The terrain under a square, full screen, with what it does and what stands on it. */
export function TilePreview() {
  const at = useInteraction((s) => s.tilePreview);
  const view = useGameStore((s) => s.view);
  const room = useGameStore((s) => s.room);
  if (!at || !view) return null;

  const half = Math.floor(view.size / 2);
  const name = view.tiles[(at.y + half) * view.size + (at.x + half)] ?? "normal";
  const terrain = terrainOf(name);
  const card = view.cards.find((c) => c.x === at.x && c.y === at.y);
  const leader = view.seats.find((s) => s.alive && s.leaderX === at.x && s.leaderY === at.y);
  const standing = card ? (catalogCard(card.num)?.name ?? "A face-down card") + (card.shared ? " (shared by the team: each of you moves it on your turn)" : "") : leader ? `${room?.seats[leader.index]?.name || "Deck leader"} (deck leader)` : null;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4 md:backdrop-blur-sm" onClick={closeTilePreview}>
      <div
        className="relative w-full max-w-sm overflow-hidden border-2 border-yellow-700 bg-gray-900 font-mono text-sm text-white shadow-2xl [@media(max-height:500px)]:flex [@media(max-height:500px)]:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={closeTilePreview} className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center bg-black/60 text-lg text-white/70 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Close terrain details">
          ✕
        </button>
        <img src={terrain.textureUrl} alt={`${terrain.name} terrain`} className="aspect-square w-full object-cover [@media(max-height:500px)]:w-2/5" draggable={false} />
        <div className="space-y-2 border-t-2 border-yellow-700 p-4 [@media(max-height:500px)]:border-l-2 [@media(max-height:500px)]:border-t-0">
          <p className="text-lg font-bold text-yellow-400">{terrain.name} <span className="text-xs font-normal text-white/50">({at.x}, {at.y})</span></p>
          <p className="text-white/85">{terrainNote(name)}</p>
          {standing && <p className="text-white/60">Standing here: <span className="text-white">{standing}</span></p>}
        </div>
      </div>
    </div>
  );
}

// The bar's frame: green with a lighter middle band on my turn, red on the opponent's; gold border either way.
// The Hud's seat panels share these gradients: green for your side, red for the opponent's.
export const GRADIENT_MINE = "bg-[linear-gradient(to_bottom,#14301f,#3f7a5c_50%,#14301f)]";
export const GRADIENT_ENEMY = "bg-[linear-gradient(to_bottom,#3a1010,#8a2a2a_50%,#3a1010)]";
const BAR_MINE = `border-yellow-600/80 ${GRADIENT_MINE}`;
const BAR_ENEMY = `border-yellow-600/80 ${GRADIENT_ENEMY}`;

/** One stat in the strength chip, green or red when the terrain changes it. */
function StatAt({ label, value, base }: { label: string; value: number; base: number; }) {
  const diff = value - base;
  const tone = diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-white";
  return (
    <span className="whitespace-nowrap">
      <span className="text-white/60">{label}</span> <b className={`tabular-nums ${tone}`}>{value}</b>
      {diff !== 0 && <span className={`ml-0.5 text-[10px] ${tone}`}>({diff > 0 ? "+" : ""}{diff})</span>}
    </span>
  );
}

/**
 * The picked-up monster's ATK and DEF on the square under the cursor, so a
 * move onto terrain it is weak on shows before it is made. The numbers come
 * from the server (each card's terrain favours are its business); the change
 * shown is against where the monster stands now.
 */
export function StrengthChip({ mode }: { mode: Mode; }) {
  const cursor = useInteraction((s) => s.cursor);
  const view = useGameStore((s) => s.view);
  if (!view || mode.kind !== "card") return null;
  const card = view.cards.find((c) => c.id === mode.cardId);
  if (!card || card.hidden || catalogCard(card.num)?.kind !== "monster") return null;
  const half = Math.floor(view.size / 2);
  const terrainName = view.tiles[(cursor.y + half) * view.size + (cursor.x + half)] ?? "normal";
  const there = view.legal?.strength?.[card.id]?.[terrainName] ?? { atk: card.atk, def: card.def };
  return (
    <div className="col-span-full flex min-h-9 items-center justify-center gap-2 border border-white/20 bg-black/60 px-2.5 py-1 sm:shrink-0" title={`On ${terrainOf(terrainName).name}`}>
      <StatAt label="ATK" value={there.atk} base={card.atk} />
      <StatAt label="DEF" value={there.def} base={card.def} />
      <span className="truncate text-[10px] text-white/50">{terrainOf(terrainName).name}</span>
    </div>
  );
}

/** What each button does right now. Buttons are clickable, so this is also the touch UI. */
export function ActionBar() {
  const mode = useInteraction((s) => s.mode);
  const device = useInteraction((s) => s.device);
  const busy = useInteraction((s) => s.busy);
  const view = useGameStore((s) => s.view);
  const seat = useGameStore((s) => s.seat);
  // A replay keeps the bar on its last step too, to look through the hands and graveyards.
  const replaying = useReplaying();
  if (!view || (view.phase !== "playing" && !replaying)) return null;

  // Knocked out of a team game: no more orders, just the rest of the duel to watch.
  if (seat >= 0 && view.seats[seat] && !view.seats[seat].alive) {
    return (
      <div
        ref={trackBarHeight}
        className="absolute inset-x-[max(0.375rem,env(safe-area-inset-left))] bottom-(--hud-bottom) z-40 mx-auto border border-white/20 bg-black/80 p-3 text-center font-mono text-xs text-white/80 sm:max-w-2xl"
      >
        You are out of the duel. Spectating until it ends.
      </div>
    );
  }

  const choosing = view.pending?.seat === seat;
  const myTurn = view.turn === seat && !view.pending;
  // A choice the server asks of me (e.g. a trap response) can come on the opponent's turn.
  const enemyTurn = seat >= 0 && !myTurn && !choosing;
  const label = (action: Hint[0]) => (action === "COMMIT" ? "" : device === "gamepad" ? GLYPHS.gamepad[action] : keyFor(action).toUpperCase());
  // Watching with every hand in view, Hand opens the hand of the deck leader last tapped
  // (or under the cursor), else of whoever's turn it is; the hand view says whose.
  const hints = hintsFor(mode, choosing, stagedDefense(view, mode), myTurn);
  const staged = mode.kind === "card" && (mode.flip || mode.switchPosition);
  // Phones show every action at once in (at most) two rows: no scrolling.
  const columns = hints.length > 3 ? Math.ceil(hints.length / 2) : hints.length;

  return (
    <div
      ref={trackBarHeight}
      className={`absolute inset-x-[max(0.375rem,env(safe-area-inset-left))] bottom-(--hud-bottom) z-40 mx-auto grid sm:max-w-2xl grid-cols-(--cols) gap-1 border p-1.5 font-mono text-[11px] text-white transition-[opacity,background] sm:flex sm:flex-wrap sm:justify-center sm:gap-1.5 sm:text-xs ${enemyTurn ? BAR_ENEMY : BAR_MINE} ${busy ? "opacity-50" : ""}`}
      style={{ "--cols": `repeat(${columns}, minmax(0, 1fr))` } as React.CSSProperties}
    >
      <StrengthChip mode={mode} />
      {hints.map(([action, text]) => (
        <button
          key={action}
          // Confirm only means something once a flip or position change is staged;
          // nothing is clickable while the opponent is moving.
          disabled={enemyTurn || (action === "COMMIT" && !staged)}
          onClick={() => (action === "COMMIT" ? commitPicked() : press(action))}
          className={`flex min-h-9 min-w-0 items-center justify-center gap-1.5 border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 sm:shrink-0 sm:px-2.5 sm:py-1.5 pointer-coarse:sm:min-h-10 ${buttonColor(action, text)}`}
        >
          {label(action) && <kbd className={`bg-white/15 px-1.5 py-0.5 text-[10px] font-bold ${device === "gamepad" ? "" : "pointer-coarse:hidden"}`}>{label(action)}</kbd>}
          <span className="truncate">{text}</span>
        </button>
      ))}
    </div>
  );
}

const WIDE_KEY = "duelist.logClosed";
function readWideOpen() {
  try { return localStorage.getItem(WIDE_KEY) !== "1"; } catch { return true; }
}

/**
 * Whether the log and chat are open: `open` on a phone (closed by default),
 * `wide` on larger screens (open by default, and remembered once closed).
 * `seen` is the newest entry shown before the panel was closed on a larger screen.
 */
const useLogOpen = create<{ open: boolean; wide: boolean; seen: number; }>(() => ({ open: false, wide: readWideOpen(), seen: 0 }));

function setWideOpen(wide: boolean) {
  const log = useGameStore.getState().log;
  useLogOpen.setState({ wide, seen: log.length ? log[log.length - 1].id : 0 });
  try { localStorage.setItem(WIDE_KEY, wide ? "0" : "1"); } catch { /* not remembered */ }
}

/**
 * The row just above the action bar, in the middle: the chat button (phones)
 * and End turn, kept apart from the bar so it is never mistaken for one of
 * the card's actions. The previews sit at either side of it. Open panels
 * (hand, graveyard) cover it.
 */
export function TurnRow() {
  const device = useInteraction((s) => s.device);
  const busy = useInteraction((s) => s.busy);
  const myTurn = useGameStore((s) => !!s.view && s.view.phase === "playing" && s.seat >= 0 && s.view.turn === s.seat && !s.view.pending);
  const logOpen = useLogOpen((s) => s.open);
  const replaying = useReplaying();
  return (
    <div className="pointer-events-none absolute bottom-[calc(var(--bar-h)+0.5rem+var(--hud-bottom))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
      <button
        onClick={() => useLogOpen.setState({ open: !logOpen })}
        className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center border border-white/20 bg-black/80 text-base sm:hidden"
        aria-label={logOpen ? (replaying ? "Hide the log" : "Hide the log and chat") : (replaying ? "Show the log" : "Show the log and chat")}
      >
        {logOpen ? "✕" : replaying ? "📜" : "💬"}
      </button>
      {/* A replay has nobody to talk to. */}
      {!replaying && <VoiceButton className="pointer-events-auto" />}
      {myTurn && (
        <button
          onClick={() => press("END_TURN")}
          disabled={busy}
          className="pointer-events-auto flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border border-green-500/60 bg-green-900/90 px-4 font-mono text-xs font-bold text-white hover:bg-green-800 active:bg-green-700 disabled:opacity-50"
        >
          {/* The space bar always ends the turn, whatever else is bound to it. */}
          {device !== "gamepad" && <kbd className="bg-white/15 px-1.5 py-0.5 text-[10px] pointer-coarse:hidden">SPACE</kbd>}
          {device === "gamepad" && <kbd className="bg-white/15 px-1.5 py-0.5 text-[10px]">{GLYPHS.gamepad.END_TURN}</kbd>}
          End turn
        </button>
      )}
    </div>
  );
}

/** The hand, fanned across the screen while it is open. */
export function HandView() {
  const mode = useInteraction((s) => s.mode);
  const handIndex = useInteraction((s) => s.handIndex);
  const handSeat = useInteraction((s) => s.handSeat);
  const view = useGameStore((s) => s.view);
  const seat = useGameStore((s) => s.seat);
  const watch = useGameStore((s) => s.watch);
  const players = useGameStore((s) => s.players);
  if (mode.kind !== "hand" || !view) return null;
  const hand = visibleHand(view, seat, watch, handSeat);
  const owner = handOwner(view, seat, watch, handSeat);
  const seatView = view.seats[owner];
  const watching = seat < 0;
  const ownerName = players[owner]?.name || `Seat ${owner + 1}`;
  // The sandbox tells which cards fuse: with the card in focus, and every recipe in reach.
  const hints = owner === seat ? view.fusionHints ?? [] : [];
  const focused = hand[handIndex]?.id;
  const partners = new Map<number, number>();
  const fusable = new Set<number>();
  for (const h of hints) {
    fusable.add(h.a);
    if (h.onField) continue;
    fusable.add(h.b);
    if (h.a === focused) partners.set(h.b, h.result);
    if (h.b === focused) partners.set(h.a, h.result);
  }
  const nameOf = (id: number) => catalogCard(hand.find((c) => c.id === id)?.num ?? HIDDEN_NUM)?.name ?? "?";

  return (
    <div className="absolute inset-x-0 bottom-[calc(var(--bar-h)+var(--hud-bottom))] z-40 flex flex-col items-center gap-2 bg-gradient-to-t from-black via-black/90 to-transparent px-2 pb-3 pt-6 font-mono text-xs text-white [@media(max-height:500px)]:pt-4">
      <div className="flex w-full max-w-3xl items-end justify-center gap-1 sm:gap-2">
        {hand.map((card, index) => {
          const def = catalogCard(card.num);
          const tooCostly = def?.kind === "monster" && (def.level ?? 0) > (seatView?.stars ?? 0);
          const picked = mode.picked.includes(card.id);
          return (
            <button
              key={card.id}
              onClick={() => pointHand(index)}
              className={`relative min-w-0 max-w-36 flex-1 basis-0 transition-transform [@media(max-height:500px)]:max-w-20 ${index === handIndex ? "-translate-y-4" : "opacity-80"}`}
            >
              <CardFace num={card.num} className={`w-full ${index === handIndex ? "ring-4 ring-yellow-400" : partners.has(card.id) ? "ring-4 ring-fuchsia-400" : ""} ${picked ? "ring-4 ring-emerald-400" : ""} ${tooCostly ? "grayscale" : ""}`} />
              {picked && <FuseBadge order={mode.picked.indexOf(card.id) + 1} />}
              {tooCostly && <span className="absolute inset-x-0 bottom-1 mx-auto w-fit bg-black/80 px-1 text-[10px] text-red-300">needs ★{def?.level}</span>}
              {fusable.has(card.id) && !picked && <span className="absolute -top-2 left-0 bg-fuchsia-500 px-1 text-[10px] font-bold text-black" title="Fuses with something in reach">⚗</span>}
              {partners.has(card.id) && (
                <span className="absolute inset-x-0 top-1/3 mx-auto w-fit max-w-full truncate bg-fuchsia-950/90 px-1 text-[10px] text-fuchsia-100 ring-1 ring-fuchsia-400">
                  ⚗ → {catalogCard(partners.get(card.id)!)?.name ?? "?"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hints.length > 0 && (
        <ul className="flex max-h-16 w-full max-w-3xl flex-wrap justify-center gap-x-3 overflow-y-auto text-[11px] text-fuchsia-200">
          {hints.map((h, i) => (
            <li key={i}>
              ⚗ {nameOf(h.a)} + {h.onField ? `${catalogCard(view.cards.find((c) => c.x === h.x && c.y === h.y)?.num ?? HIDDEN_NUM)?.name ?? "your monster"} (${h.x}, ${h.y})` : nameOf(h.b)} → <span className="font-bold">{catalogCard(h.result)?.name ?? `#${h.result}`}</span>
            </li>
          ))}
        </ul>
      )}
      {watching && view.reveal && <p className="text-sky-200">{ownerName}'s hand. Tap another deck leader to see theirs.</p>}
      {watching && !view.reveal && <p className="text-sky-200">You are watching: this is the hand of the duelist you are spectating.</p>}
      <p className="text-white/50">★ {seatView?.stars} summoning stars · {seatView?.playsLeft ? "1 card may be played this turn" : "no card play left this turn"}</p>
    </div>
  );
}

/** True when a pending choice is one of graveyard cards: it is answered in the graveyard view. */
const isGraveChoice = (pending: { options?: { from?: number; }[]; } | undefined) =>
  !!pending?.options?.length && pending.options.every((o) => o.from !== undefined);

/**
 * The graveyards: browsed at any time (a tab per seat, newest card first), and
 * where a monster to revive is chosen. While choosing, the cards that can be
 * revived are lit and the rest dimmed.
 */
export function GraveyardView() {
  const mode = useInteraction((s) => s.mode);
  const choiceIndex = useInteraction((s) => s.choiceIndex);
  const view = useGameStore((s) => s.view);
  const room = useGameStore((s) => s.room);
  const seat = useGameStore((s) => s.seat);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const pending = view?.pending;
  const choosing = !!pending && pending.seat === seat && isGraveChoice(pending);
  const options = choosing ? pending.options ?? [] : [];
  const option = options[choiceIndex];
  // While choosing, the tab shown follows the highlighted option.
  const shown = choosing ? option?.from ?? 0 : mode.kind === "grave" ? mode.seat : -1;
  const cards = view && shown >= 0 ? graveyardOf(view, shown) : [];
  const total = cards.length;
  // Display index of the highlighted card (cards are shown newest first; slots count from the oldest).
  const selected = choosing ? (option?.slot !== undefined ? total - 1 - option.slot : -1) : mode.kind === "grave" ? mode.index : -1;

  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [selected, shown]);

  if (!view || shown < 0) return null;
  const optionAt = (index: number) => options.findIndex((o) => o.from === shown && o.slot === total - 1 - index);
  const current = cards[selected];

  return (
    <div className="absolute inset-x-0 bottom-[calc(var(--bar-h)+var(--hud-bottom))] z-50 flex flex-col items-center gap-2 bg-gradient-to-t from-black via-black/95 to-black/70 px-2 pb-3 pt-4 font-mono text-xs text-white">
      {choosing ? <p className="font-bold text-yellow-200">{pending.prompt}</p> : <p className="font-bold text-white/80">Graveyard</p>}
      <div className="flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none]">
        {view.seats.map((s) => {
          const firstOption = options.findIndex((o) => o.from === s.index);
          const disabled = choosing && firstOption < 0;
          return (
            <button
              key={s.index}
              disabled={disabled}
              onClick={() => (choosing ? selectChoice(firstOption) : pointGraveyard(s.index))}
              className={`shrink-0 border px-3 py-1 pointer-coarse:py-2 ${s.index === shown ? "border-yellow-400 bg-yellow-900/50" : "border-white/20 bg-black/60 hover:border-white/50"} ${disabled ? "opacity-30" : ""}`}
            >
              {room?.seats[s.index]?.name || `Seat ${s.index + 1}`}{s.index === seat && " (you)"} · {s.graveyard.length}
            </button>
          );
        })}
        {!choosing && <button onClick={() => press("CANCEL")} className="shrink-0 border border-white/20 bg-black/60 px-3 py-1 hover:border-white/50 pointer-coarse:py-2">✕</button>}
      </div>
      <div className="max-w-xl text-center">{current !== undefined && <CardText num={current} />}</div>
      {total === 0 ? (
        <p className="py-6 text-white/50">Empty.</p>
      ) : (
        <div className="grid max-h-[40dvh] w-full max-w-3xl grid-cols-5 gap-1.5 overflow-y-auto p-1 sm:grid-cols-7 md:grid-cols-8 [@media(max-height:500px)]:max-h-[28dvh] [@media(max-height:500px)]:grid-cols-10">
          {cards.map((num, index) => {
            const choice = choosing ? optionAt(index) : -1;
            const off = choosing && choice < 0;
            return (
              <button
                key={`${shown}:${total - index}`}
                ref={index === selected ? selectedRef : undefined}
                disabled={off}
                onClick={() => (choosing ? (choice === choiceIndex ? press("CONFIRM") : selectChoice(choice)) : pointGraveCard(index))}
                className={`relative ${index === selected ? "ring-4 ring-yellow-400" : ""} ${off ? "opacity-30 grayscale" : ""}`}
              >
                <CardFace num={num} className="w-full" />
              </button>
            );
          })}
        </div>
      )}
      {choosing && current !== undefined && (
        <button onClick={() => press("CONFIRM")} className="bg-yellow-500 px-4 py-1.5 font-bold text-black hover:bg-yellow-400 pointer-coarse:min-h-11">
          Revive {catalogCard(current)?.name ?? "this card"}
        </button>
      )}
      {!choosing && <p className="text-white/40">Newest first · tap a card twice to inspect it</p>}
    </div>
  );
}

/** A decision the server is waiting on, e.g. which card to take control of. */
export function ChoiceDialog() {
  const pending = useGameStore((s) => s.view?.pending);
  const seat = useGameStore((s) => s.seat);
  const room = useGameStore((s) => s.room);
  const choiceIndex = useInteraction((s) => s.choiceIndex);
  if (!pending) return null;

  if (pending.seat !== seat) {
    return (
      <div className="absolute left-1/2 top-24 z-40 -translate-x-1/2 border border-white/20 bg-black/80 px-4 py-2 font-mono text-xs text-white">
        {room?.seats[pending.seat]?.name || "Opponent"} is choosing…
      </div>
    );
  }
  // Reviving is chosen in the graveyard view.
  if (isGraveChoice(pending)) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 font-mono text-sm text-white">
      <div className="max-h-[80dvh] w-[min(92vw,34rem)] overflow-y-auto border border-yellow-500/60 bg-zinc-900 p-4">
        <p className="mb-3 font-bold text-yellow-200">{pending.prompt}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {(pending.options ?? []).map((option, index) => (
            <button
              key={index}
              onClick={() => pointChoice(index)}
              className={`border p-1.5 text-left text-[10px] ${index === choiceIndex ? "border-yellow-400 bg-yellow-900/40" : "border-white/15 hover:border-white/50"}`}
            >
              <CardFace num={option.num ?? HIDDEN_NUM} className="mb-1 w-full" />
              {option.seat !== undefined && option.seat !== seat && room?.seats[option.seat]?.name && (
                <span className="block font-bold">{room.seats[option.seat].name}</span>
              )}
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const TONES = { info: "text-white/75", good: "text-emerald-300", bad: "text-rose-300", say: "text-sky-200 italic", chat: "text-yellow-100" };

/**
 * What just happened and what people are saying, newest at the bottom, with
 * the room's chat box underneath.
 */
export function EventLog() {
  const log = useGameStore((s) => s.log);
  const seat = useGameStore((s) => s.seat);
  const muted = useGameStore((s) => s.room?.spectatorsMuted ?? false);
  const [text, setText] = useState("");
  const open = useLogOpen((s) => s.open);
  const wide = useLogOpen((s) => s.wide);
  const seen = useLogOpen((s) => s.seen);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log, wide]);
  const unread = !wide && log.some((entry) => entry.id > seen && (entry.tone === "chat" || entry.tone === "say"));

  const player = seat >= 0;
  const silenced = !player && muted;
  // Watching a replay: the log is there to read, with no chat or voice (there is no room to reach).
  const replaying = useReplaying();
  const what = replaying ? "the log" : "the log and chat";
  return (
    <>
      {/* Phones: the log opens over the board from the chat button (TurnRow); larger screens show it until it is closed. */}
      {!wide && (
        <button
          onClick={() => setWideOpen(true)}
          className="absolute bottom-[calc(var(--bar-h)+0.5rem+var(--hud-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] z-30 hidden h-10 w-10 items-center justify-center border border-white/20 bg-black/80 text-base hover:border-white/50 sm:flex lg:bottom-[calc(var(--hud-bottom)+10.5rem)]"
          aria-label={`Show ${what}`}
          title={`Show ${what}`}
        >
          {replaying ? "📜" : "💬"}
          {unread && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 bg-yellow-300" />}
        </button>
      )}
    <div className={`absolute bottom-[calc(var(--bar-h)+0.5rem+var(--hud-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] z-30 w-[min(20rem,calc(100vw-1rem))] border border-white/10 bg-black/80 p-2 font-mono text-[11px] leading-snug max-sm:bottom-[calc(var(--bar-h)+3.25rem+var(--hud-bottom))] lg:bottom-[calc(var(--hud-bottom)+10.5rem)] sm:w-56 md:w-64 lg:w-80 sm:bg-black/65 ${open ? "block" : "hidden"} ${wide ? "sm:block" : "sm:hidden"}`}>
      <button
        onClick={() => setWideOpen(false)}
        className="absolute right-1 top-1 z-10 hidden h-5 w-5 items-center justify-center text-white/50 hover:bg-white/10 hover:text-white sm:flex"
        aria-label={`Hide ${what}`}
        title={`Hide ${what}`}
      >
        ✕
      </button>
      <div className="max-h-40 overflow-y-auto sm:pr-5">
        {log.slice(-30).map((entry) => <p key={entry.id} className={TONES[entry.tone]}>{entry.text}</p>)}
        <div ref={end} />
      </div>
      {!replaying && <VoicePanel />}
      {!replaying && <form
        className="mt-1 flex gap-1 border-t border-white/10 pt-1"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { session.chat(text); setText(""); } }}
      >
        <input
          className="min-w-0 flex-1 border border-white/15 bg-black/60 px-1.5 py-0.5 text-white outline-none pointer-coarse:py-1.5 focus:border-yellow-400 disabled:opacity-50"
          placeholder={silenced ? "The players have muted spectators" : player ? "Say something to the room" : "Chat with the side you are watching"}
          value={text}
          maxLength={300}
          disabled={silenced}
          onChange={(e) => setText(e.target.value)}
          // Keys typed here are chat, not game input; Escape gives the keyboard back to the board.
          onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
        />
        {player && (
          <button
            type="button"
            title={muted ? "Let spectators chat again" : "Stop spectators from chatting"}
            className={`border px-1.5 ${muted ? "border-rose-400 text-rose-300" : "border-white/20 text-white/60 hover:border-white"}`}
            onClick={() => session.muteSpectators(!muted)}
          >
            {muted ? "Spectators muted" : "Mute spectators"}
          </button>
        )}
      </form>}
    </div>
    </>
  );
}

/**
 * What each Claude thought before its moves, newest first. It only appears
 * once the server has sent a thought, which it does to administrators, and to
 * everyone watching a duel between Claudes (nobody there has a hand to hide).
 */
export function ThinkingPanel() {
  const thoughts = useGameStore((s) => s.thoughts);
  // While the test tools are on, the thinking is a tab in them instead.
  const inTools = useGameStore((s) => s.tools && s.view?.phase === "playing");
  const [open, setOpen] = useState(false);
  if (thoughts.length === 0 || inTools) return null;
  return (
    <div className="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-24 z-30 flex flex-col items-end font-mono text-[11px] text-white">
      <button
        className="border border-fuchsia-400/60 bg-black/80 px-2 py-1 font-bold text-fuchsia-300 pointer-coarse:min-h-11 pointer-coarse:px-3"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        🧠 Claude's thinking {open ? "−" : `+ (${thoughts.length})`}
      </button>
      {open && (
        <div className="mt-1 flex max-h-[60dvh] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-y-auto overscroll-contain border border-fuchsia-400/50 bg-black/85 p-2">
          <ThoughtList />
        </div>
      )}
    </div>
  );
}

/** What each Claude player thought before its moves, newest first. */
export function ThoughtList() {
  const thoughts = useGameStore((s) => s.thoughts);
  const room = useGameStore((s) => s.room);
  const color = (seat: number) => (room?.seats[seat]?.team === 1 ? "text-sky-200" : "text-rose-300");
  if (thoughts.length === 0) return <p className="text-white/50">No thinking yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {[...thoughts].reverse().map((t) => (
        <div key={t.id} className="border-t border-white/10 pt-1.5 first:border-t-0 first:pt-0">
          <p className={`font-bold ${color(t.seat)}`}>{t.name}{t.action && <span className="font-normal text-yellow-200"> → {t.action}</span>}</p>
          <p className="whitespace-pre-wrap text-white/80 select-text">{t.text}</p>
        </div>
      ))}
    </div>
  );
}

/** Every hand and what is left of every deck: for administrators, and for watchers of a Claude-only duel. */
export function AdminPanel() {
  const reveal = useGameStore((s) => s.view?.reveal);
  const room = useGameStore((s) => s.room);
  const admin = useSessionStore((s) => !!s.user?.admin);
  const [open, setOpen] = useState(true);
  const [decks, setDecks] = useState(false);
  if (!reveal) return null;
  const names = (nums: number[]) => nums.map((num) => catalogCard(num)?.name ?? `#${num}`);
  return (
    <div className="absolute left-2 top-24 z-30 max-h-[55dvh] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto border border-fuchsia-400/50 bg-black/80 p-2 font-mono text-[11px] text-white">
      <p className="flex items-center justify-between font-bold text-fuchsia-300">
        {admin ? "Admin view: nothing is hidden" : "Nothing is hidden"}
        <span className="flex gap-1 font-normal">
          <button className="border border-white/20 px-1" onClick={() => setDecks(!decks)}>{decks ? "Hide decks" : "Show decks"}</button>
          <button className="border border-white/20 px-1" onClick={() => setOpen(!open)}>{open ? "−" : "+"}</button>
        </span>
      </p>
      {open && reveal.hands.map((hand, seat) => (
        <div key={seat} className="mt-1 border-t border-white/10 pt-1">
          <p className="text-yellow-200">{room?.seats[seat]?.name || `Seat ${seat + 1}`} · hand</p>
          <p className="text-white/80">{names(hand.map((card) => card.num)).join(", ") || "empty"}</p>
          {decks && (
            <>
              <p className="mt-1 text-yellow-200/70">deck, next draw first ({reveal.decks[seat].length})</p>
              <ol className="list-decimal pl-5 text-white/60">{names(reveal.decks[seat]).map((name, i) => <li key={i}>{name}</li>)}</ol>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Dims the board while the duel is paused: the clock and the computer players
 * are stopped and nothing can be played. It sits under the HUD, whose clock
 * card is the button that resumes it.
 */
export function PausedOverlay() {
  const paused = useGameStore((s) => !!s.room?.paused && s.view?.phase === "playing");
  const user = useSessionStore((s) => s.user);
  const canPause = useGameStore((s) => selectCanPause(s, user));
  if (!paused) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 font-mono text-white">
      <div className="text-center">
        <p className="text-4xl font-bold text-yellow-300">Paused</p>
        <p className="mt-1 text-xs text-white/60">{canPause ? "Tap the clock to play" : "The player has paused the duel"}</p>
      </div>
    </div>
  );
}

export function GameOver({ onLeave }: { onLeave: () => void; }) {
  const view = useGameStore((s) => s.view);
  const seat = useGameStore((s) => s.seat);
  const perspective = useGameStore(selectPerspective);
  const room = useGameStore((s) => s.room);
  const user = useSessionStore((s) => s.user);
  // Exodia's win plays out on the board first.
  const exodia = useExodiaStore((s) => s.stage !== "idle");
  if (exodia) return <ExodiaOverlay />;
  if (!view || view.phase !== "finished") return null;
  // A duel between computer players is restarted by whoever set it up.
  const canRematch = seat >= 0 || (!!room && !!user && room.seats.every((s) => s.kind === "bot") && (room.hostId === user.id || !!user.admin));
  const myTeam = view.seats[perspective]?.team;
  const title = view.winnerTeam === -1 ? "Draw" : perspective < 0 ? `Team ${view.winnerTeam + 1} wins` : view.winnerTeam === myTeam ? "Victory" : "Defeat";
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 font-mono text-white">
      <div className="mx-4 border border-yellow-500/60 bg-zinc-900 px-6 py-8 text-center sm:px-10">
        <p className={`mb-1 text-4xl font-bold ${title === "Defeat" ? "text-rose-400" : "text-yellow-300"}`}>{title}</p>
        <p className="mb-6 text-xs text-white/60">after {view.round ?? view.turnCount} {(view.round ?? view.turnCount) === 1 ? "round" : "rounds"} · LP {view.seats.map((s) => s.lp).join(" / ")}</p>
        <div className="flex justify-center gap-3 text-sm">
          {canRematch && <button className="bg-green-700 px-4 py-2 font-bold hover:bg-green-600 pointer-coarse:py-3" onClick={() => session.rematch()}>Rematch</button>}
          <button className="border border-white/30 px-4 py-2 hover:border-white pointer-coarse:py-3" onClick={onLeave}>Leave</button>
        </div>
      </div>
    </div>
  );
}
