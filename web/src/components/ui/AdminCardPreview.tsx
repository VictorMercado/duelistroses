import { Suspense, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import YugiohCard from "@/components/game/YugiohCard";
import { cardArt, catalogCard, previewRenderCard } from "@/game/catalog";
import { RARITIES, UNLOCKED_RARITIES } from "@/const";
import { useUIStore } from "@/stores/uiStore";
import type { Rarity } from "@/types";

const small = " border border-white/25 px-2 py-1 text-xs hover:border-white disabled:opacity-40 pointer-coarse:min-h-10";
const ALL_RARITIES = [...RARITIES, ...UNLOCKED_RARITIES];
const MAX_TILT_X = 1.1;
const DRAG_SPEED = 0.01;

type Tilt = { x: number; y: number; };

/** Eases the card toward the dragged tilt; with `sway` it rocks on its own so the foil keeps moving. */
function Turner({ tilt, sway, children }: { tilt: React.RefObject<Tilt>; sway: boolean; children: React.ReactNode; }) {
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const x = tilt.current.x + (sway ? Math.sin(t * 0.9) * 0.18 : 0);
    const y = tilt.current.y + (sway ? Math.sin(t * 0.6) * 0.45 : 0);
    const k = 1 - Math.exp(-12 * delta);
    g.rotation.x += (x - g.rotation.x) * k;
    g.rotation.y += (y - g.rotation.y) * k;
    if (!sway && (Math.abs(x - g.rotation.x) > 1e-4 || Math.abs(y - g.rotation.y) > 1e-4)) state.invalidate();
  });
  return <group ref={group}>{children}</group>;
}

type MaskView = "holo" | "overlay" | "mask" | "art";
const MASK_VIEWS: { id: MaskView; label: string; hint: string; }[] = [
  { id: "holo", label: "Holo areas", hint: "Rainbow where the foil shines (the mask's black), the subject left clean (its white)." },
  { id: "overlay", label: "Overlay", hint: "The mask laid over the art; slide to fade between them." },
  { id: "mask", label: "Mask", hint: "The mask alone: white keeps the shine off, black lets it through." },
  { id: "art", label: "Art", hint: "The art alone." },
];

/** A CSS luminance mask: the layer shows only where the image is white. */
const luminanceMask = (url: string): React.CSSProperties => ({
  maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")`,
  maskSize: "100% 100%", WebkitMaskSize: "100% 100%",
  maskMode: "luminance",
});

/**
 * The card editor's preview: the 3D card large, in any rarity, and its art
 * next to its holo mask, to judge whether the mask cuts the subject out
 * cleanly from the background the foil shines on.
 */
export default function AdminCardPreview({ num }: { num: number; }) {
  const lowPower = useUIStore((s) => s.lowPower);
  const def = catalogCard(num);
  const monster = def?.kind === "monster";
  const [rarity, setRarity] = useState<Rarity>("ultra");
  const [sway, setSway] = useState(true);
  const [view, setView] = useState<MaskView>("holo");
  const [opacity, setOpacity] = useState(0.5);
  const tilt = useRef<Tilt>({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; } | null>(null);
  const invalidate = useRef<() => void>(() => { });

  const card = useMemo(() => previewRenderCard(num, undefined, undefined, undefined, rarity), [num, rarity]);
  const art = cardArt(num);
  const mask = art.mask;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    tilt.current.y += (e.clientX - d.x) * DRAG_SPEED;
    tilt.current.x = Math.max(-MAX_TILT_X, Math.min(MAX_TILT_X, tilt.current.x + (e.clientY - d.y) * DRAG_SPEED));
    d.x = e.clientX;
    d.y = e.clientY;
    invalidate.current();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* The card itself, in the chosen rarity. */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {ALL_RARITIES.map((r) => (
            <button
              key={r.id}
              className={`${small} ${rarity === r.id ? "border-current" : "border-white/15 text-white/60"}`}
              style={rarity === r.id ? { color: r.color } : undefined}
              onClick={() => { setRarity(r.id); invalidate.current(); }}
            >
              {r.name}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs text-white/60">
            <input type="checkbox" checked={sway} onChange={(e) => { setSway(e.target.checked); invalidate.current(); }} /> sway
          </label>
        </div>
        <div
          className="relative h-[28rem] cursor-grab touch-none bg-gradient-to-b from-gray-800 to-gray-950 active:cursor-grabbing md:h-[34rem]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => { tilt.current = { x: 0, y: 0 }; invalidate.current(); }}
        >
          <Canvas frameloop={sway ? "always" : "demand"} dpr={[1, 2]} camera={{ position: [0, 0, 1.75], fov: 45 }}
            onCreated={(state) => { invalidate.current = () => state.invalidate(); }}>
            <ambientLight intensity={1.5} />
            <pointLight position={[2, 2, 3]} intensity={2} />
            <Suspense fallback={null}>
              <Turner tilt={tilt} sway={sway}>
                <YugiohCard card={card} isPreview />
              </Turner>
            </Suspense>
          </Canvas>
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-white/40">
            Drag to turn · double-click to reset
            {!monster && " · only monsters earn rarity in play"}
            {lowPower && " · battery saver is on: the foil holds still"}
          </p>
        </div>
      </div>

      {/* The art against its mask. */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {MASK_VIEWS.map((v) => (
            <button key={v.id} className={`${small} ${view === v.id ? "border-fuchsia-300 text-fuchsia-100" : "border-white/15 text-white/60"}`}
              disabled={!mask && v.id !== "art"} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
          {view === "overlay" && mask && (
            <input className="ml-auto w-32" type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Mask opacity" />
          )}
        </div>
        <div className="relative flex h-[28rem] items-center justify-center bg-[repeating-conic-gradient(#222_0_25%,#333_0_50%)] bg-[length:16px_16px] p-3 md:h-[34rem]">
          {/* The art's own proportions, so the mask lines up with it exactly. */}
          <div className="relative max-h-full max-w-full">
            <img src={view === "mask" && mask ? mask : art.artFull} alt="" draggable={false} className="block max-h-[calc(28rem-1.5rem)] max-w-full object-contain md:max-h-[calc(34rem-1.5rem)]" />
            {mask && view === "overlay" && (
              <img src={mask} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ opacity }} />
            )}
            {mask && view === "holo" && (
              <>
                {/* Rainbow over everything, then the subject (the mask's white) drawn back on top, clean. */}
                <div className="absolute inset-0 mix-blend-screen" style={{ background: "repeating-linear-gradient(115deg,#f0f 0 6%,#0ff 12%,#ff0 18%,#f0f 24%)", opacity: 0.75 }} />
                <img src={art.artFull} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={luminanceMask(mask)} />
              </>
            )}
          </div>
          {!mask && <p className="absolute inset-x-0 bottom-2 text-center text-xs text-amber-300">This card has no mask: the foil shines over the whole art.</p>}
        </div>
        <p className="text-[11px] text-white/50">{MASK_VIEWS.find((v) => v.id === view)?.hint}</p>
      </div>
    </div>
  );
}
