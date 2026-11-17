import { Suspense, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { playSfx } from "@/game/sfx";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";
import YugiohCard from "@/components/game/YugiohCard";
import { cardArt, catalogCard, previewRenderCard } from "@/game/catalog";
import { useInteraction } from "@/game/interaction";
import { useUIStore } from "@/stores/uiStore";
import { CardText } from "./GameOverlays";
import { terrainTone } from "@/game/terrain";

const MAX_TILT_X = 1.1; // radians; past this the card turns edge-on
const DRAG_SPEED = 0.01; // radians per pixel dragged
const EASE = 12; // how quickly the card catches up with the drag (per second)

/** Shared between the DOM drag handlers and the 3D frame loop. */
type Tilt = { x: number; y: number; };

/** Eases the card toward the dragged rotation; draws frames only while it is still turning. */
function Tilter({ target, children }: { target: React.RefObject<Tilt>; children: React.ReactNode; }) {
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-EASE * delta);
    const dx = target.current.x - g.rotation.x;
    const dy = target.current.y - g.rotation.y;
    g.rotation.x += dx * k;
    g.rotation.y += dy * k;
    if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) state.invalidate();
  });
  return <group ref={group}>{children}</group>;
}

interface InspectorProps {
  num: number;
  atk?: number;
  def?: number;
  /** What the card's square adds to its ATK and DEF: colours them, and says so. */
  terrain?: number;
  onClose: () => void;
  /** Extra controls (e.g. deck actions) shown under the card text. */
  children?: React.ReactNode;
  /** A deck leader: its art alone, without the card frame, stars or ATK/DEF it is based on. */
  portrait?: boolean;
}

/**
 * A card drawn in 3D with its holographic foil, in a modal. Drag (mouse or
 * finger) to turn it and watch the foil catch the light; the backdrop or ✕
 * closes it.
 */
export function CardInspector({ num, atk, def: defValue, terrain, onClose: close, children, portrait = false }: InspectorProps) {
  const lowPower = useUIStore((s) => s.lowPower);
  const tilt = useRef<Tilt>({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; } | null>(null);
  const invalidate = useRef<() => void>(() => { });

  const card = useMemo(() => previewRenderCard(num, atk, defValue, terrain), [num, atk, defValue, terrain]);

  useEffect(() => { tilt.current = { x: 0, y: 0 }; invalidate.current(); }, [num]);

  const def = catalogCard(num);

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
  const reset = () => { tilt.current = { x: 0, y: 0 }; invalidate.current(); };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 py-[max(0.5rem,env(safe-area-inset-top))] md:px-4 md:backdrop-blur-sm" onClick={close}>
      <div
        className="relative flex h-full max-h-[52rem] w-full flex-col overflow-hidden border-y border-white/10 md:max-w-5xl md:border bg-gray-900 text-white shadow-2xl md:flex-row landscape:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={close} className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center bg-black/60 text-lg text-white/70 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11" aria-label="Close preview">
          ✕
        </button>

        {portrait ? (
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-gradient-to-b from-gray-800 to-gray-950 p-6 md:basis-3/5 landscape:basis-3/5">
            <img src={cardArt(num).artFull} alt={def?.name ?? "Deck leader"} draggable={false} className="max-h-full max-w-full object-contain shadow-2xl" />
          </div>
        ) : (
        <div
          className="relative min-h-0 flex-1 cursor-grab touch-none bg-gradient-to-b from-gray-800 to-gray-950 active:cursor-grabbing md:basis-3/5 landscape:basis-3/5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={reset}
        >
          <Canvas frameloop="demand" dpr={lowPower ? [1, 1.5] : [1, 2]} camera={{ position: [0, 0, 1.9], fov: 45 }}
            onCreated={(state) => { invalidate.current = () => state.invalidate(); }}>
            <ambientLight intensity={1.5} />
            <pointLight position={[2, 2, 3]} intensity={2} />
            <Suspense fallback={null}>
              <Tilter target={tilt}>
                <YugiohCard card={card} isPreview />
              </Tilter>
            </Suspense>
          </Canvas>
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center font-mono text-[11px] text-white/40">
            Drag to turn · double-click to reset
          </p>
        </div>
        )}

        <div className="max-h-[40%] overflow-y-auto p-4 font-mono text-sm md:max-h-none md:basis-2/5 md:pt-14 landscape:max-h-none landscape:basis-2/5">
          <CardText num={num} stars={!portrait} />
          {def?.kind === "monster" && !portrait && (
            <div className="mt-3 flex gap-2">
              <span className="border border-red-500/30 bg-red-900/30 px-3 py-1.5">ATK <b className={terrainTone(terrain)}>{atk ?? def.atk}</b></span>
              <span className="border border-blue-500/30 bg-blue-900/30 px-3 py-1.5">DEF <b className={terrainTone(terrain)}>{defValue ?? def.def}</b></span>
            </div>
          )}
          {def?.kind === "monster" && !portrait && !!terrain && (
            <p className={`mt-2 text-xs ${terrainTone(terrain)}`}>{terrain > 0 ? `+${terrain}` : terrain} ATK/DEF from the terrain it stands on</p>
          )}
          {card.rarity !== "common" && !portrait && <p className="mt-3 text-xs uppercase tracking-wider text-yellow-300">Holographic foil</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

const closePreview = () => { playSfx('cancel', 0.4); useInteraction.setState({ preview: null }); };

/** The in-game card preview, opened from the board or hand. */
export default function CardPreview() {
  const preview = useInteraction((s) => s.preview);
  if (!preview) return null;
  return (
    <CardInspector num={preview.num} atk={preview.atk} def={preview.def} terrain={preview.terrain} onClose={closePreview} portrait={preview.leader}>
      {preview.note && <p className="mt-3 text-xs uppercase tracking-wider text-white/60">On the board: {preview.note}</p>}
    </CardInspector>
  );
}
