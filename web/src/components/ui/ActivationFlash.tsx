import { useEffect } from "react";
import CardFace from "./CardFace";
import { SEAT_COLORS } from "@/const";
import { nextActivation, useActivationStore, type FlashCard } from "@/stores/activationStore";

/**
 * What one update set off, in the middle of the screen for about a second:
 * each card whose effect went off (a spell, a trap, a monster's ability) and
 * each card sent to the graveyard (destroyed, trampled, used up, fused...),
 * all at once, under the name of the duelist it belongs to in their seat
 * colour. Cards that are gone are greyed out and marked how ("Destroyed",
 * "To graveyard"), so a Raigeki shows itself and both its victims together.
 */
export default function ActivationFlash() {
  const shown = useActivationStore((s) => s.queue[0]);
  // Leaving the duel drops whatever was still waiting.
  useEffect(() => () => useActivationStore.setState({ queue: [] }), []);
  if (!shown) return null;
  const anyDestroyed = shown.cards.some((c) => c.destroyed);
  const allDestroyed = shown.cards.every((c) => c.destroyed);
  // One banner over them all when every card went the same way; otherwise each says its own.
  const labels = new Set(shown.cards.map((c) => c.label ?? "DESTROYED"));
  const banner = allDestroyed && labels.size === 1 ? [...labels][0] : null;
  // Many cards shrink to fit: one row where there is room, two at most.
  const count = shown.cards.length;
  const width = count > 4 ? "w-16 sm:w-20 lg:w-24" : count > 2 ? "w-20 sm:w-28 lg:w-32" : "w-32 sm:w-40 lg:w-48";
  return (
    <div
      key={shown.key}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) nextActivation(); }}
      className={`${anyDestroyed ? "destroyed-flash" : "activation-flash"} pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-2 px-4 font-mono`}
      role="status"
    >
      {banner && <p className="text-lg font-black tracking-widest text-red-500 [text-shadow:0_0_8px_rgba(0,0,0,0.9)] sm:text-2xl">{banner}</p>}
      <div className="flex max-w-full flex-wrap items-end justify-center gap-2 sm:gap-3">
        {shown.cards.map((card, i) => <Flashed key={i} card={card} width={width} tag={card.destroyed && !banner} />)}
      </div>
    </div>
  );
}

/** `tag` marks a destroyed card that shares the popup with cards that were not. */
function Flashed({ card, width, tag }: { card: FlashCard; width: string; tag?: boolean; }) {
  const color = SEAT_COLORS[card.seat] ?? "#ffffff";
  const destroyed = !!card.destroyed;
  return (
    <div className={`flex flex-col items-center gap-1.5 ${width}`}>
      <p
        className="max-w-[40vw] truncate border bg-black/80 px-2 py-0.5 text-xs font-bold sm:px-3 sm:py-1 sm:text-sm"
        style={{ color, borderColor: color }}
      >
        {card.who}
      </p>
      <div className="relative w-full" style={{ boxShadow: `0 0 28px ${destroyed ? "#ef4444" : color}` }}>
        <CardFace num={card.num} className={destroyed ? "grayscale" : ""} />
        {destroyed && <div className="absolute inset-0 bg-red-700/35 mix-blend-multiply" />}
        {tag && (
          <span className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 -rotate-12 bg-black/80 px-1.5 py-0.5 text-[10px] font-black tracking-widest text-red-500 sm:text-xs">
            {card.label ?? "DESTROYED"}
          </span>
        )}
      </div>
    </div>
  );
}
