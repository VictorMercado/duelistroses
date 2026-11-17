import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import YugiohCard from "./YugiohCard";
import { previewRenderCard } from "@/game/catalog";
import { playSfx, type Sfx } from "@/game/sfx";
import { useFusionStore, type FusionChain } from "@/stores/fusionStore";
import type { ChainStep } from "@/net/protocol";

/*
 * Cards played together, merged one at a time in front of the camera. The
 * first card is held on the left and the rest wait on the right. Each one in
 * turn slides left to the held card: if they fuse, the two orbit a vertical
 * axis between them (still facing the camera) and become the fusion; if not,
 * the newcomer bonks the held card away and is held in its place; a power-up
 * glows into its monster. Whatever is left drops towards the board, where the
 * real card then lands.
 */

// Layout, in board units (a card is 0.68 x 0.98), in the camera's plane: x right, y up, z towards the camera.
const CARD_W = 0.68;
const CARD_H = 0.98;
const HELD_X = -0.62;
const NEXT_X = 0.62;
const CONTACT_X = HELD_X + CARD_W + 0.06; // where a sliding card stops, just right of the held one
const QUEUE_DX = 0.16; // each card further back in the queue shows a little further right...
const QUEUE_DZ = -0.12; // ...and a little behind
const HAND = new Vector3(0, -1.9, 0); // where the cards come from and the result goes, below the screen centre
const ABOVE = new Vector3(NEXT_X, 1.7, 0); // where a card already on the board drops in from

// How far in front of the camera the layout sits. Close, so the board never cuts through it;
// it is scaled down to match.
const DIST = 2;

// Timeline, in seconds.
const INTRO = 0.45;
const SLIDE = 0.4;
const DROP = 0.3; // a card from the board drops in before sliding
const SPIN = 1.1;
const FLASH = 0.25;
const HIT = 0.12;
const KNOCK = 0.55;
const MERGE = 0.6;
const SETTLE = 0.35;
const OUTRO = 0.45;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t: number) => Math.pow(clamp01(t), 2);
const easeInOut = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Actor { key: string; num: number; }

/** Where an actor is at some instant. */
interface Pose { x: number; y: number; z: number; scale: number; rot: number; }

/** One merge, resolved into who moves where. */
interface Beat {
  step: ChainStep;
  start: number;
  end: number;
  /** Already on the board: drops in from above instead of waiting in the queue. */
  fromBoard: boolean;
  left: string;   // the held card
  right: string;  // the card that slides in
  result: string; // the held card afterwards
  /** bonk: the card knocked away. equip: the power-up that glows in. */
  loser: string;
  /** Cards still waiting on the right when the beat starts, next one first (the incoming card included unless fromBoard). */
  queue: string[];
}

interface Plan { actors: Actor[]; first: string; beats: Beat[]; outroAt: number; total: number; cues: { at: number; sfx: Sfx; volume: number; }[]; }

/** Works the steps of a chain out into actors and a timeline. */
function plan(chain: FusionChain): Plan {
  const steps = chain.steps;
  const actors: Actor[] = [];
  const add = (key: string, num: number) => { actors.push({ key, num }); return key; };
  const cues: Plan["cues"] = [];

  const first = add("held", steps[0].base);
  // The cards waiting on the right: every card played after the first, in order.
  // A card already on the board (when the chain ends on one) is not among them.
  const fromBoard = steps.map((step, i) => i > 0 && !!step.board && !steps[i - 1].board);
  const incoming = steps.map((step, i) => (fromBoard[i] ? add(`board${i}`, step.base) : add(`add${i}`, step.add)));
  const waiting = incoming.filter((_, i) => !fromBoard[i]);

  const beats: Beat[] = [];
  let held = first;
  let t = INTRO;
  let used = 0; // waiting cards already slid in
  steps.forEach((step, i) => {
    const right = incoming[i];
    const queue = waiting.slice(used);
    if (!fromBoard[i]) used++;
    const approach = (fromBoard[i] ? DROP : 0) + SLIDE;
    let result = held;
    let loser = right;
    let length = approach;
    if (step.kind === "fuse") {
      result = add(`fused${i}`, step.result);
      length += SPIN + FLASH + SETTLE;
      cues.push({ at: t + approach + SPIN, sfx: "powerup", volume: 0.5 });
    } else if (step.kind === "bonk") {
      // The newer card knocks the older one away. From the board, the newer one is the held card.
      result = fromBoard[i] ? held : right;
      loser = fromBoard[i] ? right : held;
      length += HIT + KNOCK + SETTLE;
      cues.push({ at: t + approach + HIT, sfx: "bonk", volume: 0.5 });
    } else {
      // A power-up glows into its monster, whichever side that is on.
      const heldIsResult = step.result === (fromBoard[i] ? step.add : step.base) || step.result < 0;
      result = heldIsResult ? held : right;
      loser = heldIsResult ? right : held;
      length += MERGE + SETTLE;
      cues.push({ at: t + approach, sfx: "powerup", volume: 0.5 });
    }
    beats.push({ step, start: t, end: t + length, fromBoard: fromBoard[i], left: held, right, result, loser, queue });
    held = result;
    t += length;
  });
  if (chain.mine) cues.push({ at: t + OUTRO, sfx: "cardIn", volume: 0.5 });
  return { actors, first, beats, outroAt: t, total: t + OUTRO, cues };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const at = (x: number, y = 0, z = 0, scale = 1, rot = 0): Pose => ({ x, y, z, scale, rot });
const queueSlot = (index: number) => at(NEXT_X + index * QUEUE_DX, 0, index * QUEUE_DZ);
const mix = (a: Pose, b: Pose, t: number): Pose => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), scale: lerp(a.scale, b.scale, t), rot: lerp(a.rot, b.rot, t) });

/** Glow effects at some instant: a flash where a fusion forms, a halo where a power-up goes in. */
interface Glow { flash: number; flashX: number; halo: number; haloX: number; }

/** Every visible actor's pose at time t, and the glow. */
function poses(p: Plan, t: number): { shown: Map<string, Pose>; glow: Glow; dim: number; } {
  const shown = new Map<string, Pose>();
  const glow: Glow = { flash: 0, flashX: 0, halo: 0, haloX: 0 };
  const dim = clamp01(t / INTRO) * (1 - clamp01((t - p.outroAt) / OUTRO));

  if (t < INTRO) {
    // Everything comes up from the hand to its place.
    const k = easeOut(t / INTRO);
    const from = at(HAND.x, HAND.y, 0, 0.5);
    shown.set(p.first, mix(from, at(HELD_X), k));
    p.beats[0].queue.forEach((key, i) => shown.set(key, mix(from, queueSlot(i), easeOut((t - i * 0.04) / INTRO))));
    return { shown, glow, dim };
  }

  if (t >= p.outroAt) {
    // The result drops away towards the board.
    const last = p.beats[p.beats.length - 1].result;
    const k = easeIn((t - p.outroAt) / OUTRO);
    if (k < 1) shown.set(last, mix(at(HELD_X), at(HAND.x, HAND.y, 0, 0.45), k));
    return { shown, glow, dim };
  }

  const beat = p.beats.find((b) => t < b.end) ?? p.beats[p.beats.length - 1];
  const u = t - beat.start;
  const approach = (beat.fromBoard ? DROP : 0) + SLIDE;

  // The rest of the queue moves up a place while the next card slides out of it.
  const waiting = beat.fromBoard ? beat.queue : beat.queue.slice(1);
  const shift = easeInOut((u - (beat.fromBoard ? DROP : 0)) / SLIDE);
  waiting.forEach((key, i) => shown.set(key, mix(queueSlot(beat.fromBoard ? i : i + 1), queueSlot(i), beat.fromBoard ? 0 : shift)));

  // The incoming card: dropping in from the board, then sliding left to the held card.
  let right: Pose;
  if (beat.fromBoard && u < DROP) right = mix(at(ABOVE.x, ABOVE.y, 0, 0.8), at(NEXT_X), easeOut(u / DROP));
  else right = mix(at(NEXT_X), at(CONTACT_X), easeInOut((u - (beat.fromBoard ? DROP : 0)) / SLIDE));
  let left = at(HELD_X);

  const v = u - approach; // time into the merge itself
  if (v < 0) {
    shown.set(beat.left, left);
    shown.set(beat.right, right);
    return { shown, glow, dim };
  }

  const settle = (from: Pose, startAt: number) => mix(from, at(HELD_X), easeInOut((v - startAt) / SETTLE));

  if (beat.step.kind === "fuse") {
    // Both orbit a vertical axis halfway between them, faster and closer, still facing the camera.
    const cx = (HELD_X + CONTACT_X) / 2;
    const r0 = (CONTACT_X - HELD_X) / 2;
    if (v < SPIN) {
      const k = clamp01(v / SPIN);
      const angle = Math.PI * 2 * 2.5 * easeIn(k);
      const r = r0 * (1 - Math.pow(k, 1.6));
      const lift = 1 + 0.08 * Math.sin(Math.PI * k);
      shown.set(beat.right, at(cx + r * Math.cos(angle), 0, r * Math.sin(angle), lift));
      shown.set(beat.left, at(cx - r * Math.cos(angle), 0, -r * Math.sin(angle), lift));
      glow.flash = 0.4 * easeIn(k);
      glow.flashX = cx;
    } else if (v < SPIN + FLASH) {
      // A flash, and the fusion stands where the two met.
      const k = (v - SPIN) / FLASH;
      shown.set(beat.result, at(cx, 0, 0, 1.25 - 0.25 * easeOut(k)));
      glow.flash = 1 - k;
      glow.flashX = cx;
    } else {
      shown.set(beat.result, settle(at(cx), SPIN + FLASH));
    }
  } else if (beat.step.kind === "bonk") {
    // The incoming card hits, and the loser is knocked off the side it was on, spinning.
    const loserOnLeft = beat.loser === beat.left;
    const winner = loserOnLeft ? beat.right : beat.left;
    if (v < HIT) {
      const k = easeIn(v / HIT);
      left = mix(left, at(HELD_X - 0.04), k);
      right = mix(right, at(CONTACT_X - 0.12), k);
      shown.set(beat.left, left);
      shown.set(beat.right, right);
    } else {
      const k = clamp01((v - HIT) / KNOCK);
      const side = loserOnLeft ? -1 : 1;
      const origin = loserOnLeft ? at(HELD_X - 0.04) : at(CONTACT_X - 0.12);
      if (k < 1) shown.set(beat.loser, at(origin.x + side * 1.6 * k, origin.y + 0.55 * Math.sin(Math.PI * k) - 1.2 * k * k, 0.1, 1 - 0.4 * k, side * -Math.PI * 3 * k));
      // The winner recoils a touch, then takes the held place.
      const winnerFrom = loserOnLeft ? at(CONTACT_X - 0.12 + 0.06 * Math.sin(Math.PI * k)) : at(HELD_X - 0.04 - 0.06 * Math.sin(Math.PI * k));
      shown.set(winner, v < HIT + KNOCK ? winnerFrom : settle(loserOnLeft ? at(CONTACT_X - 0.12) : at(HELD_X - 0.04), HIT + KNOCK));
    }
  } else {
    // The power-up moves onto its monster and dissolves into light.
    const keeper = beat.result;
    const keeperOnLeft = keeper === beat.left;
    const keeperPose = keeperOnLeft ? left : right;
    if (v < MERGE) {
      const k = clamp01(v / MERGE);
      const pulse = 1 + 0.1 * Math.sin(Math.PI * k);
      shown.set(keeper, { ...keeperPose, scale: pulse });
      const giverFrom = keeperOnLeft ? right : left;
      if (k < 0.85) shown.set(beat.loser, mix(giverFrom, { ...keeperPose, z: 0.05, scale: 0.35 }, easeIn(k / 0.85)));
      glow.halo = Math.sin(Math.PI * k);
      glow.haloX = keeperPose.x;
    } else {
      shown.set(keeper, settle(keeperPose, MERGE));
    }
  }
  return { shown, glow, dim };
}

const PLANE = new PlaneGeometry(1, 1);
const HALO = [{ grow: 1.1, alpha: 0.6 }, { grow: 1.25, alpha: 0.32 }, { grow: 1.45, alpha: 0.16 }];

/** One card of the animation. Its group is moved by the parent every frame. */
function ActorCard({ actor, setRef }: { actor: Actor; setRef: (g: Group | null) => void; }) {
  const card = useMemo(() => previewRenderCard(actor.num), [actor.num]);
  return (
    <group ref={setRef} visible={false}>
      <Suspense fallback={null}>
        <YugiohCard card={card} isPreview />
      </Suspense>
    </group>
  );
}

function Sequence({ chain }: { chain: FusionChain; }) {
  const timeline = useMemo(() => plan(chain), [chain]);
  const finish = useFusionStore((s) => s.finish);
  const camera = useThree((s) => s.camera);
  const root = useRef<Group>(null);
  const groups = useRef(new Map<string, Group>());
  const dim = useRef<Mesh>(null);
  const flash = useRef<Mesh>(null);
  const halos = useRef<(Mesh | null)[]>([]);
  const t = useRef(0);
  const cue = useRef(0);
  const done = useRef(false);
  const forward = useMemo(() => new Vector3(), []);

  // A tap (or reduced motion) skips straight to the end.
  useEffect(() => {
    if (reducedMotion()) t.current = timeline.total;
    const skipAt = useFusionStore.getState().skipSeq;
    return useFusionStore.subscribe((s) => {
      if (s.skipSeq !== skipAt) t.current = timeline.total;
    });
  }, [timeline]);

  useFrame((state, delta) => {
    if (done.current || !root.current) return;
    const skipped = t.current >= timeline.total;
    t.current = Math.min(timeline.total, t.current + Math.min(delta, 0.05));
    const time = t.current;

    // Sounds that are due; skipping plays none but the landing.
    while (cue.current < timeline.cues.length && timeline.cues[cue.current].at <= time) {
      const c = timeline.cues[cue.current++];
      if (!skipped || c.sfx === "cardIn") playSfx(c.sfx, c.volume);
    }

    // Held square in front of the camera, sized to fit the screen.
    const cam = camera as PerspectiveCamera;
    camera.getWorldDirection(forward);
    root.current.position.copy(camera.position).addScaledVector(forward, DIST);
    root.current.quaternion.copy(camera.quaternion);
    const viewH = 2 * DIST * Math.tan(((cam.fov ?? 20) * Math.PI) / 360);
    const viewW = viewH * (cam.aspect ?? 1);
    const queued = Math.min(4, timeline.beats.length);
    const span = 2 * (NEXT_X + CARD_W / 2) + 0.2 + (queued - 1) * QUEUE_DX;
    root.current.scale.setScalar(Math.min((0.92 * viewW) / span, (0.34 * viewH) / CARD_H));

    const frame = poses(timeline, time);
    for (const [key, group] of groups.current) {
      const pose = frame.shown.get(key);
      group.visible = !!pose;
      if (!pose) continue;
      group.position.set(pose.x, pose.y, pose.z);
      group.scale.setScalar(pose.scale);
      group.rotation.set(0, 0, pose.rot);
    }
    if (dim.current) (dim.current.material as MeshBasicMaterial).opacity = 0.55 * frame.dim;
    if (flash.current) {
      const m = flash.current.material as MeshBasicMaterial;
      m.opacity = frame.glow.flash;
      flash.current.position.x = frame.glow.flashX;
      flash.current.scale.set(CARD_W * (1.2 + frame.glow.flash), CARD_H * (1.2 + frame.glow.flash), 1);
    }
    halos.current.forEach((mesh, i) => {
      if (!mesh) return;
      (mesh.material as MeshBasicMaterial).opacity = HALO[i].alpha * frame.glow.halo;
      mesh.position.x = frame.glow.haloX;
      mesh.scale.set(CARD_W * HALO[i].grow, CARD_H * HALO[i].grow, 1);
    });

    if (time >= timeline.total) {
      done.current = true;
      finish(chain.key);
    }
    state.invalidate(); // the canvas renders on demand: keep frames coming
  });

  return (
    <group ref={root}>
      {/* The board darkens behind the cards. */}
      <mesh ref={dim} geometry={PLANE} position={[0, 0, -1]} scale={[40, 40, 1]} raycast={() => null}>
        <meshBasicMaterial color="black" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {HALO.map((_, i) => (
        <mesh key={i} ref={(m) => { halos.current[i] = m; }} geometry={PLANE} position={[0, 0, -0.02 - i * 0.002]} raycast={() => null}>
          <meshBasicMaterial color="#ffd966" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
      {timeline.actors.map((actor) => (
        <ActorCard key={actor.key} actor={actor} setRef={(g) => { if (g) groups.current.set(actor.key, g); else groups.current.delete(actor.key); }} />
      ))}
      <mesh ref={flash} geometry={PLANE} position={[0, 0, 0.3]} raycast={() => null}>
        <meshBasicMaterial color="white" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Plays queued fusion chains one at a time, in front of the camera. */
export default function FusionSequence() {
  const chain = useFusionStore((s) => s.queue[0]);
  return chain ? <Sequence key={chain.key} chain={chain} /> : null;
}

/** While a fusion plays, a tap anywhere skips it (and keeps the tap off the board). */
export function FusionSkip() {
  const playing = useFusionStore((s) => s.queue.length > 0);
  const skip = useFusionStore((s) => s.skip);
  if (!playing) return null;
  return <div className="fixed inset-0 z-[55]" onPointerDown={(e) => { e.preventDefault(); skip(); }} aria-label="Skip fusion" role="button" />;
}
