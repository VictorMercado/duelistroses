import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { previewRenderCard } from "@/game/catalog";
import { useGameStore } from "@/stores/gameStore";
import { useRitualStore } from "@/stores/ritualStore";
import type { GameEvent } from "@/net/protocol";

/*
 * A ritual summoning. The field goes dark, a magic circle opens in the middle
 * of the board, and the sacrificed monsters rise into an orbit around the
 * board's centre with the ritual card standing on the axis. They spin faster
 * and closer until they collapse into it in a flash, the ritual monster
 * emerges huge over the centre, then comes down onto its square as the
 * darkness lifts.
 */

const PLANE = new PlaneGeometry(1, 1);
const CARD_W = 0.68;
const CARD_H = 0.98;

// Timeline, in seconds.
const DARK_IN = 0.6;
const GATHER_FROM = 0.25;
const GATHER_TO = 1.35;
const ORBIT_TO = 3.7;
const CONVERGE_TO = 4.1;
const EMERGE_TO = 5.1;
const DESCEND_TO = 5.9;
const END = 6.5;

// Heights over the board, in board units (cards rest at 0.11).
const REST_Z = 0.11;
const DARK_Z = 0.45;
const ORBIT_Z = 0.95;
const CENTER_Z = 1.15;
const TILT = 1.0; // how far the floating cards stand up off the board

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const phase = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

let circleTexture: CanvasTexture | null = null;
/** The magic circle: rings, a hexagram and a band of runes, white on clear (tinted by the material). */
function magicCircle(): CanvasTexture {
  if (circleTexture) return circleTexture;
  const size = 512, c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 8;
  const ring = (r: number, w: number) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c, c, r * c, 0, Math.PI * 2); ctx.stroke(); };
  ring(0.97, 4); ring(0.9, 2); ring(0.62, 3); ring(0.56, 1.5); ring(0.2, 2);
  // Runes in the outer band: little strokes and dots that read as script from afar.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * 0.935 * c, c + Math.sin(a) * 0.935 * c);
    ctx.rotate(a + Math.PI / 2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const k = (i * 7) % 4;
    if (k === 0) { ctx.moveTo(-5, -6); ctx.lineTo(0, 6); ctx.lineTo(5, -6); }
    else if (k === 1) { ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6); }
    else if (k === 2) { ctx.arc(0, 0, 5, 0, Math.PI * 1.5); }
    else { ctx.moveTo(-5, -6); ctx.lineTo(5, 6); ctx.moveTo(-5, 6); ctx.lineTo(0, 0); }
    ctx.stroke();
    ctx.restore();
  }
  // A hexagram between the rings, and spokes to the centre.
  ctx.lineWidth = 3;
  for (const turn of [0, Math.PI]) {
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = turn - Math.PI / 2 + (i / 3) * Math.PI * 2;
      const x = c + Math.cos(a) * 0.9 * c, y = c + Math.sin(a) * 0.9 * c;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 0.2 * c, c + Math.sin(a) * 0.2 * c);
    ctx.lineTo(c + Math.cos(a) * 0.56 * c, c + Math.sin(a) * 0.56 * c);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 0.75 * c, c + Math.sin(a) * 0.75 * c, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  circleTexture = new CanvasTexture(canvas);
  circleTexture.colorSpace = SRGBColorSpace;
  return circleTexture;
}

let beamTexture: CanvasTexture | null = null;
/** A soft column of light: bright at its foot, fading upwards and to the sides. */
function beam(): CanvasTexture {
  if (beamTexture) return beamTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const up = ctx.createLinearGradient(0, 256, 0, 0);
  up.addColorStop(0, "rgba(255,255,255,1)");
  up.addColorStop(0.35, "rgba(255,255,255,0.55)");
  up.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = up;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-in";
  const across = ctx.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.5, "rgba(0,0,0,1)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 64, 256);
  beamTexture = new CanvasTexture(canvas);
  return beamTexture;
}

interface Spot { num?: number; x: number; y: number; }
interface Rite {
  key: string;
  seat: number;
  tributes: Spot[];
  /** The ritual spell, where it stood; null when we never saw it. */
  ritual: Spot | null;
  monster: Spot & { id: number; };
}

/** Finds the ritual summonings in a batch of events, with what was sacrificed for each. */
function ritesOf(events: GameEvent[], seq: number): Rite[] {
  const rites: Rite[] = [];
  let from = 0;
  events.forEach((e, i) => {
    if (e.type !== "summon" || e.text !== "ritual" || e.cardId === undefined) return;
    const before = events.slice(from, i);
    from = i + 1;
    const used = [...before].reverse().find((d) => d.type === "destroyed" && d.text === "used" && d.seat === e.seat && d.x === e.x && d.y === e.y);
    rites.push({
      key: `${seq}:${i}`,
      seat: e.seat,
      tributes: before.filter((d) => d.type === "destroyed" && d.text === "sacrificed").map((d) => ({ num: d.num, x: d.x, y: d.y })),
      ritual: used ? { num: used.num, x: used.x, y: used.y } : null,
      monster: { id: e.cardId, num: e.num, x: e.x, y: e.y },
    });
  });
  return rites;
}

const standIn = (num?: number) => ({ ...previewRenderCard(num ?? -1), isFaceDown: false, position: new Vector3(0, 0, 0) });

/** A soft glow behind a floating card. */
function Halo({ color, refFn, scale = 1.35 }: { color: string; refFn: (m: Mesh | null) => void; scale?: number; }) {
  return (
    <mesh ref={refFn} geometry={PLANE} scale={[CARD_W * scale, CARD_H * scale, 1]} position={[0, 0, -0.02]} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
    </mesh>
  );
}

const opacity = (m: Mesh | null | undefined, value: number) => { if (m) (m.material as MeshBasicMaterial).opacity = value; };

function RiteEffect({ rite, size, facing, upright, isEnemy, onLanded, onDone }: {
  rite: Rite; size: number; facing: number; upright: number; isEnemy: boolean; onLanded: () => void; onDone: () => void;
}) {
  const t = useRef(0);
  const landed = useRef(false);
  const spin = useRef(0);
  const done = useRef(false);
  const dark = useRef<Mesh>(null);
  const flashFloor = useRef<Mesh>(null);
  const circle = useRef<Mesh>(null);
  const innerCircle = useRef<Mesh>(null);
  const beams = useRef<Group>(null);
  const beamMeshes = useRef<(Mesh | null)[]>([]);
  const burst = useRef<Mesh>(null);
  const tributes = useRef<(Group | null)[]>([]);
  const tributeHalos = useRef<(Mesh | null)[]>([]);
  const ritual = useRef<Group>(null);
  const ritualHalo = useRef<Mesh>(null);
  const ritualWhite = useRef<Mesh>(null);
  const monster = useRef<Group>(null);
  const monsterHalo = useRef<Mesh>(null);

  const radius = Math.min(2.4, Math.max(1.4, size * 0.3));
  const tributeCards = useMemo(() => rite.tributes.map((s) => standIn(s.num)), [rite.tributes]);
  const ritualCard = useMemo(() => standIn(rite.ritual?.num), [rite.ritual]);
  const monsterCard = useMemo(() => standIn(rite.monster.num), [rite.monster.num]);
  const ritualFrom = rite.ritual ?? { x: 0, y: 0 };

  useFrame((state, delta) => {
    if (done.current) return;
    const dt = Math.min(delta, 0.05);
    t.current += dt;
    const time = t.current;

    // The spin winds up from a slow drift to a blur, then stops when they collapse.
    const wind = phase(time, GATHER_FROM, ORBIT_TO);
    if (time < CONVERGE_TO) spin.current += (0.7 + 10 * wind * wind) * dt;
    const angle = spin.current;

    // Darkness falls, flashes away at the collapse, and lifts at the end.
    const darkness = phase(time, 0, DARK_IN) * (1 - phase(time, DESCEND_TO, END));
    opacity(dark.current, 0.84 * darkness);
    const flash = time >= CONVERGE_TO ? 1 - phase(time, CONVERGE_TO, CONVERGE_TO + 0.45) : 0;
    opacity(flashFloor.current, 0.55 * flash);

    // The circle opens, turns, and pulses harder as the spin builds.
    const open = easeOut(phase(time, 0.1, 1.0)) * (1 - phase(time, EMERGE_TO, DESCEND_TO));
    const pulse = 0.75 + 0.25 * Math.sin(time * (4 + 14 * wind));
    if (circle.current) {
      circle.current.rotation.z = -angle * 0.18;
      const s = radius * 2.5 * (0.6 + 0.4 * open) * (1 + 0.15 * flash);
      circle.current.scale.set(s, s, 1);
      opacity(circle.current, open * pulse * (0.75 + 0.25 * wind));
    }
    if (innerCircle.current) {
      innerCircle.current.rotation.z = angle * 0.35;
      const s = radius * 1.1 * open;
      innerCircle.current.scale.set(s, s, 1);
      opacity(innerCircle.current, open * pulse * 0.8);
    }

    // A column of light grows out of the circle as the spin builds, flares at the collapse, then fades.
    const pillar = Math.max(easeIn(phase(time, GATHER_TO, ORBIT_TO)) * 0.7, flash) * (1 - phase(time, EMERGE_TO - 0.3, DESCEND_TO));
    if (beams.current) beams.current.rotation.z = angle * 0.5;
    beamMeshes.current.forEach((m) => {
      if (!m) return;
      m.scale.x = 0.9 * (0.6 + 1.4 * flash + 0.4 * wind);
      opacity(m, pillar);
    });

    // The tributes: up off their squares into the orbit, round and in, then into the ritual card.
    const gather = easeInOut(phase(time, GATHER_FROM, GATHER_TO));
    const tighten = easeIn(phase(time, GATHER_TO, ORBIT_TO));
    const converge = easeIn(phase(time, ORBIT_TO, CONVERGE_TO));
    const n = rite.tributes.length;
    rite.tributes.forEach((from, i) => {
      const g = tributes.current[i];
      if (!g) return;
      g.visible = time < CONVERGE_TO;
      const theta = angle + (i / Math.max(1, n)) * Math.PI * 2;
      const r = radius * (1 - 0.6 * tighten) * (1 - converge);
      const ox = Math.cos(theta) * r, oy = Math.sin(theta) * r;
      const bob = 0.08 * Math.sin(time * 3 + i * 2.1) * (1 - converge);
      const oz = lerp(ORBIT_Z + bob, CENTER_Z, converge);
      g.position.set(lerp(from.x, ox, gather), lerp(from.y, oy, gather), lerp(REST_Z, oz, gather) + Math.sin(Math.PI * gather) * 0.3);
      // Standing up and facing outwards as they orbit.
      g.rotation.set(TILT * gather, 0, lerp(facing, theta + Math.PI / 2, gather), "ZXY");
      const s = 1 - 0.75 * converge;
      g.scale.set(s, s, s);
      opacity(tributeHalos.current[i], (0.35 + 0.45 * wind) * gather * pulse);
    });

    // The ritual card: to the axis, high over the circle, turning slowly to show both faces; it glows white as they reach it.
    if (ritual.current) {
      const go = easeInOut(phase(time, GATHER_FROM, GATHER_TO));
      ritual.current.visible = time < CONVERGE_TO;
      ritual.current.position.set(lerp(ritualFrom.x, 0, go), lerp(ritualFrom.y, 0, go), lerp(REST_Z, CENTER_Z, go) + 0.06 * Math.sin(time * 2));
      ritual.current.rotation.set(TILT * go, 0, lerp(facing, upright + angle * 0.25, go), "ZXY");
      const s = 1 + 0.2 * go + 0.3 * converge;
      ritual.current.scale.set(s, s, s);
      opacity(ritualHalo.current, go * (0.4 + 0.5 * wind) * pulse);
      opacity(ritualWhite.current, converge);
    }

    // The monster: born in the flash, huge over the centre, then down onto its square.
    if (monster.current) {
      monster.current.visible = time >= CONVERGE_TO && time < DESCEND_TO;
      const grow = easeOutBack(phase(time, CONVERGE_TO, CONVERGE_TO + 0.6));
      const land = easeInOut(phase(time, EMERGE_TO, DESCEND_TO));
      const hover = 0.08 * Math.sin(time * 2.5) * (1 - land);
      monster.current.position.set(lerp(0, rite.monster.x, land), lerp(0, rite.monster.y, land), lerp(CENTER_Z + 0.1 + hover, REST_Z, land));
      monster.current.rotation.set(TILT * (1 - land), 0, lerp(upright, facing, land), "ZXY");
      const s = lerp(0.2 + 1.5 * grow, 1, land);
      monster.current.scale.set(s, s, s);
      opacity(monsterHalo.current, (1 - land) * (0.6 + 0.3 * Math.sin(time * 6)));
    }
    // Down on its square: the real card takes over from the stand-in.
    if (time >= DESCEND_TO && !landed.current) { landed.current = true; onLanded(); }

    // The collapse: a ring of light rushing out over the board.
    if (burst.current) {
      const b = phase(time, CONVERGE_TO, CONVERGE_TO + 0.7);
      const s = 0.5 + b * size * 1.3;
      burst.current.scale.set(s, s, 1);
      opacity(burst.current, time >= CONVERGE_TO ? (1 - b) * 0.9 : 0);
    }

    if (time >= END) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  const extent = size + 10;
  return (
    <group>
      {/* The darkness over the field, and the white flash at the collapse. */}
      <mesh ref={dark} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, DARK_Z]} raycast={() => null}>
        <meshBasicMaterial color="#06000c" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={flashFloor} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, DARK_Z + 0.01]} raycast={() => null}>
        <meshBasicMaterial color="#ffd9e6" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* The magic circle, and a smaller one turning the other way. */}
      <mesh ref={circle} geometry={PLANE} position={[0, 0, DARK_Z + 0.02]} raycast={() => null}>
        <meshBasicMaterial map={magicCircle()} color="#ff2448" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={innerCircle} geometry={PLANE} position={[0, 0, DARK_Z + 0.03]} raycast={() => null}>
        <meshBasicMaterial map={magicCircle()} color="#b04bff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={burst} geometry={PLANE} position={[0, 0, DARK_Z + 0.04]} raycast={() => null}>
        <meshBasicMaterial map={magicCircle()} color="#ffffff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* The column of light on the axis: crossed planes standing up from the circle. */}
      <group ref={beams} position={[0, 0, DARK_Z]}>
        {[0, Math.PI / 3, (2 * Math.PI) / 3].map((turn, i) => (
          <group key={i} rotation={[0, 0, turn]}>
            <mesh
              ref={(m) => { beamMeshes.current[i] = m; }}
              geometry={PLANE}
              rotation={[Math.PI / 2, 0, 0]}
              position={[0, 0, 1.6]}
              scale={[0.9, 3.2, 1]}
              raycast={() => null}
            >
              <meshBasicMaterial map={beam()} color="#ff5a7a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>

      {rite.tributes.map((_, i) => (
        <group key={i} ref={(g) => { tributes.current[i] = g; }} position={[rite.tributes[i].x, rite.tributes[i].y, REST_Z]}>
          <Halo color="#ff2448" refFn={(m) => { tributeHalos.current[i] = m; }} />
          <Suspense fallback={null}>
            <YugiohCard card={tributeCards[i]} facing={0} isEnemy={isEnemy} isPreview />
          </Suspense>
        </group>
      ))}

      <group ref={ritual} position={[ritualFrom.x, ritualFrom.y, REST_Z]} visible={!!rite.ritual}>
        <Halo color="#b04bff" refFn={(m) => { ritualHalo.current = m; }} scale={1.6} />
        <Suspense fallback={null}>
          <YugiohCard card={ritualCard} facing={0} isEnemy={isEnemy} isPreview />
        </Suspense>
        <mesh ref={ritualWhite} geometry={PLANE} scale={[CARD_W * 1.05, CARD_H * 1.05, 1]} position={[0, 0, 0.03]} raycast={() => null}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} toneMapped={false} side={DoubleSide} />
        </mesh>
      </group>

      <group ref={monster} visible={false}>
        <Halo color="#ffcf5a" refFn={(m) => { monsterHalo.current = m; }} scale={1.7} />
        <Suspense fallback={null}>
          <YugiohCard card={monsterCard} facing={0} isEnemy={isEnemy} isPreview />
        </Suspense>
      </group>
    </group>
  );
}

/**
 * Plays each ritual summoning the server reports. The summoned monster is kept
 * off the board (see stores/ritualStore) until the rite sets it down.
 */
export default function RitualRites({ size, facingFor, upright, isEnemy }: {
  size: number; facingFor: (seat: number) => number; upright: number; isEnemy: (seat: number) => boolean;
}) {
  const [rites, setRites] = useState<Rite[]>([]);

  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.eventSeq === previous.eventSeq) return;
    const fresh = ritesOf(state.lastEvents, state.eventSeq);
    if (!fresh.length) return;
    // Hidden before the board renders the new state, so it never pops in early.
    for (const rite of fresh) useRitualStore.getState().hide(rite.monster.id);
    setRites((current) => [...current, ...fresh]);
  }), []);

  // Nothing stays hidden once the rites are gone (left the duel, board cleared).
  useEffect(() => () => { for (const id of useRitualStore.getState().hidden) useRitualStore.getState().show(id); }, []);

  return (
    <>
      {rites.map((rite) => (
        <RiteEffect
          key={rite.key}
          rite={rite}
          size={size}
          facing={facingFor(rite.seat)}
          upright={upright}
          isEnemy={isEnemy(rite.seat)}
          onLanded={() => useRitualStore.getState().show(rite.monster.id)}
          onDone={() => {
            useRitualStore.getState().show(rite.monster.id);
            setRites((current) => current.filter((r) => r.key !== rite.key));
          }}
        />
      ))}
    </>
  );
}
