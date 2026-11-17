import { Suspense, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from "three";
import { ASSET_URL, SEAT_COLORS } from "@/const";
import { useGameStore } from "@/stores/gameStore";
import type { GameEvent, GameView } from "@/net/protocol";

const FONT_URL = ASSET_URL + "/fonts/UtopiaStd-Subh.otf";
const PLANE = new PlaneGeometry(1, 1);
const RING = new RingGeometry(0.42, 0.5, 40);

// Timeline, in seconds. A direct attack streaks from the monster to the
// leader first; damage from anything else lands straight away.
export const STRIKE_TRAVEL = 0.2;
const FLASH = 0.28;
const RINGS = 0.5;
const NUMBER_RISE = 1.1;
const NUMBER_FADE = 0.45;
const RISE_HEIGHT = 0.55;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Strike {
  key: string;
  to: { x: number; y: number; };
  /** The attacking monster's square, for a direct attack. */
  from: { x: number; y: number; } | null;
  /** LP lost, or null when nothing got through (a trap stopped it, an ability absorbed it). */
  amount: number | null;
  color: string;
}

/**
 * Pairs each direct attack with the damage it did, and gives every other loss
 * of LP (battle overflow, burn spells) a strike of its own.
 */
function strikesOf(events: GameEvent[], view: GameView | null, seq: number): Strike[] {
  const strikes: Strike[] = [];
  const used = new Set<number>();
  events.forEach((e, i) => {
    if (e.type === "attack" && e.target === -1) {
      const hit = events.findIndex((d, j) => j > i && !used.has(j) && d.type === "damage" && d.text === "direct attack" && d.x === e.x && d.y === e.y);
      if (hit >= 0) used.add(hit);
      const attacker = view?.cards.find((c) => c.id === e.cardId);
      strikes.push({
        key: `${seq}:${i}`,
        to: { x: e.x, y: e.y },
        from: attacker && !reducedMotion() ? { x: attacker.x, y: attacker.y } : null,
        amount: hit >= 0 ? events[hit].amount ?? 0 : null,
        color: SEAT_COLORS[e.seat] ?? "#ffffff",
      });
    }
  });
  events.forEach((e, i) => {
    if (e.type !== "damage" || used.has(i)) return;
    strikes.push({ key: `${seq}:${i}`, to: { x: e.x, y: e.y }, from: null, amount: e.amount ?? 0, color: "#ff4343" });
  });
  return strikes;
}

function StrikeEffect({ strike, lift, upright, onDone }: { strike: Strike; lift: number; upright: number; onDone: () => void; }) {
  const streak = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const rings = useRef<(Mesh | null)[]>([]);
  const number = useRef<Group>(null);
  const text = useRef<{ fillOpacity: number; outlineOpacity: number; } | null>(null);
  const t = useRef(0);
  const done = useRef(false);
  const travel = strike.from ? STRIKE_TRAVEL : 0;
  const end = travel + NUMBER_RISE;

  // The streak runs in the board's plane, from the attacker to the leader.
  const dx = strike.from ? strike.to.x - strike.from.x : 0;
  const dy = strike.from ? strike.to.y - strike.from.y : 0;
  const angle = Math.atan2(dy, dx);

  useFrame((state, delta) => {
    if (done.current) return;
    t.current += Math.min(delta, 0.05);
    const time = t.current;

    if (streak.current && strike.from) {
      // The head flies in, the tail follows a beat behind and catches up at the leader.
      const head = easeIn(clamp01(time / travel));
      const tail = easeIn(clamp01((time - travel * 0.45) / travel));
      const length = Math.max(0.001, (head - tail) * Math.hypot(dx, dy));
      const mid = (head + tail) / 2;
      streak.current.position.set(strike.from.x + dx * mid, strike.from.y + dy * mid, 0.45);
      streak.current.scale.set(length, 0.14, 1);
      streak.current.visible = head > tail;
    }

    // Impact: a flash on the leader and two rings spreading out from it.
    const since = time - travel;
    if (flash.current) {
      const k = clamp01(since / FLASH);
      flash.current.visible = since >= 0 && k < 1;
      flash.current.scale.setScalar(0.9 + 0.5 * easeOut(k));
      (flash.current.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const k = clamp01((since - i * 0.08) / RINGS);
      ring.visible = since - i * 0.08 >= 0 && k < 1;
      ring.scale.setScalar(0.5 + 1.3 * easeOut(k));
      (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - k);
    });

    // The LP lost rises off the leader and fades.
    if (number.current) {
      const k = clamp01(since / NUMBER_RISE);
      number.current.visible = since >= 0;
      number.current.position.z = 0.5 + RISE_HEIGHT * easeOut(k);
      const pop = since < 0.12 ? 1 + 0.6 * (1 - since / 0.12) : 1;
      number.current.scale.setScalar(pop);
      const fade = clamp01((since - (NUMBER_RISE - NUMBER_FADE)) / NUMBER_FADE);
      // Troika reads these each frame; its material is shared by every Text, so never touch that.
      if (text.current) { text.current.fillOpacity = 1 - fade; text.current.outlineOpacity = 1 - fade; }
    }

    if (time >= end) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  const label = strike.amount === null ? "Blocked" : strike.amount > 0 ? `-${strike.amount}` : "0";

  return (
    <group>
      {strike.from && (
        <mesh ref={streak} geometry={PLANE} rotation={[0, 0, angle]} visible={false} raycast={() => null}>
          <meshBasicMaterial color={strike.color} transparent opacity={0.95} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <group position={[strike.to.x, strike.to.y, lift]}>
        <mesh ref={flash} geometry={PLANE} position={[0, 0, 0.4]} visible={false} raycast={() => null}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
        {[0, 1].map((i) => (
          <mesh key={i} ref={(m) => { rings.current[i] = m; }} geometry={RING} position={[0, 0, 0.41]} visible={false} raycast={() => null}>
            <meshBasicMaterial color={i === 0 ? "#ffffff" : strike.color} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
          </mesh>
        ))}
        <group ref={number} visible={false} rotation={[0, 0, upright]}>
          <Suspense fallback={null}>
            <Text
              ref={text as never}
              font={FONT_URL}
              fontSize={strike.amount === null ? 0.26 : 0.36}
              color={strike.amount === null ? "#d0d7de" : "#ff3b3b"}
              outlineWidth={0.03}
              outlineColor="#000000"
              anchorX="center"
              anchorY="middle"
              position={[0, 0.25, 0]}
              raycast={() => null}
            >
              {label}
            </Text>
          </Suspense>
        </group>
      </group>
    </group>
  );
}

/**
 * Every hit a deck leader takes shows on the board: a direct attack streaks
 * in from the monster, the leader flashes, and the LP lost rises off it. The
 * HUD's counter alone was easy to miss, so an attack felt like it had not
 * gone through.
 */
export default function LeaderStrikes({ liftAt, upright }: { liftAt: (x: number, y: number) => number; upright: number; }) {
  const [strikes, setStrikes] = useState<Strike[]>([]);

  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.eventSeq === previous.eventSeq) return;
    const fresh = strikesOf(state.lastEvents, state.view, state.eventSeq);
    if (fresh.length) setStrikes((current) => [...current, ...fresh]);
  }), []);

  return (
    <>
      {strikes.map((strike) => (
        <StrikeEffect
          key={strike.key}
          strike={strike}
          lift={liftAt(strike.to.x, strike.to.y)}
          upright={upright}
          onDone={() => setStrikes((current) => current.filter((s) => s.key !== strike.key))}
        />
      ))}
    </>
  );
}
