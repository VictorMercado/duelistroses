import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { catalogCard, previewRenderCard } from "@/game/catalog";
import { useGameStore } from "@/stores/gameStore";
import { holdFlash } from "@/stores/activationStore";
import { CROSS_STRIKES } from "@/net/session";
import type { GameEvent } from "@/net/protocol";

/*
 * Raigeki (and any spell that destroys along the lines of its square): the
 * spell goes off, then lightning comes down on every square of its row and
 * its column, the activation square first and then outwards, one square at a
 * time. A monster it destroyed is still standing on its square until its bolt
 * strikes it, and burns out in the flash.
 */


const PLANE = new PlaneGeometry(1, 1);
const RING = new RingGeometry(0.3, 0.42, 32);

// Timeline, in seconds. The first bolt waits for the spell's card to light up (see SpellCasts).
const FIRST = 0.55;
const SPREAD = 0.065; // between one square and the next one out
const BOLT = 0.32; // how long a bolt shows, flickering
const AFTERGLOW = 0.5; // the square glows on after its bolt
const BURN = 0.45; // a struck card burning out
const SKY = 4.2; // how high the bolts start

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Square { x: number; y: number; at: number; main: boolean; }
interface Victim { key: string; num: number; x: number; y: number; seat: number; at: number; }
/** seed: the bolts' shapes, fresh for every cast. */
interface Storm { key: string; seed: number; squares: Square[]; victims: Victim[]; end: number; }

/** A seeded random, so a bolt keeps its shape from frame to frame. */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A jagged bolt from the sky to the ground, as two crossed ribbons so it
 * shows from any angle, with a forked branch partway down. Built in the
 * square's own space: the ground is z = 0.
 */
function boltGeometry(seed: number, width: number, top: number): BufferGeometry {
  const rand = random(seed);
  const points: Vector3[] = [];
  const SEGMENTS = 12;
  let x = (rand() - 0.5) * 0.9;
  let y = (rand() - 0.5) * 0.9;
  for (let i = 0; i <= SEGMENTS; i++) {
    const k = i / SEGMENTS;
    // Wanders less as it nears the ground, so it lands on the square.
    const wander = 0.32 * (1 - k * 0.85);
    x = x * (1 - k * 0.35) + (rand() - 0.5) * wander;
    y = y * (1 - k * 0.35) + (rand() - 0.5) * wander;
    points.push(new Vector3(i === SEGMENTS ? 0 : x, i === SEGMENTS ? 0 : y, top * (1 - k)));
  }
  // A fork off the upper half.
  const forkAt = 3 + Math.floor(rand() * 4);
  const fork: Vector3[] = [points[forkAt].clone()];
  const dx = (rand() - 0.5) * 0.5;
  const dy = (rand() - 0.5) * 0.5;
  for (let i = 1; i <= 4; i++) {
    const p = fork[i - 1].clone();
    p.x += dx + (rand() - 0.5) * 0.18;
    p.y += dy + (rand() - 0.5) * 0.18;
    p.z -= top / SEGMENTS;
    fork.push(p);
  }

  const positions: number[] = [];
  const ribbon = (line: Vector3[], w: number) => {
    for (const [ax, ay] of [[1, 0], [0, 1]]) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const wa = w * (i === 0 ? 0.4 : 1), wb = w;
        const quad = [
          [a.x - ax * wa, a.y - ay * wa, a.z], [a.x + ax * wa, a.y + ay * wa, a.z], [b.x + ax * wb, b.y + ay * wb, b.z],
          [a.x - ax * wa, a.y - ay * wa, a.z], [b.x + ax * wb, b.y + ay * wb, b.z], [b.x - ax * wb, b.y - ay * wb, b.z],
        ];
        for (const v of quad) positions.push(...v);
      }
    }
  };
  ribbon(points, width);
  ribbon(fork, width * 0.55);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** One square's strike: the bolt (a white core in a blue glow), the flash on the ground and a ring running out. */
function Strike({ square, seed, lift, clock }: { square: Square; seed: number; lift: number; clock: { current: number; }; }) {
  const core = useMemo(() => boltGeometry(seed, square.main ? 0.03 : 0.022, SKY), [seed, square.main]);
  const glow = useMemo(() => boltGeometry(seed, square.main ? 0.11 : 0.08, SKY), [seed, square.main]);
  useEffect(() => () => { core.dispose(); glow.dispose(); }, [core, glow]);
  const coreRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);

  useFrame(() => {
    const t = clock.current - square.at;
    const on = t >= 0 && t < BOLT;
    // Two flickers: it strikes, dims, strikes again, then is gone.
    const flicker = !on ? 0 : t < 0.07 ? 1 : t < 0.12 ? 0.25 : t < 0.2 ? 0.9 : 1 - clamp01((t - 0.2) / (BOLT - 0.2));
    for (const [mesh, peak] of [[coreRef.current, 1], [glowRef.current, 0.55]] as const) {
      if (!mesh) continue;
      mesh.visible = on;
      (mesh.material as MeshBasicMaterial).opacity = peak * flicker;
    }
    const after = clamp01(t / (BOLT + AFTERGLOW));
    if (flash.current) {
      flash.current.visible = t >= 0 && after < 1;
      (flash.current.material as MeshBasicMaterial).opacity = (square.main ? 0.95 : 0.75) * (1 - after) * (t < BOLT ? 0.6 + 0.4 * flicker : 1);
    }
    if (ring.current) {
      const k = clamp01(t / 0.45);
      ring.current.visible = t >= 0 && k < 1;
      ring.current.scale.setScalar(0.4 + (square.main ? 1.6 : 1.1) * k);
      (ring.current.material as MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
  });

  return (
    <group position={[square.x, square.y, lift + 0.12]}>
      <mesh ref={glowRef} geometry={glow} visible={false} raycast={() => null} renderOrder={10}>
        <meshBasicMaterial color="#5fa8ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={coreRef} geometry={core} visible={false} raycast={() => null} renderOrder={11}>
        <meshBasicMaterial color="#f4f9ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={flash} geometry={PLANE} visible={false} raycast={() => null} position={[0, 0, -0.06]}>
        <meshBasicMaterial color="#9fd0ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={ring} geometry={RING} visible={false} raycast={() => null} position={[0, 0, -0.05]}>
        <meshBasicMaterial color="#d8ecff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A monster the lightning destroyed: standing until its bolt hits, then burnt out in white. */
function Victim({ victim, lift, facing, isEnemy, clock }: { victim: Victim; lift: number; facing: number; isEnemy: boolean; clock: { current: number; }; }) {
  const card = useMemo(() => ({ ...previewRenderCard(victim.num), isFaceDown: false, position: new Vector3(0, 0, 0) }), [victim.num]);
  const group = useRef<Group>(null);
  const cardGroup = useRef<Group>(null);
  const cover = useRef<Mesh>(null);
  useFrame(() => {
    const t = clock.current - victim.at;
    const burn = clamp01(t / BURN);
    if (group.current) {
      group.current.visible = burn < 1;
      // Jolted as the bolt lands.
      const jolt = t > 0 && t < 0.2 ? 0.03 * Math.sin(t * 120) : 0;
      group.current.position.set(victim.x + jolt, victim.y - jolt * 0.6, lift + 0.11);
      group.current.scale.setScalar(1 - 0.25 * burn);
    }
    if (cardGroup.current) cardGroup.current.visible = burn < 0.5;
    if (cover.current) {
      cover.current.visible = t >= 0;
      (cover.current.material as MeshBasicMaterial).opacity = t < 0 ? 0 : burn < 0.5 ? burn * 2 : 2 - burn * 2;
    }
  });
  return (
    <group ref={group} position={[victim.x, victim.y, lift + 0.11]}>
      <group ref={cardGroup}>
        <Suspense fallback={null}>
          <YugiohCard card={card} facing={facing} isEnemy={isEnemy} />
        </Suspense>
      </group>
      <group rotation={[0, 0, facing]}>
        <mesh ref={cover} geometry={PLANE} scale={[0.68, 0.98, 1]} position={[0, 0, 0.03]} visible={false} raycast={() => null}>
          <meshBasicMaterial color="#e6f3ff" transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function StormEffect({ storm, liftAt, facingFor, isEnemy, onDone }: {
  storm: Storm; liftAt: (x: number, y: number) => number; facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean; onDone: () => void;
}) {
  const clock = useRef(0);
  const done = useRef(false);
  const sky = useRef<Mesh>(null);
  useFrame((state, delta) => {
    if (done.current) return;
    clock.current += Math.min(delta, 0.05);
    // The whole board lights up with the first strike, then darkens back.
    if (sky.current) {
      const t = clock.current - FIRST;
      const k = t < 0 ? 0 : t < 0.08 ? 1 : t < 0.14 ? 0.3 : t < 0.22 ? 0.8 : Math.max(0, 0.8 - (t - 0.22) * 2);
      (sky.current.material as MeshBasicMaterial).opacity = 0.22 * k;
    }
    if (clock.current >= storm.end) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });
  return (
    <>
      <mesh ref={sky} geometry={PLANE} scale={[40, 40, 1]} position={[0, 0, 0.6]} raycast={() => null}>
        <meshBasicMaterial color="#7fb8ff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      {storm.victims.map((v) => (
        <Victim key={v.key} victim={v} lift={liftAt(v.x, v.y)} facing={facingFor(v.seat)} isEnemy={isEnemy(v.seat)} clock={clock} />
      ))}
      {storm.squares.map((s, i) => (
        <Strike key={`${s.x},${s.y}`} square={s} seed={storm.seed + i * 7919} lift={liftAt(s.x, s.y)} clock={clock} />
      ))}
    </>
  );
}

/** Works out a storm from one update's events: the squares to strike, and when, and the monsters it destroyed. */
function stormOf(events: GameEvent[], size: number, key: string): Storm | null {
  const spell = events.find((e) => e.type === "spell" && CROSS_STRIKES.has(catalogCard(e.num ?? -1)?.effect?.op ?? ""));
  if (!spell) return null;
  // A counter trap negated it: no lightning.
  if (events.some((e) => e.type === "destroyed" && e.text === "negated" && e.cardId === spell.cardId)) return null;
  const half = Math.floor(size / 2);
  const fast = reducedMotion();
  const squares: Square[] = [];
  for (let i = -half; i <= half; i++) {
    for (const [x, y] of [[spell.x, i], [i, spell.y]]) {
      if (squares.some((s) => s.x === x && s.y === y)) continue;
      const distance = Math.abs(x - spell.x) + Math.abs(y - spell.y);
      squares.push({ x, y, at: FIRST + (fast ? 0 : distance * SPREAD), main: distance === 0 });
    }
  }
  const victims: Victim[] = events
    .filter((e) => e.type === "destroyed" && e.cardId !== spell.cardId && (e.x === spell.x || e.y === spell.y) && e.text !== "used")
    .map((e, i) => ({
      key: `${key}:${i}`, num: e.num ?? -1, x: e.x, y: e.y, seat: e.seat,
      at: squares.find((s) => s.x === e.x && s.y === e.y)?.at ?? FIRST,
    }))
    .filter((v) => v.num >= 0);
  const last = Math.max(...squares.map((s) => s.at));
  return { key, seed: Math.floor(Math.random() * 1e6), squares, victims, end: last + Math.max(BOLT + AFTERGLOW, BURN) + 0.1 };
}

/** Lightning on the board for every Raigeki cast. */
export default function Lightning({ liftAt, facingFor, isEnemy }: {
  liftAt: (x: number, y: number) => number; facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean;
}) {
  const [storms, setStorms] = useState<Storm[]>([]);
  // The popup waits for each storm (see holdFlash): taken as the storm starts, before the popup is queued.
  const holds = useRef(new Map<string, () => void>());
  useEffect(() => {
    const live = holds.current;
    const stop = useGameStore.subscribe((state, previous) => {
      if (state.eventSeq === previous.eventSeq || !state.view) return;
      const storm = stormOf(state.lastEvents, state.view.size, `${state.eventSeq}`);
      if (!storm) return;
      live.set(storm.key, holdFlash());
      setStorms((current) => [...current, storm]);
    });
    return () => { stop(); live.forEach((release) => release()); live.clear(); };
  }, []);
  const finish = (key: string) => {
    holds.current.get(key)?.();
    holds.current.delete(key);
    setStorms((current) => current.filter((s) => s.key !== key));
  };
  return (
    <>
      {storms.map((storm) => (
        <StormEffect
          key={storm.key}
          storm={storm}
          liftAt={liftAt}
          facingFor={facingFor}
          isEnemy={isEnemy}
          onDone={() => finish(storm.key)}
        />
      ))}
    </>
  );
}
