import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { previewRenderCard } from "@/game/catalog";
import { useGameStore } from "@/stores/gameStore";

// The card's face, in board units (see YugiohCard).
const CARD_W = 0.68;
const CARD_H = 0.98;
const PLANE = new PlaneGeometry(1, 1);

// Timeline, in seconds: the card lifts and glows, turns to light, then the light fades.
const LIFT = 0.35;
const WHITE_FROM = 0.75;
const WHITE_TO = 1.05;
const END = 1.6;
const LIFT_HEIGHT = 0.35;

// Soft halo faked with stacked additive planes, each bigger and fainter.
const HALO = [
  { grow: 1.08, alpha: 0.55 },
  { grow: 1.2, alpha: 0.3 },
  { grow: 1.38, alpha: 0.15 },
];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Cast { key: string; num: number; x: number; y: number; seat: number; trap: boolean; }

/** One activation: a stand-in for the card that has already left the board, glowing out. */
function CastEffect({ cast, facing, isEnemy, onDone }: { cast: Cast; facing: number; isEnemy: boolean; onDone: () => void; }) {
  const lift = useRef<Group>(null);
  const cardGroup = useRef<Group>(null);
  const cover = useRef<Mesh>(null);
  const halos = useRef<(Mesh | null)[]>([]);
  const t = useRef(0);
  const done = useRef(false);
  const tint = cast.trap ? "#ff9ad5" : "#ffffff";

  const card = useMemo(() => ({ ...previewRenderCard(cast.num), isFaceDown: false, position: new Vector3(0, 0, 0) }), [cast.num]);

  useFrame((state, delta) => {
    if (done.current) return;
    t.current += Math.min(delta, 0.05);
    const time = t.current;

    if (lift.current) lift.current.position.z = 0.11 + LIFT_HEIGHT * easeOut(clamp01(time / LIFT));

    // Halo: swells in, pulses while the effect resolves, then grows and fades with the light.
    const fadeOut = clamp01((time - WHITE_TO) / (END - WHITE_TO));
    const pulse = 0.75 + 0.25 * Math.sin(time * 14);
    const haloIn = easeOut(clamp01(time / 0.25));
    halos.current.forEach((mesh, i) => {
      if (!mesh) return;
      const grow = HALO[i].grow * (1 + 0.35 * fadeOut);
      mesh.scale.set(CARD_W * grow, CARD_H * grow, 1);
      (mesh.material as MeshBasicMaterial).opacity = HALO[i].alpha * haloIn * pulse * (1 - fadeOut);
    });

    // The card washes out to white, then only the light is left, which fades.
    const white = clamp01((time - WHITE_FROM) / (WHITE_TO - WHITE_FROM));
    if (cover.current) {
      (cover.current.material as MeshBasicMaterial).opacity = white * (1 - fadeOut);
      const grow = 1 + 0.25 * fadeOut;
      cover.current.scale.set(CARD_W * grow, CARD_H * grow, 1);
    }
    if (cardGroup.current) cardGroup.current.visible = time < WHITE_TO;

    if (time >= END) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  return (
    <group position={[cast.x, cast.y, 0]}>
      <group ref={lift} position={[0, 0, 0.11]}>
        <group ref={cardGroup}>
          <Suspense fallback={null}>
            <YugiohCard card={card} facing={facing} isEnemy={isEnemy} />
          </Suspense>
        </group>
        <group rotation={[0, 0, facing]}>
          {HALO.map((_, i) => (
            <mesh key={i} ref={(m) => { halos.current[i] = m; }} geometry={PLANE} position={[0, 0, -0.01 - i * 0.002]} raycast={() => null}>
              <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
            </mesh>
          ))}
          <mesh ref={cover} geometry={PLANE} position={[0, 0, 0.02]} raycast={() => null}>
            <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/**
 * Spells (and traps) leave the board the moment they resolve. This keeps a
 * glowing stand-in where each one was activated, so the player sees it go off.
 */
export default function SpellCasts({ facingFor, isEnemy }: { facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean; }) {
  const [casts, setCasts] = useState<Cast[]>([]);

  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.eventSeq === previous.eventSeq) return;
    const fresh = state.lastEvents
      // A deck leader winning by its passive (Exodia) glows on the leader the same way.
      .filter((e) => (e.type === "spell" || e.type === "trap" || e.type === "leaderWin") && e.num !== undefined)
      .map((e, i) => ({ key: `${state.eventSeq}:${i}`, num: e.num!, x: e.x, y: e.y, seat: e.seat, trap: e.type === "trap" }));
    if (fresh.length) setCasts((current) => [...current, ...fresh]);
  }), []);

  return (
    <>
      {casts.map((cast) => (
        <CastEffect
          key={cast.key}
          cast={cast}
          facing={facingFor(cast.seat)}
          isEnemy={isEnemy(cast.seat)}
          onDone={() => setCasts((current) => current.filter((c) => c.key !== cast.key))}
        />
      ))}
    </>
  );
}
