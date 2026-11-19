import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, Quaternion, RingGeometry, SRGBColorSpace, Sprite, Vector3,
} from "three";
import YugiohCard from "./YugiohCard";
import { allCards, catalogCard, previewRenderCard } from "@/game/catalog";
import { useGameStore } from "@/stores/gameStore";
import { useRitualStore } from "@/stores/ritualStore";
import { exodiaQuake, exodiaStage, type ExodiaStage } from "@/stores/exodiaStore";
import { playSfx } from "@/game/sfx";

/*
 * Exodia, the Forbidden One, assembled: the duel is won.
 *
 * The field goes black and a golden pentagram burns itself into the board,
 * one point for each piece. The four limbs and the head (from the deck
 * leader) light up one by one and rise off the field, whirling to stand.
 * They fly together and slam into place as one giant figure towering over
 * the board, each landing shaking the screen. Golden seals chain it to the
 * pentagram, strain, and snap; a sunburst opens behind it and its eyes flare.
 * Light pours into a sphere at its chest, and then: OBLITERATE. A beam tears
 * across the board into every enemy deck leader, which erupts. The figure
 * burns away into embers, and only then does the Game Over screen show.
 *
 * Everything here is drawn in a frame turned to face the screen (`upright`),
 * so the figure stands square to the camera whichever seat is watching.
 */

const PLANE = new PlaneGeometry(1, 1);
const RING = new RingGeometry(0.42, 0.5, 64);
const TUBE = new CylinderGeometry(1, 1, 1, 12, 1, true);
const CARD_W = 0.68;
const CARD_H = 0.98;

// Timeline, in seconds.
const DARK_IN = 0.7;
const RISE_FROM = 0.45; // the first piece lights up; the rest follow RISE_STEP apart
const RISE_STEP = 0.3;
const RISE_TIME = 0.75;
const ASSEMBLE_FROM = 2.35; // the first piece flies in; the rest follow FLY_STEP apart
const FLY_STEP = 0.17;
const FLY_TIME = 0.42;
const AWAKEN = 3.55; // all in place: the seals show, the title stamps in
const SNAP = 4.35; // the seals break
const GLARE = 4.6; // the eyes flare
const CHARGE = 4.9; // the blast gathers at its chest
const UNLEASH = 6.1; // Obliterate
const BEAM_TIME = 1.25;
const FADE = 7.0; // it burns away
const END = 8.4;

// Heights over the board, in board units (cards rest at 0.11 over their tile).
const REST_Z = 0.11;
const DARK_Z = 0.5;
const HOVER = 1.0; // how high the pieces rise over their squares
/** How far the figure leans back from upright, so it faces the camera square on (the camera looks down at 50°). */
const FACE = 0.87;
/** How big the assembled figure is, in cards. */
const SCALE = 1.25;
/** Where the figure stands, in the screen-facing frame: a little towards the near edge, its feet just off the board. */
const ORIGIN = new Vector3(0, -0.7, DARK_Z + 0.2);

/** Each piece's place in the figure, in cards: legs, then arms, then the head last (its order of arrival). */
const SLOTS: { name: string; x: number; y: number; z: number; }[] = [
  { name: "Right Leg", x: -0.36, y: 0.5, z: 0 },
  { name: "Left Leg", x: 0.36, y: 0.5, z: 0 },
  { name: "Right Arm", x: -1.08, y: 1.3, z: 0.01 },
  { name: "Left Arm", x: 1.08, y: 1.3, z: 0.01 },
  { name: "Exodia", x: 0, y: 1.6, z: 0.03 },
];
const CHEST = { x: 0, y: 1.05 };

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const phase = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
type Faded = { material: unknown; } | null | undefined;
const opacity = (m: Faded, value: number) => { if (m) (m.material as MeshBasicMaterial).opacity = Math.max(0, value); };
/** An angle brought to (-π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A point on the figure's plane (in cards) to the screen-facing frame. */
function onFigure(x: number, y: number, out = new Vector3()) {
  const lx = x * SCALE, ly = y * SCALE;
  return out.set(ORIGIN.x + lx, ORIGIN.y + ly * Math.cos(FACE), ORIGIN.z + ly * Math.sin(FACE));
}
/** Straight out of the figure's face, towards the camera. */
const OUT_OF_FIGURE = new Vector3(0, -Math.sin(FACE), Math.cos(FACE));

// ---------------------------------------------------------------------------
// Textures, drawn once.

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  return texture;
}

let pentagramTexture: CanvasTexture | null = null;
/** The seal on the floor: a five-pointed star in a double ring, runes between. White on clear. */
function pentagram() {
  return pentagramTexture ??= canvasTexture(512, 512, (ctx) => {
    const c = 256;
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 10;
    const ring = (r: number, w: number) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c, c, r * c, 0, Math.PI * 2); ctx.stroke(); };
    ring(0.98, 5); ring(0.9, 2); ring(0.83, 1.5); ring(0.36, 2.5);
    // The star, drawn as one line through every other point.
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + ((i * 2) % 5) * (Math.PI * 2 / 5);
      const x = c + Math.cos(a) * 0.83 * c, y = c + Math.sin(a) * 0.83 * c;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    // Runes round the band between the outer rings.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ctx.save();
      ctx.translate(c + Math.cos(a) * 0.94 * c, c + Math.sin(a) * 0.94 * c);
      ctx.rotate(a + Math.PI / 2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const k = (i * 3) % 5;
      if (k === 0) { ctx.moveTo(-4, 5); ctx.lineTo(0, -5); ctx.lineTo(4, 5); }
      else if (k === 1) { ctx.moveTo(0, -5); ctx.lineTo(0, 5); ctx.moveTo(-4, -1); ctx.lineTo(4, -1); }
      else if (k === 2) { ctx.arc(0, 0, 4, Math.PI * 0.2, Math.PI * 1.8); }
      else if (k === 3) { ctx.moveTo(-4, -5); ctx.lineTo(4, 0); ctx.lineTo(-4, 5); }
      else { ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(-2, -5); ctx.lineTo(2, 5); }
      ctx.stroke();
      ctx.restore();
    }
    // An eye in the middle: the Forbidden One watches.
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c - 0.26 * c, c);
    ctx.quadraticCurveTo(c, c - 0.2 * c, c + 0.26 * c, c);
    ctx.quadraticCurveTo(c, c + 0.2 * c, c - 0.26 * c, c);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, 0.07 * c, 0, Math.PI * 2);
    ctx.fill();
  });
}

let glowTexture: CanvasTexture | null = null;
/** A soft round glow, white in the middle. */
function glow() {
  return glowTexture ??= canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.8)");
    g.addColorStop(0.45, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }, false);
}

let raysTexture: CanvasTexture | null = null;
/** A sunburst: rays of light of uneven width fanning out, fading to the rim. */
function rays() {
  return raysTexture ??= canvasTexture(512, 512, (ctx) => {
    const c = 256;
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + rand() * 0.08;
      const w = 0.025 + rand() * 0.06;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      const strength = 0.35 + rand() * 0.5;
      g.addColorStop(0, `rgba(255,255,255,${strength})`);
      g.addColorStop(0.5, `rgba(255,255,255,${strength * 0.4})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, a - w, a + w);
      ctx.closePath();
      ctx.fill();
    }
  }, false);
}

let flameTexture: CanvasTexture | null = null;
/** A column of light rising off a square: bright at its foot, fading up and to the sides. */
function flame() {
  return flameTexture ??= canvasTexture(64, 256, (ctx) => {
    const up = ctx.createLinearGradient(0, 256, 0, 0);
    up.addColorStop(0, "rgba(255,255,255,1)");
    up.addColorStop(0.3, "rgba(255,255,255,0.5)");
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
  }, false);
}

// ---------------------------------------------------------------------------

interface Piece { num: number; id: number | null; x: number; y: number; lift: number; facing: number; }
interface Strike { x: number; y: number; lift: number; }
interface Summoning { key: string; seat: number; pieces: Piece[]; targets: Strike[]; }

/** Rotates a board point into the screen-facing frame. */
function toScreen(x: number, y: number, upright: number) {
  const c = Math.cos(-upright), s = Math.sin(-upright);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Points the unit tube from `a` to `b`, `radius` thick. */
function stretch(m: Mesh, a: Vector3, b: Vector3, radius: number, tmp: { d: Vector3; q: Quaternion; }) {
  tmp.d.subVectors(b, a);
  const length = tmp.d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  tmp.q.setFromUnitVectors(UP, tmp.d.normalize());
  m.quaternion.copy(tmp.q);
  m.scale.set(radius, Math.max(length, 1e-4), radius);
}
const UP = new Vector3(0, 1, 0);

const SPARKS = 260;
/** Each spark's own randomness: an angle, a share of a radius, a speed, an offset in time. */
const SPARK_SEEDS = (() => {
  let seed = 23;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: SPARKS }, () => ({ a: rand() * Math.PI * 2, r: rand(), speed: 0.6 + rand() * 0.9, off: rand(), up: rand() }));
})();

function SummoningEffect({ summoning, size, upright, isEnemy, onDone }: {
  summoning: Summoning; size: number; upright: number; isEnemy: boolean; onDone: () => void;
}) {
  const clock = useRef(0);
  const done = useRef(false);
  const stage = useRef<ExodiaStage>("idle");
  const fired = useRef(new Set<string>());
  const fast = useMemo(reducedMotion, []);

  const dark = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const seal = useRef<Mesh>(null);
  const sealInner = useRef<Mesh>(null);
  const points = useRef<(Sprite | null)[]>([]);
  const columns = useRef<(Mesh | null)[]>([]);
  const groups = useRef<(Group | null)[]>([]);
  const halos = useRef<(Mesh | null)[]>([]);
  const burns = useRef<(Mesh | null)[]>([]);
  const slams = useRef<(Mesh | null)[]>([]);
  const chains = useRef<(Mesh | null)[]>([]);
  const snaps = useRef<(Sprite | null)[]>([]);
  const aura = useRef<Sprite>(null);
  const sunburst = useRef<Mesh>(null);
  const sunburst2 = useRef<Mesh>(null);
  const eyes = useRef<(Sprite | null)[]>([]);
  const orb = useRef<Sprite>(null);
  const orbCore = useRef<Sprite>(null);
  const beams = useRef<(Mesh | null)[][]>([]);
  const impacts = useRef<(Sprite | null)[]>([]);
  const impactRings = useRef<(Mesh | null)[]>([]);
  const pillars = useRef<(Mesh | null)[]>([]);
  const sparks = useRef<Points>(null);

  const radius = Math.min(3.1, size * 0.42);
  const cards = useMemo(() => summoning.pieces.map((p) => ({ ...previewRenderCard(p.num), isFaceDown: false, position: new Vector3(0, 0, 0) })), [summoning.pieces]);
  // Where each piece starts (on its square, in the screen-facing frame) and lands.
  const starts = useMemo(() => summoning.pieces.map((p) => {
    const s = toScreen(p.x, p.y, upright);
    return { x: s.x, y: s.y, z: p.lift + REST_Z, turn: wrap(p.facing - upright) };
  }), [summoning.pieces, upright]);
  const slots = useMemo(() => SLOTS.map((s) => onFigure(s.x, s.y).add(OUT_OF_FIGURE.clone().multiplyScalar(s.z))), []);
  // The pentagram's points, on the floor round the board's middle: one for each piece, the top one for the head.
  const starPoints = useMemo(() => SLOTS.map((_, i) => {
    const a = Math.PI / 2 + [2, 3, 1, 4, 0][i] * (Math.PI * 2 / 5);
    return new Vector3(Math.cos(a) * radius * 0.83, Math.sin(a) * radius * 0.83, DARK_Z + 0.03);
  }), [radius]);
  const chest = useMemo(() => onFigure(CHEST.x, CHEST.y).add(OUT_OF_FIGURE.clone().multiplyScalar(0.45)), []);
  const targets = useMemo(() => summoning.targets.map((t) => {
    const s = toScreen(t.x, t.y, upright);
    // Over the darkness, so the hit shows through it.
    return new Vector3(s.x, s.y, Math.max(t.lift + 0.25, DARK_Z + 0.15));
  }), [summoning.targets, upright]);
  const tmp = useMemo(() => ({ d: new Vector3(), q: new Quaternion(), v: new Vector3(), w: new Vector3() }), []);

  const sparkGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
    return g;
  }, []);
  useEffect(() => () => sparkGeometry.dispose(), [sparkGeometry]);

  /** Runs `act` once, the first frame past `at`. */
  const once = (name: string, at: number, t: number, act: () => void) => {
    if (t >= at && !fired.current.has(name)) { fired.current.add(name); act(); }
  };

  useFrame((state, delta) => {
    if (done.current) return;
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    const t = clock.current;

    // The stages, for the overlay and the Game Over screen to keep time with.
    const now: ExodiaStage = t < ASSEMBLE_FROM ? "rise" : t < AWAKEN ? "assemble" : t < CHARGE ? "awaken" : t < UNLEASH ? "charge" : t < END ? (t < FADE ? "unleash" : "fade") : "idle";
    if (now !== stage.current) { stage.current = now; if (now !== "idle") exodiaStage(now); }

    // Sounds and jolts, each once.
    summoning.pieces.forEach((_, i) => {
      once(`lit${i}`, RISE_FROM + i * RISE_STEP, t, () => { playSfx("powerup", 0.35); exodiaQuake(0.15); });
      once(`slam${i}`, ASSEMBLE_FROM + i * FLY_STEP + FLY_TIME, t, () => { playSfx("bonk", 0.6); exodiaQuake(i === SLOTS.length - 1 ? 0.7 : 0.35); });
    });
    once("awaken", AWAKEN, t, () => playSfx("spell", 0.7));
    once("snap", SNAP, t, () => { playSfx("destroyed", 0.6); exodiaQuake(0.6); });
    once("charge", CHARGE, t, () => playSfx("trap", 0.55));
    once("unleash", UNLEASH, t, () => { playSfx("lifeAttack", 0.9); exodiaQuake(1); });
    once("impact", UNLEASH + 0.2, t, () => { playSfx("hurt", 0.7); playSfx("destroyed", 0.7); });
    once("fade", FADE + 0.3, t, () => playSfx("powerup", 0.3));

    const pulse = 0.8 + 0.2 * Math.sin(t * 7);
    const charge = phase(t, CHARGE, UNLEASH);
    const firing = phase(t, UNLEASH, UNLEASH + BEAM_TIME);
    const fading = phase(t, FADE, END);
    // A shudder through everything: harder as the blast gathers, wildest as it fires.
    const tremor = fast ? 0 : (0.004 + 0.03 * easeIn(charge) + (t >= UNLEASH ? 0.05 * (1 - firing) : 0)) * (1 - fading);
    const jitter = (k: number) => tremor * Math.sin(t * 91 + k * 17.3);

    // Darkness over the field; the floor flashes white as the beam fires.
    opacity(dark.current, 0.88 * phase(t, 0, DARK_IN) * (1 - 0.8 * fading));
    const boom = t >= UNLEASH ? 1 - easeOut(phase(t, UNLEASH, UNLEASH + 0.5)) : 0;
    const slamFlash = SLOTS.reduce((sum, _, i) => {
      const at = ASSEMBLE_FROM + i * FLY_STEP + FLY_TIME;
      return sum + (t >= at ? Math.exp(-(t - at) * 9) * 0.18 : 0);
    }, 0);
    const snapFlash = t >= SNAP ? Math.exp(-(t - SNAP) * 6) * 0.3 : 0;
    opacity(flash.current, Math.min(0.75, 0.75 * boom + slamFlash + snapFlash));

    // The pentagram burns in, turns, and blazes as the seals hold it down.
    const drawn = easeOut(phase(t, 0.1, 1.1));
    const strain = phase(t, AWAKEN, SNAP);
    if (seal.current) {
      seal.current.rotation.z = t * 0.12;
      const s = radius * 2 * (0.7 + 0.3 * drawn) * (1 + 0.04 * strain * Math.sin(t * 40));
      seal.current.scale.set(s, s, 1);
      opacity(seal.current, drawn * (0.65 + 0.35 * pulse) * (1 - 0.6 * phase(t, SNAP, SNAP + 0.6)) * (1 - fading));
    }
    if (sealInner.current) {
      sealInner.current.rotation.z = -t * 0.3;
      const s = radius * 0.9 * drawn;
      sealInner.current.scale.set(s, s, 1);
      opacity(sealInner.current, drawn * 0.6 * pulse * (1 - fading));
    }

    summoning.pieces.forEach((_, i) => {
      const litAt = RISE_FROM + i * RISE_STEP;
      const lit = phase(t, litAt, litAt + 0.25);
      const rise = easeOut(phase(t, litAt, litAt + RISE_TIME));
      const flyAt = ASSEMBLE_FROM + i * FLY_STEP;
      const flyRaw = phase(t, flyAt, flyAt + FLY_TIME);
      const fly = easeInOut(flyRaw);
      const landed = t >= flyAt + FLY_TIME;
      const from = starts[i];

      // Its point of the star flares as it lights up, and a column of gold rises off its square.
      const point = points.current[i];
      if (point) {
        const s = 0.9 + 0.5 * lit * pulse + 1.2 * Math.exp(-Math.max(0, t - litAt) * 4) * lit;
        point.scale.set(s, s, 1);
        opacity(point, lit * (0.85 - 0.5 * fading));
      }
      const column = columns.current[i];
      if (column) {
        column.position.set(from.x, from.y, from.z + 0.9);
        column.scale.set(0.9 * (0.5 + lit), 1.9, 1);
        opacity(column, lit * (1 - phase(t, flyAt - 0.2, flyAt + 0.2)) * 0.9 * pulse);
      }

      const g = groups.current[i];
      if (!g) return;
      g.visible = t >= litAt - 0.05 && t < FADE + 0.55;
      if (!g.visible) return;
      // Hovering over its square, standing up and whirling round to face the screen...
      const bob = 0.07 * Math.sin(t * 3 + i * 1.7) * rise;
      const hx = from.x, hy = from.y, hz = from.z + HOVER * rise + bob;
      // ...then thrown into its place in the figure, arcing up on the way.
      const slot = slots[i];
      const x = lerp(hx, slot.x, fly) + jitter(i);
      const y = lerp(hy, slot.y, fly) + jitter(i + 7);
      const z = lerp(hz, slot.z, fly) + Math.sin(Math.PI * fly) * 0.7 + (landed ? 0.015 * Math.sin(t * 2.4) : 0);
      g.position.set(x, y, z);
      const turn = lerp(from.turn, Math.PI * 2, easeOut(rise));
      g.rotation.set(FACE * rise, 0, turn, "ZXY");
      // It overshoots a little as it lands, then settles; it swells as it burns away.
      const settle = landed ? 1 + 0.12 * Math.exp(-(t - flyAt - FLY_TIME) * 10) * Math.cos((t - flyAt - FLY_TIME) * 30) : 1;
      const s = lerp(1 + 0.12 * rise, SCALE, fly) * settle * (1 + 0.25 * easeIn(phase(t, FADE, FADE + 0.55)));
      g.scale.set(s, s, s);

      opacity(halos.current[i], rise * (0.35 + 0.25 * pulse) * (landed ? 0.5 : 1) + (landed ? 0.35 * charge : 0));
      // Washed out with gold, then gone.
      opacity(burns.current[i], easeIn(phase(t, FADE - 0.2, FADE + 0.45)) + 0.4 * boom);
      const ring = slams.current[i];
      if (ring) {
        const k = landed ? phase(t, flyAt + FLY_TIME, flyAt + FLY_TIME + 0.5) : 0;
        const rs = 1 + 3 * easeOut(k);
        ring.scale.set(rs, rs, 1);
        opacity(ring, landed ? 0.9 * (1 - k) : 0);
      }
    });

    // The seals: chains of light from each piece to its point of the star. They strain, then snap.
    chains.current.forEach((m, i) => {
      if (!m) return;
      const show = phase(t, AWAKEN - 0.2, AWAKEN + 0.25);
      m.visible = t < SNAP && show > 0;
      if (!m.visible) return;
      const shake = strain * 0.05;
      tmp.v.copy(slots[i]).add(tmp.w.set(Math.sin(t * 70 + i) * shake, Math.cos(t * 63 + i) * shake, 0));
      stretch(m, starPoints[i], tmp.v, 0.025 + 0.02 * strain, tmp);
      opacity(m, show * (0.6 + 0.4 * Math.sin(t * (12 + 30 * strain) + i)));
    });
    snaps.current.forEach((sp, i) => {
      if (!sp) return;
      const k = phase(t, SNAP, SNAP + 0.5);
      sp.visible = t >= SNAP && k < 1;
      if (!sp.visible) return;
      sp.position.lerpVectors(starPoints[i], slots[i], 0.55);
      const s = 0.4 + 2.2 * easeOut(k);
      sp.scale.set(s, s, 1);
      opacity(sp, 1 - k);
    });

    // Awake: a halo of light and a turning sunburst behind it.
    const awake = easeOut(phase(t, SNAP - 0.1, SNAP + 0.5));
    const dimming = 1 - fading;
    if (aura.current) {
      const s = SCALE * (5 + 0.6 * Math.sin(t * 3) + 2 * charge + 3 * boom) * (0.3 + 0.7 * awake);
      aura.current.scale.set(s, s, 1);
      opacity(aura.current, (0.25 + 0.55 * awake + 0.2 * charge) * dimming);
    }
    for (const [m, speed, base] of [[sunburst.current, 0.25, 9], [sunburst2.current, -0.15, 12]] as const) {
      if (!m) continue;
      m.rotation.z = t * speed;
      const s = SCALE * base * awake * (1 + 0.2 * charge + 0.5 * boom);
      m.scale.set(s, s, 1);
      opacity(m, awake * (0.45 + 0.3 * charge) * dimming);
    }

    // Its eyes flare red.
    const glare = t >= GLARE ? Math.exp(-(t - GLARE) * 3) + 0.25 * charge : 0;
    eyes.current.forEach((e, i) => {
      if (!e) return;
      e.scale.set(0.35 + 3.4 * glare * (i ? 0.6 : 1), 0.12 + 0.25 * glare, 1);
      opacity(e, Math.min(1, glare * 1.2) * dimming);
    });

    // The blast gathers: a sphere of light at its chest, everything streaming in. It shrinks hard as it fires.
    const orbSize = (t < UNLEASH ? 0.15 + 1.6 * easeIn(charge) : 1.9 * (1 - easeIn(firing))) * (0.9 + 0.1 * Math.sin(t * 40));
    if (orb.current) {
      orb.current.position.copy(chest);
      orb.current.scale.set(orbSize * 1.8, orbSize * 1.8, 1);
      opacity(orb.current, t >= CHARGE ? 0.9 : 0);
    }
    if (orbCore.current) {
      orbCore.current.position.copy(chest);
      orbCore.current.scale.set(orbSize * 0.8, orbSize * 0.8, 1);
      opacity(orbCore.current, t >= CHARGE ? 1 : 0);
    }

    // OBLITERATE: a beam into every enemy leader.
    const reach = easeOut(phase(t, UNLEASH, UNLEASH + 0.16));
    const width = (t < UNLEASH ? 0 : (1 - easeIn(firing))) * (1 + 0.25 * Math.sin(t * 55));
    targets.forEach((target, k) => {
      tmp.w.lerpVectors(chest, target, reach);
      (beams.current[k] ?? []).forEach((m, layer) => {
        if (!m) return;
        m.visible = t >= UNLEASH && firing < 1;
        if (!m.visible) return;
        stretch(m, chest, tmp.w, [0.07, 0.2, 0.45][layer] * width * SCALE + 0.001, tmp);
        opacity(m, [1, 0.7, 0.3][layer]);
      });
      const hit = phase(t, UNLEASH + 0.12, UNLEASH + BEAM_TIME + 0.4);
      const impact = impacts.current[k];
      if (impact) {
        impact.visible = t >= UNLEASH + 0.12 && hit < 1;
        impact.position.copy(target);
        const s = (1.2 + 2.8 * easeOut(Math.min(1, hit * 3))) * (1 + 0.2 * Math.sin(t * 50));
        impact.scale.set(s, s, 1);
        opacity(impact, 1 - easeIn(hit));
      }
      const ring = impactRings.current[k];
      if (ring) {
        ring.position.set(target.x, target.y, target.z - 0.1);
        const s = 0.5 + size * 0.9 * easeOut(hit);
        ring.scale.set(s, s, 1);
        opacity(ring, t >= UNLEASH + 0.12 ? 0.9 * (1 - hit) : 0);
      }
      const pillar = pillars.current[k];
      if (pillar) {
        pillar.position.set(target.x, target.y, target.z + 1.4);
        pillar.scale.set(1.6 * (1 - hit) + 0.2, 3.2, 1);
        opacity(pillar, t >= UNLEASH + 0.12 ? 1 - hit : 0);
      }
    });

    // Sparks: embers rising off the star while it wakes, streaming into the orb as it charges,
    // and drifting up off the figure as it burns away.
    if (sparks.current) {
      const p = sparkGeometry.getAttribute("position") as Float32BufferAttribute;
      const mat = sparks.current.material as PointsMaterial;
      let shown = 0;
      SPARK_SEEDS.forEach((sp, i) => {
        let x = 0, y = 0, z = -100;
        if (t >= FADE) {
          // Off the figure, up and away.
          const k = phase(t, FADE + sp.off * 0.4, END);
          const slot = slots[i % slots.length];
          x = slot.x + Math.cos(sp.a) * (0.3 + 1.6 * k) * sp.r * SCALE;
          y = slot.y + Math.sin(sp.a) * (0.3 + 1.6 * k) * sp.r * SCALE * 0.5;
          z = slot.z + (sp.up - 0.3) * 0.6 + 2.2 * k * sp.speed;
          shown = 1 - fading;
        } else if (t >= CHARGE && t < UNLEASH + 0.1) {
          // Spiralling into the orb, over and over.
          const k = ((t - CHARGE) * sp.speed * 1.4 + sp.off) % 1;
          const r = (1 - k) * (1.2 + 2.6 * sp.r);
          const a = sp.a + k * 4;
          x = chest.x + Math.cos(a) * r;
          y = chest.y + Math.sin(a) * r * 0.6;
          z = chest.z + Math.sin(a * 1.3) * r * 0.7;
          shown = 1;
        } else if (t >= AWAKEN - 0.4 && t < CHARGE) {
          // Rising off the star's rim.
          const k = ((t - AWAKEN) * sp.speed * 0.6 + sp.off) % 1;
          const r = radius * (0.35 + 0.65 * sp.r);
          x = Math.cos(sp.a + t * 0.12) * r;
          y = Math.sin(sp.a + t * 0.12) * r;
          z = DARK_Z + 0.05 + k * 3 * sp.up;
          shown = phase(t, AWAKEN - 0.4, AWAKEN);
        }
        p.setXYZ(i, x, y, z);
      });
      p.needsUpdate = true;
      mat.opacity = shown;
      sparks.current.visible = shown > 0.01;
    }

    if (t >= END) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  const extent = size + 14;
  const gold = "#ffc42e";
  return (
    <group rotation={[0, 0, upright]}>
      {/* The darkness, and the floor-wide flash. */}
      <mesh ref={dark} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, DARK_Z]} raycast={() => null}>
        <meshBasicMaterial color="#040006" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={flash} geometry={PLANE} scale={[extent, extent, 1]} position={[0, 0, DARK_Z + 0.01]} raycast={() => null}>
        <meshBasicMaterial color="#fff1c2" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* The pentagram, and its points. */}
      <mesh ref={seal} geometry={PLANE} position={[0, 0, DARK_Z + 0.02]} raycast={() => null}>
        <meshBasicMaterial map={pentagram()} color={gold} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={sealInner} geometry={PLANE} position={[0, 0, DARK_Z + 0.025]} raycast={() => null}>
        <meshBasicMaterial map={pentagram()} color="#ff5a1f" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      {starPoints.map((p, i) => (
        <sprite key={i} ref={(s) => { points.current[i] = s; }} position={p} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
          <spriteMaterial map={glow()} color="#ffd25a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </sprite>
      ))}

      {/* Behind the figure: the sunburst and the halo. */}
      <group position={onFigure(CHEST.x, CHEST.y + 0.2).add(OUT_OF_FIGURE.clone().multiplyScalar(-0.3))} rotation={[FACE, 0, 0]}>
        <mesh ref={sunburst2} geometry={PLANE} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
          <meshBasicMaterial map={rays()} color="#ff7a18" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
        </mesh>
        <mesh ref={sunburst} geometry={PLANE} scale={[0.0001, 0.0001, 1]} position={[0, 0, 0.01]} raycast={() => null}>
          <meshBasicMaterial map={rays()} color={gold} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
        </mesh>
      </group>
      <sprite ref={aura} position={onFigure(CHEST.x, CHEST.y + 0.2).add(OUT_OF_FIGURE.clone().multiplyScalar(-0.2))} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <spriteMaterial map={glow()} color="#ff9d1f" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>

      {/* The columns of light off each piece's square, facing the screen. */}
      {summoning.pieces.map((_, i) => (
        <mesh key={`col${i}`} ref={(m) => { columns.current[i] = m; }} geometry={PLANE} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <meshBasicMaterial map={flame()} color={gold} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
        </mesh>
      ))}

      {/* The seals, and where each breaks. */}
      {summoning.pieces.map((_, i) => (
        <mesh key={`chain${i}`} ref={(m) => { chains.current[i] = m; }} geometry={TUBE} visible={false} raycast={() => null}>
          <meshBasicMaterial color="#ffe08a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
      {summoning.pieces.map((_, i) => (
        <sprite key={`snap${i}`} ref={(s) => { snaps.current[i] = s; }} visible={false} raycast={() => null}>
          <spriteMaterial map={glow()} color="#fff4c9" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </sprite>
      ))}

      {/* The five pieces. */}
      {summoning.pieces.map((_, i) => (
        <group key={`piece${i}`} ref={(g) => { groups.current[i] = g; }} position={[starts[i].x, starts[i].y, starts[i].z]} visible={false}>
          <mesh ref={(m) => { halos.current[i] = m; }} geometry={PLANE} scale={[CARD_W * 1.45, CARD_H * 1.3, 1]} position={[0, 0, -0.02]} raycast={() => null}>
            <meshBasicMaterial map={glow()} color="#ffb21a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
          </mesh>
          <mesh ref={(m) => { slams.current[i] = m; }} geometry={RING} scale={[0.0001, 0.0001, 1]} position={[0, 0, -0.03]} raycast={() => null}>
            <meshBasicMaterial color="#ffe7a3" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
          </mesh>
          <Suspense fallback={null}>
            <YugiohCard card={cards[i]} facing={0} isEnemy={isEnemy} isPreview />
          </Suspense>
          <mesh ref={(m) => { burns.current[i] = m; }} geometry={PLANE} scale={[CARD_W * 1.04, CARD_H * 1.04, 1]} position={[0, 0, 0.04]} raycast={() => null}>
            <meshBasicMaterial color="#ffcf5a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
          </mesh>
          {/* The head's eyes. */}
          {i === summoning.pieces.length - 1 && [0, 1].map((e) => (
            <sprite key={e} ref={(s) => { eyes.current[e] = s; }} position={[0, 0.12, 0.08 + e * 0.01]} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
              <spriteMaterial map={glow()} color={e ? "#ffffff" : "#ff2a12"} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
            </sprite>
          ))}
        </group>
      ))}

      {/* The orb at its chest. */}
      <sprite ref={orb} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <spriteMaterial map={glow()} color="#ffae2a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={orbCore} scale={[0.0001, 0.0001, 1]} raycast={() => null}>
        <spriteMaterial map={glow()} color="#ffffff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>

      {/* The beams (a white core in two sheaths of gold), and what they hit. */}
      {targets.map((_, k) => (
        <group key={`beam${k}`}>
          {["#ffffff", "#ffd36b", "#ff7a18"].map((color, layer) => (
            <mesh
              key={layer}
              ref={(m) => { (beams.current[k] ??= [])[layer] = m; }}
              geometry={TUBE}
              visible={false}
              raycast={() => null}
            >
              <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
            </mesh>
          ))}
          <mesh ref={(m) => { pillars.current[k] = m; }} geometry={PLANE} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
            <meshBasicMaterial map={flame()} color="#ffcf5a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
          </mesh>
          <mesh ref={(m) => { impactRings.current[k] = m; }} geometry={RING} raycast={() => null}>
            <meshBasicMaterial color="#ffd36b" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
          </mesh>
          <sprite ref={(s) => { impacts.current[k] = s; }} visible={false} raycast={() => null}>
            <spriteMaterial map={glow()} color="#fff0c0" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      ))}

      <points ref={sparks} geometry={sparkGeometry} visible={false} raycast={() => null}>
        <pointsMaterial map={glow()} color="#ffd36b" size={0.11} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </points>
    </group>
  );
}

/** Which limb a card is, by its name: its place in SLOTS, or -1. */
function slotOf(num: number) {
  const name = catalogCard(num)?.name ?? "";
  if (!name.includes("Forbidden One")) return -1;
  return SLOTS.findIndex((s, i) => i < SLOTS.length - 1 && name.startsWith(s.name));
}

/**
 * Plays Exodia's win. The server reports it as a `leaderWin` by a deck led by
 * Exodia; the limbs are found on the board, and their real cards are kept off
 * it while their stand-ins fly (see stores/ritualStore).
 */
export default function Exodia({ size, upright, liftAt, facingFor, isEnemy }: {
  size: number; upright: number; liftAt: (x: number, y: number) => number; facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean;
}) {
  const [summoning, setSummoning] = useState<Summoning | null>(null);
  // The board passes these fresh on every render: read the latest without subscribing again.
  const board = useRef({ liftAt, facingFor });
  board.current = { liftAt, facingFor };

  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.eventSeq === previous.eventSeq || !state.view) return;
    const win = state.lastEvents.find((e) => e.type === "leaderWin" && e.num !== undefined);
    if (!win || !(catalogCard(win.num!)?.name ?? "").includes("Exodia")) return;
    const view = state.view;
    const { liftAt, facingFor } = board.current;
    // Every limb on the field, in its slot's order (one of each), then the head from the leader.
    const limbs: Piece[] = [];
    for (let slot = 0; slot < SLOTS.length - 1; slot++) {
      const card = view.cards.find((c) => c.owner === win.seat && !c.faceDown && slotOf(c.num) === slot);
      limbs.push(card
        ? { num: card.num, id: card.id, x: card.x, y: card.y, lift: liftAt(card.x, card.y), facing: facingFor(win.seat) }
        // Not on the board as we see it (it should be): it comes out of the leader instead.
        : { num: allCards().find((c) => slotOf(c.num) === slot)?.num ?? -1, id: null, x: win.x, y: win.y, lift: liftAt(win.x, win.y), facing: facingFor(win.seat) });
    }
    const head: Piece = { num: win.num!, id: null, x: win.x, y: win.y, lift: liftAt(win.x, win.y), facing: facingFor(win.seat) };
    const myTeam = view.seats[win.seat]?.team;
    const targets = view.seats
      .filter((s) => s.team !== myTeam)
      .map((s) => ({ x: s.leaderX, y: s.leaderY, lift: liftAt(s.leaderX, s.leaderY) }));
    for (const limb of limbs) if (limb.id !== null) useRitualStore.getState().hide(limb.id);
    exodiaStage("rise");
    setSummoning({ key: `${state.eventSeq}`, seat: win.seat, pieces: [...limbs, head], targets });
  }), []);

  // Leaving mid-show (or the board going away) lets the Game Over screen through.
  useEffect(() => () => exodiaStage("idle"), []);

  if (!summoning) return null;
  return (
    <SummoningEffect
      key={summoning.key}
      summoning={summoning}
      size={size}
      upright={upright}
      isEnemy={isEnemy(summoning.seat)}
      onDone={() => {
        for (const p of summoning.pieces) if (p.id !== null) useRitualStore.getState().show(p.id);
        exodiaStage("idle");
        setSummoning(null);
      }}
    />
  );
}
