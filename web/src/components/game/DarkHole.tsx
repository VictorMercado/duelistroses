import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  PlaneGeometry, Points, RingGeometry, SRGBColorSpace, Vector3,
} from "three";
import YugiohCard from "./YugiohCard";
import { catalogCard, previewRenderCard } from "@/game/catalog";
import { useGameStore } from "@/stores/gameStore";
import { holdFlash } from "@/stores/activationStore";
import { VOIDS } from "@/net/session";
import type { GameEvent } from "@/net/protocol";

/*
 * Dark Hole (any spell that wipes the whole field): a black hole tears open
 * in the middle of the board and the field dims. Every card it destroyed
 * shudders, is torn up off its square into one great whirl around the
 * board's centre, and spirals in faster and faster, tumbling and shrinking,
 * until it is swallowed. Once the last is gone the hole swells, snaps shut,
 * and a shockwave runs out over the field.
 */

const PLANE = new PlaneGeometry(1, 1);
const RING = new RingGeometry(0.42, 0.5, 64);
const CARD_W = 0.68;
const CARD_H = 0.98;

// Timeline, in seconds.
const OPEN_TO = 0.45; // the hole tears open
const SHAKE_FROM = 0.1; // the cards start to shudder
const LIFT_FROM = 0.3; // first card torn up (the rest follow within LIFT_STAGGER)
const LIFT_STAGGER = 0.18;
const LIFT_TIME = 0.4;
const ARRIVE_FROM = 1.35; // the nearest card is swallowed...
const ARRIVE_SPREAD = 0.6; // ...and the farthest this much later
const COLLAPSE = 0.32; // the hole swells and snaps shut
const AFTER = 0.45; // the shockwave and the dimness fading

// Heights over the board, in board units (cards rest at 0.11 over their tile).
const REST_Z = 0.11;
const DIM_Z = 0.5;
const HOLE_Z = 0.53;
const ORBIT_Z = 1.25;
const TILT = 1.0; // how far the whirling cards stand up off the board

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const phase = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const opacity = (m: Mesh | null | undefined, value: number) => { if (m) (m.material as MeshBasicMaterial).opacity = value; };

let swirlTexture: CanvasTexture | null = null;
/** The accretion disc: spiral arms of light winding into a dark middle, white on clear (tinted by the material). */
function swirl(): CanvasTexture {
  if (swirlTexture) return swirlTexture;
  const size = 512, c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.globalCompositeOperation = "lighter";
  const ARMS = 4;
  for (let i = 0; i < 2600; i++) {
    const r = 0.2 + Math.pow(rand(), 0.7) * 0.78;
    const arm = Math.floor(rand() * ARMS);
    // A logarithmic spiral, smeared so the arms read as streams of gas.
    const a = (arm / ARMS) * Math.PI * 2 + 2.6 * Math.log(r) + (rand() - 0.5) * 0.7;
    const x = c + Math.cos(a) * r * c, y = c + Math.sin(a) * r * c;
    // Brightest just outside the core, fading towards the rim.
    const glow = Math.pow(1 - r, 1.4) * (r < 0.27 ? (r - 0.2) / 0.07 : 1);
    ctx.fillStyle = `rgba(255,255,255,${0.12 * glow})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rand() * 7 * (1 - r), 0, Math.PI * 2);
    ctx.fill();
  }
  // A soft glow all round, so the disc never has a hard edge.
  ctx.globalCompositeOperation = "source-over";
  const haze = ctx.createRadialGradient(c, c, 0.2 * c, c, c, c);
  haze.addColorStop(0, "rgba(255,255,255,0.35)");
  haze.addColorStop(0.25, "rgba(255,255,255,0.12)");
  haze.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, size, size);
  swirlTexture = new CanvasTexture(canvas);
  swirlTexture.colorSpace = SRGBColorSpace;
  return swirlTexture;
}

let coreTexture: CanvasTexture | null = null;
/** The hole itself: solid black, feathered at its edge. */
function core(): CanvasTexture {
  if (coreTexture) return coreTexture;
  const size = 256, c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.62, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  coreTexture = new CanvasTexture(canvas);
  return coreTexture;
}

interface Victim { key: string; num: number; x: number; y: number; seat: number; liftAt: number; arrive: number; spin: number; }
interface Vortex { key: string; victims: Victim[]; collapse: number; end: number; }

/** One card dragged into the hole. */
function Swallowed({ victim, ground, facing, isEnemy, clock, angle }: {
  victim: Victim; ground: number; facing: number; isEnemy: boolean; clock: { current: number; }; angle: { current: number; };
}) {
  const card = useMemo(() => {
    const c = previewRenderCard(victim.num);
    return { ...c, isFaceDown: victim.num < 0, position: new Vector3(0, 0, 0) };
  }, [victim.num]);
  const group = useRef<Group>(null);
  const shade = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const theta0 = Math.atan2(victim.y, victim.x);
  const r0 = Math.hypot(victim.x, victim.y);
  // A card in the very middle still swings round before it goes in.
  const orbit = Math.max(r0, 0.8);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock.current;
    const lift = easeOut(phase(t, victim.liftAt, victim.liftAt + LIFT_TIME));
    const pullRaw = phase(t, victim.liftAt + LIFT_TIME * 0.6, victim.arrive);
    const pull = easeIn(pullRaw);
    g.visible = pullRaw < 1;
    if (!g.visible) return;

    // Shudders on its square before it is torn loose.
    const shake = phase(t, SHAKE_FROM, victim.liftAt) * (1 - lift) * 0.035;
    const jx = shake * Math.sin(t * 97 + victim.spin * 13);
    const jy = shake * Math.cos(t * 83 + victim.spin * 7);

    // Round the centre with everything else, spiralling in.
    const theta = theta0 + angle.current * lift;
    const r = lerp(r0, orbit, lift) * (1 - pull);
    const bob = 0.1 * Math.sin(t * 4 + victim.spin * 5) * lift * (1 - pull);
    const z = lerp(lerp(ground + REST_Z, ORBIT_Z + bob, lift), HOLE_Z + 0.04, pull);
    g.position.set(Math.cos(theta) * r + jx, Math.sin(theta) * r + jy, z);

    // Stands up off the board facing the way it flies, tumbling harder as it nears the hole.
    const tumble = victim.spin * (lift * t * 2.2 + pull * 9);
    g.rotation.set(TILT * lift * (1 - 0.5 * pull), tumble, lerp(facing, theta + Math.PI / 2, lift), "ZXY");
    const s = 1 - 0.92 * pull;
    g.scale.set(s, s * (1 + 0.35 * pull), s); // stretched as it falls in

    opacity(shade.current, 0.75 * pull);
    opacity(halo.current, (0.25 + 0.35 * pullRaw) * lift);
  });

  return (
    <group ref={group} position={[victim.x, victim.y, ground + REST_Z]}>
      <mesh ref={halo} geometry={PLANE} scale={[CARD_W * 1.4, CARD_H * 1.3, 1]} position={[0, 0, -0.02]} raycast={() => null}>
        <meshBasicMaterial color="#9b3dff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
      </mesh>
      <Suspense fallback={null}>
        <YugiohCard card={card} facing={0} isEnemy={isEnemy} isPreview />
      </Suspense>
      {/* Darkened as the hole takes it. */}
      <mesh ref={shade} geometry={PLANE} scale={[CARD_W * 1.02, CARD_H * 1.02, 1]} position={[0, 0, 0.03]} raycast={() => null}>
        <meshBasicMaterial color="#0a0014" transparent opacity={0} depthWrite={false} toneMapped={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}

const DUST = 90;
/** Specks of dust streaming in from all round: where each starts out (0 centre to 1 rim), its angle and speed. */
const SPECKS = (() => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: DUST }, () => ({ r: rand(), a: rand() * Math.PI * 2, speed: 0.5 + rand() * 0.7 }));
})();

function VortexEffect({ vortex, size, liftAt, facingFor, isEnemy, onDone }: {
  vortex: Vortex; size: number; liftAt: (x: number, y: number) => number; facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean; onDone: () => void;
}) {
  const clock = useRef(0);
  const angle = useRef(0);
  const done = useRef(false);
  const dim = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const disc = useRef<Mesh>(null);
  const discOuter = useRef<Mesh>(null);
  const hole = useRef<Mesh>(null);
  const horizon = useRef<Mesh>(null);
  const shock = useRef<Mesh>(null);
  const dust = useRef<Points>(null);

  const scale = size / 7;
  const holeZ = liftAt(0, 0) + HOLE_Z;
  const dustGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(DUST * 3), 3));
    return g;
  }, []);
  useEffect(() => () => dustGeometry.dispose(), [dustGeometry]);

  useFrame((state, delta) => {
    if (done.current) return;
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const t = clock.current;

    // The whirl winds up from a drift to a blur.
    const wind = phase(t, LIFT_FROM, vortex.collapse);
    angle.current += (0.8 + 11 * wind * wind) * dt;

    // Each card swallowed makes the hole gulp.
    let gulp = 0;
    for (const v of vortex.victims) if (t > v.arrive) gulp += Math.exp(-(t - v.arrive) * 10);
    gulp = Math.min(gulp, 1.5);

    const open = easeOutBack(phase(t, 0, OPEN_TO));
    const shut = phase(t, vortex.collapse, vortex.collapse + COLLAPSE);
    // It swells as it closes, then snaps to nothing.
    const closing = shut < 0.55 ? 1 + 0.35 * Math.sin((shut / 0.55) * Math.PI * 0.5) : (1.35 * (1 - (shut - 0.55) / 0.45));
    const holeSize = scale * open * closing * (1 + 0.12 * gulp);
    const pulse = 0.85 + 0.15 * Math.sin(t * 9);

    opacity(dim.current, 0.6 * phase(t, 0, OPEN_TO) * (1 - phase(t, vortex.collapse + COLLAPSE * 0.5, vortex.end)));
    if (hole.current) hole.current.scale.set(holeSize * 1.3, holeSize * 1.3, 1);
    if (horizon.current) {
      horizon.current.scale.set(holeSize * 1.25, holeSize * 1.25, 1);
      opacity(horizon.current, (0.75 + 0.25 * gulp) * pulse * clamp01(holeSize * 4));
    }
    if (disc.current) {
      disc.current.rotation.z = angle.current * 0.9;
      disc.current.scale.set(holeSize * 3.6, holeSize * 3.6, 1);
      opacity(disc.current, (0.8 + 0.2 * wind) * pulse);
    }
    if (discOuter.current) {
      discOuter.current.rotation.z = angle.current * 0.45 + 1;
      discOuter.current.scale.set(holeSize * 5.2, holeSize * 5.2, 1);
      opacity(discOuter.current, 0.45 * pulse);
    }

    // The shockwave and the flash as it shuts.
    const boom = phase(t, vortex.collapse + COLLAPSE, vortex.end);
    const boomed = t >= vortex.collapse + COLLAPSE;
    if (shock.current) {
      const s = 0.4 + easeOut(boom) * size * 1.6;
      shock.current.scale.set(s, s, 1);
      opacity(shock.current, boomed ? 0.95 * (1 - boom) : 0);
    }
    opacity(flash.current, boomed ? 0.35 * (1 - easeOut(phase(t, vortex.collapse + COLLAPSE, vortex.collapse + COLLAPSE + 0.25))) : 0);

    // Dust spiralling in, wrapping back out to the rim.
    if (dust.current) {
      const p = dustGeometry.getAttribute("position") as Float32BufferAttribute;
      const reach = size * 0.62;
      const fade = open * (1 - shut);
      SPECKS.forEach((sp, i) => {
        const k = (sp.r - t * sp.speed * (0.5 + wind)) % 1;
        const r = (k < 0 ? k + 1 : k) * reach * fade;
        const a = sp.a + angle.current * 1.2 + 1.5 / (0.3 + r);
        p.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, holeZ + 0.06 + r * 0.05);
      });
      p.needsUpdate = true;
      dust.current.visible = fade > 0.01;
    }

    if (t >= vortex.end) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  const extent = size + 10;
  return (
    <group>
      {/* The field dims around the hole, and flashes when it shuts. */}
      <mesh ref={dim} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, DIM_Z]} raycast={() => null}>
        <meshBasicMaterial color="#05000a" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={flash} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, holeZ + 0.05]} raycast={() => null}>
        <meshBasicMaterial color="#d9b8ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* The accretion disc (two layers turning at different speeds), the black hole and its glowing rim. */}
      <mesh ref={discOuter} geometry={PLANE} position={[0, 0, holeZ]} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <meshBasicMaterial map={swirl()} color="#5a1fd1" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={disc} geometry={PLANE} position={[0, 0, holeZ + 0.005]} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <meshBasicMaterial map={swirl()} color="#c45cff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={hole} geometry={PLANE} position={[0, 0, holeZ + 0.01]} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <meshBasicMaterial map={core()} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={horizon} geometry={RING} position={[0, 0, holeZ + 0.015]} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <meshBasicMaterial color="#f0c8ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={shock} geometry={RING} position={[0, 0, holeZ + 0.02]} raycast={() => null}>
        <meshBasicMaterial color="#b77cff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <points ref={dust} geometry={dustGeometry} raycast={() => null}>
        <pointsMaterial color="#e0b8ff" size={0.06} transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </points>

      {vortex.victims.map((v) => (
        <Swallowed key={v.key} victim={v} ground={liftAt(v.x, v.y)} facing={facingFor(v.seat)} isEnemy={isEnemy(v.seat)} clock={clock} angle={angle} />
      ))}
    </group>
  );
}

/** Works out a vortex from one update's events: the cards it swallows, and when each goes in. */
function vortexOf(events: GameEvent[], key: string): Vortex | null {
  const spell = events.find((e) => e.type === "spell" && VOIDS.has(catalogCard(e.num ?? -1)?.effect?.op ?? ""));
  if (!spell) return null;
  // A counter trap negated it: no hole.
  if (events.some((e) => e.type === "destroyed" && e.text === "negated" && e.cardId === spell.cardId)) return null;
  const gone = events.filter((e) => e.type === "destroyed" && e.cardId !== spell.cardId && e.text !== "used"
    && e.text !== "returned" && e.text !== "absorbed");
  const fast = reducedMotion();
  const far = Math.max(1, ...gone.map((e) => Math.hypot(e.x, e.y)));
  const victims: Victim[] = gone.map((e, i) => {
    const out = Math.hypot(e.x, e.y) / far;
    return {
      key: `${key}:${i}`, num: e.num ?? -1, x: e.x, y: e.y, seat: e.seat,
      liftAt: LIFT_FROM + (fast ? 0 : Math.random() * LIFT_STAGGER),
      // The nearest go in first; a little jitter so they never go in together.
      arrive: ARRIVE_FROM + (fast ? 0 : out * ARRIVE_SPREAD + Math.random() * 0.08),
      spin: Math.random() < 0.5 ? -1 : 1,
    };
  });
  const collapse = victims.length ? Math.max(...victims.map((v) => v.arrive)) + 0.05 : ARRIVE_FROM - 0.3;
  return { key, victims, collapse, end: collapse + COLLAPSE + AFTER };
}

/** The black hole on the board for every Dark Hole cast. */
export default function DarkHole({ size, liftAt, facingFor, isEnemy }: {
  size: number; liftAt: (x: number, y: number) => number; facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean;
}) {
  const [vortices, setVortices] = useState<Vortex[]>([]);
  // The popup waits for each vortex (see holdFlash): taken as it starts, before the popup is queued.
  const holds = useRef(new Map<string, () => void>());
  useEffect(() => {
    const live = holds.current;
    const stop = useGameStore.subscribe((state, previous) => {
      if (state.eventSeq === previous.eventSeq || !state.view) return;
      const vortex = vortexOf(state.lastEvents, `${state.eventSeq}`);
      if (!vortex) return;
      live.set(vortex.key, holdFlash());
      setVortices((current) => [...current, vortex]);
    });
    return () => { stop(); live.forEach((release) => release()); live.clear(); };
  }, []);
  const finish = (key: string) => {
    holds.current.get(key)?.();
    holds.current.delete(key);
    setVortices((current) => current.filter((v) => v.key !== key));
  };
  return (
    <>
      {vortices.map((vortex) => (
        <VortexEffect
          key={vortex.key}
          vortex={vortex}
          size={size}
          liftAt={liftAt}
          facingFor={facingFor}
          isEnemy={isEnemy}
          onDone={() => finish(vortex.key)}
        />
      ))}
    </>
  );
}
