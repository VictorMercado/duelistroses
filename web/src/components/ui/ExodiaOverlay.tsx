import { useEffect } from "react";
import { useExodiaStore } from "@/stores/exodiaStore";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Over the screen while Exodia's win plays on the board (see game/Exodia): the
 * edges burn gold, its name stamps in as it wakes, the screen whites out and
 * OBLITERATE slams across it as the beam fires, and every jolt on the board
 * shakes the whole view.
 */
export default function ExodiaOverlay() {
  const stage = useExodiaStore((s) => s.stage);
  const quake = useExodiaStore((s) => s.quake);

  // Shake the board's canvas with each jolt (the DOM moves; the 3D scene draws nothing extra).
  useEffect(() => {
    if (!quake.n || reducedMotion()) return;
    const canvas = document.querySelector<HTMLElement>(".canvas");
    if (!canvas?.animate) return;
    const p = 4 + 22 * quake.power;
    const frames = Array.from({ length: 9 }, (_, i) => {
      const k = (1 - i / 8) * p;
      return { transform: i === 8 ? "translate(0, 0)" : `translate(${(i % 2 ? -1 : 1) * k * (0.6 + 0.4 * Math.sin(i * 7))}px, ${(i % 3 - 1) * k * 0.7}px) rotate(${(i % 2 ? -1 : 1) * quake.power * 0.6}deg)` };
    });
    const animation = canvas.animate(frames, { duration: 260 + 420 * quake.power, easing: "ease-out" });
    return () => animation.cancel();
  }, [quake]);

  if (stage === "idle") return null;
  const titled = stage === "awaken" || stage === "charge";
  const unleashed = stage === "unleash" || stage === "fade";
  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden font-mono" aria-live="assertive">
      <div className={`exodia-vignette absolute inset-0 ${stage === "charge" ? "exodia-vignette-charge" : ""} ${stage === "fade" ? "opacity-0" : ""}`} />

      {titled && (
        <div className="absolute inset-x-0 top-[16%] flex flex-col items-center px-4 text-center" role="status">
          <p className="exodia-title text-5xl font-black text-yellow-300 sm:text-7xl">EXODIA</p>
          <p className="exodia-subtitle mt-2 text-xs font-bold tracking-[0.5em] text-orange-200 sm:text-base">THE FORBIDDEN ONE</p>
        </div>
      )}

      {unleashed && (
        <>
          <div className="exodia-whiteout absolute inset-0 bg-white" />
          <div className="absolute inset-0 flex items-center justify-center px-2" role="status">
            <p className="exodia-obliterate text-center text-[13vw] font-black leading-none sm:text-8xl">OBLITERATE!!</p>
          </div>
        </>
      )}
    </div>
  );
}
