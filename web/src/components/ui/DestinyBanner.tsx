import CardFace from "./CardFace";
import { hideDestiny, useDestinyStore } from "@/stores/destinyStore";

/**
 * "Destiny Draw!": shown for a moment when a duelist in trouble draws a card
 * from outside their deck. Only the duelist who drew it sees which card it is.
 */
export default function DestinyBanner() {
  const shown = useDestinyStore((s) => s.shown);
  if (!shown) return null;
  return (
    <div
      key={shown.key}
      onAnimationEnd={hideDestiny}
      className="destiny-banner pointer-events-none fixed inset-x-0 top-1/3 z-40 flex justify-center px-4 font-mono"
      role="status"
    >
      <div className="flex items-center gap-3 border border-yellow-400/80 bg-black/85 px-4 py-3 shadow-[0_0_24px_rgba(250,204,21,0.45)]">
        {shown.num != null && (
          <div className="w-12 shrink-0 sm:w-16">
            <CardFace num={shown.num} />
          </div>
        )}
        <div>
          <p className="text-xl font-black tracking-wide text-yellow-300 sm:text-2xl">DESTINY DRAW!</p>
          <p className="text-xs text-white/70">
            {shown.mine ? "A card from beyond your deck joins your hand." : `${shown.who} drew a card from beyond their deck.`}
          </p>
        </div>
      </div>
    </div>
  );
}
