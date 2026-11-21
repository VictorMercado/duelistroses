import { memo, useEffect, useRef, useLayoutEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { BufferGeometry, CanvasTexture, CircleGeometry, Group, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Euler, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Card, type Rarity } from "@/types";
import { ASSET_URL, ULTIMATE_AURA } from "@/const"
import { useUIStore } from "@/stores/uiStore";
import { ease } from "@/game/motion";
import { terrainColor } from "@/game/terrain";
import { BLANK_MASK, MYSTERY_CARD, useCardTexture, useColorTexture, useIconTexture } from "@/game/cardTextures";
import { holdShimmer } from "@/game/shimmer";
import { watchFaces } from "@/game/faceCulling";

// Shader time used while battery saver holds the shimmer still.
const FROZEN_TIME = 1.3;

/**
 * What each rarity makes holographic (see Rarity in types.ts). `art` is the
 * artwork's foil: the rainbow holo, or the secret rare's glitter.
 */
const FOIL: Record<Rarity, { art?: "holo" | "lines" | "glitter"; stars?: boolean; attribute?: boolean; frame?: boolean; aura?: boolean; }> = {
  common: {},
  rare: { stars: true },
  secret: { art: "lines" },
  cosmic: { art: "glitter" },
  ultra: { art: "holo", stars: true },
  ultimate: { art: "holo", stars: true, attribute: true, frame: true, aura: true },
};
// The art foils as BaseHolographicMaterial's `pattern` numbers them.
const ART_PATTERN = { holo: 0, lines: 1, glitter: 2 } as const;
// How strongly the border round the art shines: less than the art, so it frames rather than competes.
const FRAME_FOIL = 0.55;
// How strongly the level stars shine: gently, so the small star stays readable.
const STAR_FOIL = 0.45;
// Ultimate foils only the border round the art: the template above the bottom
// panel (card height, 0 bottom to 1 top, where the bar under the art ends).
// The rest of the card stays plain.
const FRAME_FOIL_ABOVE = 0.247;

type CardPropType = {
  card: Card;
  /** Picked up by the player: lifted off the board. */
  isSelected?: boolean;
  /** Controlled by another team: tinted. */
  isEnemy?: boolean;
  /** The thin frame around the card (red for an opponent's, green for a teammate's, the owner's seat colour when spectating); none if unset. */
  frameColor?: string;
  /** Its owner's seat colour, worn by its badge. */
  ownerColor?: string;
  /** Which way the card faces on the table (its owner's side), in radians. */
  facing?: number;
  isPreview?: boolean;
  /** Just played from our hand: it flies in from the bottom of the screen, face up, and turns over onto its square. */
  entrance?: boolean;
  /** Called with the card's id: one stable function can serve every card, so memo holds. */
  onSelect?: (cardId: number) => void;
};

// The play-from-hand animation, in seconds: a beat showing the card where the
// hand was, the flight to its square, and the turn onto its back, which starts
// partway through the flight.
const INTRO_HOLD = 0.18;
const INTRO_FLY = 0.55;
const INTRO_SPIN_DELAY = 0.12;
const INTRO_SPIN = 0.5;
const INTRO_END = Math.max(INTRO_HOLD + INTRO_FLY, INTRO_HOLD + INTRO_SPIN_DELAY + INTRO_SPIN);
// Where the card appears: low on screen (NDC y), and how far from the camera,
// as a share of the camera's distance to the board centre (so it looks about hand-sized at any zoom).
const INTRO_SCREEN_Y = -0.55;
const INTRO_DEPTH = 0.5;
// How high it arcs above the board on the way.
const INTRO_ARC = 0.4;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Intro { t: number; from: Vector3; fromQ: Quaternion; to: Vector3; toQ: Quaternion; spin: number; }

const FONT_URL = ASSET_URL + "/fonts/UtopiaStd-Subh.otf";

// The badge on a card's corner: its colour is its owner's seat, its emblem a
// sword for a monster in attack, a shield in defense, a star for a spell or
// trap. It sits on the card's top-right corner as its owner sees it (whatever
// way the card is turned), so every player's badge is in the same place from
// their own seat, and its emblem stands upright for the owner too.
const BADGE_RADIUS = 0.07;
// Where it sits from the card's centre, in its owner's frame (up and to the right),
// and how far above the card.
const BADGE_OFFSET: [number, number, number] = [0.29, 0.38, 0.03];

type Emblem = (ctx: CanvasRenderingContext2D, color: string) => void;

/** Paints one badge: a ringed disc with a white emblem. Drawn once per colour and emblem, shared by every card. */
function badgeTexture(color: string, emblem: Emblem): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (!ctx) return texture;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = "#f4e6c0";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  // A dark outline keeps the white emblem readable on the light seat colours too.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  emblem(ctx, color);
  return texture;
}

function sword(ctx: CanvasRenderingContext2D) {
  // Point up, hilt down.
  ctx.beginPath();
  ctx.moveTo(64, 20);
  ctx.lineTo(73, 34);
  ctx.lineTo(73, 76);
  ctx.lineTo(55, 76);
  ctx.lineTo(55, 34);
  ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.beginPath();
  ctx.rect(42, 76, 44, 9); // crossguard
  ctx.stroke(); ctx.fill();
  ctx.beginPath();
  ctx.rect(59, 85, 10, 16); // grip
  ctx.stroke(); ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 105, 6, 0, Math.PI * 2); // pommel
  ctx.stroke(); ctx.fill();
}

function shield(ctx: CanvasRenderingContext2D, color: string) {
  ctx.beginPath();
  ctx.moveTo(64, 22);
  ctx.quadraticCurveTo(82, 32, 98, 30);
  ctx.quadraticCurveTo(100, 78, 64, 106);
  ctx.quadraticCurveTo(28, 78, 30, 30);
  ctx.quadraticCurveTo(46, 32, 64, 22);
  ctx.closePath();
  ctx.stroke(); ctx.fill();
  // A band down the middle so it reads as a shield, not a blob.
  ctx.fillStyle = color;
  ctx.fillRect(60, 34, 8, 60);
}

function star(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 40 : 17;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = 64 + r * Math.cos(a), y = 66 + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke(); ctx.fill();
}

const EMBLEMS = { attack: sword, defense: shield, spell: star } satisfies Record<string, Emblem>;
type BadgeKind = keyof typeof EMBLEMS;

// Made on first use (the page has a document by then), then shared.
let badgeGeometry: CircleGeometry | null = null;
const badgeMaterials = new Map<string, MeshBasicMaterial>();
function badgeMaterial(color: string, kind: BadgeKind): MeshBasicMaterial {
  const key = `${color}|${kind}`;
  let material = badgeMaterials.get(key);
  if (!material) {
    material = new MeshBasicMaterial({ map: badgeTexture(color, EMBLEMS[kind]), transparent: true, toneMapped: false });
    badgeMaterials.set(key, material);
  }
  return material;
}

/**
 * Loads the ATK/DEF font before the first card needs it: drei's Text suspends
 * on its font, and a card summoned before it arrived would wait for it. Draws
 * nothing; mount it in the board while a duel is on.
 */
export function WarmCardFont() {
  return <Text font={FONT_URL} fontSize={0.001} visible={false}>0123456789</Text>;
}

// Shared by every card: one geometry per shape, not one per mesh per card.
const FACE_GEOMETRY = new PlaneGeometry(0.68, 0.98);
const ART_GEOMETRY = new PlaneGeometry(0.65, 0.7);
const BACK_GEOMETRY = new PlaneGeometry(0.68, 1.06);
const ATTRIBUTE_GEOMETRY = new PlaneGeometry(0.069, 0.069);
const GLOW_GEOMETRY = new PlaneGeometry(1.5, 1.8);
const ENEMY_GEOMETRY = new PlaneGeometry(0.85, 1.25);
// The back is taller than the front, so the frame round it is too.
const FRAME_UP_GEOMETRY = new PlaneGeometry(0.71, 1.01);
const FRAME_DOWN_GEOMETRY = new PlaneGeometry(0.71, 1.09);

// The level stars: a row of `level` stars in one mesh (one draw call, not one per star), made once per level.
const STAR_SIZE = 0.04;
const STAR_SPACING = 0.043;
const starRows = new Map<number, BufferGeometry>();
function starRow(level: number): BufferGeometry {
  let row = starRows.get(level);
  if (!row) {
    const centerOffset = -((level - 1) * STAR_SPACING) / 2 - 0.05;
    const stars = Array.from({ length: level }, (_, i) => new PlaneGeometry(STAR_SIZE, STAR_SIZE).translate(i * STAR_SPACING + centerOffset, 0, 0));
    row = mergeGeometries(stars) ?? stars[0];
    stars.forEach((star) => { if (star !== row) star.dispose(); });
    starRows.set(level, row);
  }
  return row;
}

// The enemy tint. Lit, like before, so it looks the same.
let enemyMaterial: MeshStandardMaterial | null = null;

/**
 * The card back (a brown border, a darker panel and a black oval), painted
 * once into a texture so it is one mesh instead of three. Still a lit
 * material, as the three meshes were, so it looks the same under the scene's light.
 */
let backMaterial: MeshStandardMaterial | null = null;
function cardBack(): MeshStandardMaterial {
  if (backMaterial) return backMaterial;
  // 400 pixels per board unit: the 0.68 x 1.06 back.
  const k = 400, w = 0.68 * k, h = 1.06 * k;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#7e6346";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#513224";
    ctx.fillRect((w - 0.61 * k) / 2, (h - 1 * k) / 2, 0.61 * k, 1 * k);
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 0.2 * 0.6 * k, 0.2 * 1.3 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  backMaterial = new MeshStandardMaterial({ map: texture });
  return backMaterial;
}

// The thin frame round a card, one material per colour.
const frameMaterials = new Map<string, MeshBasicMaterial>();
function frameMaterial(color: string): MeshBasicMaterial {
  let material = frameMaterials.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color, side: DoubleSide, toneMapped: false });
    frameMaterials.set(color, material);
  }
  return material;
}

const noRaycast = () => null;

function YugiohCard({ card, isSelected = false, isEnemy = false, frameColor, ownerColor, facing = 0, isPreview = false, entrance = false, onSelect }: CardPropType) {
  const lowPower = useUIStore((s) => s.lowPower);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const intro = useRef<Intro | null>(null);
  const outerGroup = useRef<Group>(null);
  const innerGroup = useRef<Group>(null);
  const frontRef = useRef<Group>(null);
  const backRef = useRef<Mesh>(null);
  const glowRef = useRef<Mesh>(null);
  // The foiled parts besides the art, whose shader clocks are set each frame.
  const templateRef = useRef<Mesh>(null);
  const starsRef = useRef<Mesh>(null);
  const attributeRef = useRef<Mesh>(null);
  const badgeRef = useRef<Group>(null);
  const holoMeshRef = useRef<Mesh>(null);
  // Each falls back to something drawable if it cannot be loaded, so a card never goes missing (see game/cardTextures.ts).
  const texture = useCardTexture(card.textureUrl, card.textureFallbackUrl ?? MYSTERY_CARD);
  const shineTexture = useCardTexture(ASSET_URL + "/textures/shine_mask_2.png", BLANK_MASK);
  const maskTexture = useCardTexture(card.maskUrl || BLANK_MASK);
  const attributeTexture = useIconTexture(card.attribute?.attributeUrl || BLANK_MASK);
  const cardTemplate = useColorTexture(card.templateUrl, ASSET_URL + "/textures/normalTemplate.png");
  const levelStarTexture = useIconTexture(ASSET_URL + "/textures/levelStar.png");
  const mysteryCardTexture = useCardTexture(MYSTERY_CARD);

  const defaultCardRotation = isPreview ? 0 : facing;

  // The server strips the identity of cards we may not see.
  const isAnonymous = !!card.hidden;
  const isEnemyCard = isEnemy;
  // Shimmer and god rays animate unless battery saver is on, in which case they hold still.
  const foil = FOIL[card.rarity] ?? FOIL.common;
  const shimmering = card.rarity !== 'common' && !lowPower;

  const BASE_CARD_Z = 0.001;
  const MID_CARD_Z = 0.002;
  const OPP_CARD_Z = -0.001;

  // The shimmer redraws the canvas on a shared, capped clock (see game/shimmer.ts).
  useEffect(() => (shimmering ? holdShimmer(invalidate) : undefined), [shimmering, invalidate]);

  // Only the face turned toward the camera is drawn, decided as each frame is drawn (see game/faceCulling.ts).
  const anonymousPreview = isAnonymous && isPreview;
  useEffect(() => {
    const pivot = innerGroup.current;
    if (!pivot || anonymousPreview) return;
    return watchFaces(scene, { pivot, front: frontRef.current, back: backRef.current });
  }, [scene, anonymousPreview]);

  // A layout effect, so the first frame drawn already has the card where it starts.
  useLayoutEffect(() => {
    // Snap to initial state on mount to avoid weird entry spin.
    // Subsequent updates will be handled by useFrame for smooth animation.
    const outer = outerGroup.current;
    const inner = innerGroup.current;
    const targetRotationY = card.isFaceDown ? Math.PI : 0;
    const targetRotationZ = card.isDefenseMode ? defaultCardRotation + Math.PI / 2 : defaultCardRotation;
    if (inner) inner.rotation.y = targetRotationY;
    if (outer) outer.rotation.z = targetRotationZ;

    // Played from the hand: start where the hand was, square to the camera and
    // face up, then fly down to the square (see useFrame).
    const parent = outer?.parent;
    if (!entrance || isPreview || !outer || !inner || !parent || reducedMotion()) return;
    camera.updateMatrixWorld();
    parent.updateWorldMatrix(true, false);
    const eye = camera.getWorldPosition(new Vector3());
    const ray = new Vector3(0, INTRO_SCREEN_Y, 0.5).unproject(camera).sub(eye).normalize();
    const boardCentre = parent.localToWorld(new Vector3(0, 0, 0));
    const world = eye.clone().addScaledVector(ray, eye.distanceTo(boardCentre) * INTRO_DEPTH);
    const from = parent.worldToLocal(world);
    // The camera's orientation, seen from the board: a card turned this way faces the camera, upright on screen.
    const fromQ = parent.getWorldQuaternion(new Quaternion()).invert().multiply(camera.getWorldQuaternion(new Quaternion()));
    intro.current = {
      t: 0,
      from,
      fromQ,
      to: card.position.clone(),
      toQ: new Quaternion().setFromEuler(new Euler(0, 0, targetRotationZ)),
      // Face down: half a turn onto its back. Face up: a full turn, so it still spins.
      spin: card.isFaceDown ? Math.PI : Math.PI * 2,
    };
    outer.position.copy(from);
    outer.quaternion.copy(fromQ);
    inner.rotation.y = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Placed once; after that useFrame glides it. Passing the live position would
  // make React snap the card there (the store builds a new Vector3 every update).
  const [startPosition] = useState(card.position);

  useFrame((state, delta) => {
    const time = shimmering ? state.clock.getElapsedTime() : FROZEN_TIME;
    for (const mesh of [glowRef.current, holoMeshRef.current, templateRef.current, starsRef.current, attributeRef.current]) {
      const uniforms = (mesh?.material as { uniforms?: { time?: { value: number; }; }; } | undefined)?.uniforms;
      if (uniforms?.time) uniforms.time.value = time;
    }
    let moving = false;

    const play = intro.current;
    if (play && outerGroup.current && innerGroup.current) {
      // The play-from-hand animation runs on its own clock and owns the card until it lands.
      play.t += Math.min(delta, 0.05);
      const outer = outerGroup.current;
      const fly = easeInOut(clamp01((play.t - INTRO_HOLD) / INTRO_FLY));
      outer.position.lerpVectors(play.from, play.to, fly);
      outer.position.z += Math.sin(Math.PI * fly) * INTRO_ARC;
      outer.quaternion.slerpQuaternions(play.fromQ, play.toQ, fly);
      innerGroup.current.rotation.y = play.spin * easeInOut(clamp01((play.t - INTRO_HOLD - INTRO_SPIN_DELAY) / INTRO_SPIN));
      if (play.t >= INTRO_END) {
        // Landed: hand back to the easing below, from exactly where it now rests.
        intro.current = null;
        outer.position.copy(play.to);
        outer.rotation.set(0, 0, card.isDefenseMode ? defaultCardRotation + Math.PI / 2 : defaultCardRotation);
        innerGroup.current.rotation.y = card.isFaceDown ? Math.PI : 0;
      }
      moving = true;
    } else if (!isPreview && outerGroup.current && innerGroup.current) {
      const position = outerGroup.current.position as unknown as Record<string, number>;
      const outer = outerGroup.current.rotation as unknown as Record<string, number>;
      const inner = innerGroup.current.rotation as unknown as Record<string, number>;
      // Picked up, the card rises above wherever it stands (high ground included).
      const targetZ = isSelected ? card.position.z + 0.24 : card.position.z;
      const targetRotationZ = card.isDefenseMode ? defaultCardRotation + Math.PI / 2 : defaultCardRotation;
      const targetRotationY = card.isFaceDown ? Math.PI : 0;
      // Every call runs: `|` rather than `||` so none is skipped.
      const easing =
        Number(ease(position, 'x', card.position.x, 0.2, delta)) |
        Number(ease(position, 'y', card.position.y, 0.2, delta)) |
        Number(ease(position, 'z', targetZ, 0.1, delta)) |
        Number(ease(outer, 'z', targetRotationZ, 0.1, delta)) |
        Number(ease(inner, 'y', targetRotationY, 0.1, delta));
      moving = easing === 1;
    }
    // Put the position badge on the owner's top-right corner, upright for the owner:
    // undo the card's own turn (e.g. into defense) but keep its owner's facing.
    // The card only turns about the table's axis once it has landed, so that is
    // its owner's facing less its own local turn. Hidden while the card flies in
    // from the hand, where it faces the camera.
    const badge = badgeRef.current;
    const outer = outerGroup.current;
    if (badge && outer) {
      badge.visible = !intro.current;
      if (badge.visible) badge.rotation.z = defaultCardRotation - outer.rotation.z;
    }
    // The canvas renders on demand: ask for another frame only while something moves.
    if (moving) state.invalidate();
  });

  if (anonymousPreview) {
    return(
      <group rotation={[0, 0, 0]}>
        <mesh position={[0, 0, BASE_CARD_Z]} geometry={FACE_GEOMETRY}>
          <meshBasicMaterial map={mysteryCardTexture} />
        </mesh>
      </group>
    )
  }

  return (
    <group position={startPosition} ref={outerGroup} onClick={(e) => {
      e.stopPropagation();
      // A finger that panned the board and lifted over a card is a drag, not a tap.
      if (e.delta > 10) return;
      onSelect?.(card.id);
    }}>
      {isEnemyCard && !isPreview && (
        <mesh position={[0, 0, OPP_CARD_Z]} geometry={ENEMY_GEOMETRY}
          material={(enemyMaterial ??= new MeshStandardMaterial({ transparent: true, opacity: 0.6, color: "#b45672" }))} />
      )}

      {/* Whose card it is (colour) and how it stands (emblem), on the owner's top-right corner.
          A card hidden from us may be a monster, and its position is public, so it
          shows a sword or shield like one. */}
      {!isPreview && (
        <group ref={badgeRef}>
          <mesh
            position={BADGE_OFFSET}
            geometry={(badgeGeometry ??= new CircleGeometry(BADGE_RADIUS, 32))}
            material={badgeMaterial(ownerColor ?? "#8a8f98", card.attack === -1 && !isAnonymous ? "spell" : card.isDefenseMode ? "defense" : "attack")}
            raycast={noRaycast}
          />
        </group>
      )}

      <group ref={innerGroup}>
        {/* A thin frame (see frameColor), between the front and back faces so it
            turns and flips with the card. The back is taller than the front. */}
        {frameColor && !isPreview && (
          <mesh position={[0, 0, 0]} geometry={card.isFaceDown ? FRAME_DOWN_GEOMETRY : FRAME_UP_GEOMETRY} material={frameMaterial(frameColor)} />
        )}
        {/* Rarity Glow - God Rays Effect */}
        {/* An ultimate rare's aura, while it is on the field. */}
        {foil.aura && !isPreview && (
          <mesh ref={glowRef} position={[0, 0, -0.01]} geometry={GLOW_GEOMETRY} raycast={noRaycast}>
            {/* The time uniform is set each frame in useFrame, through the ref. */}
            <godRaysMaterial
            color={ULTIMATE_AURA}
            time={0}
            alpha={1.0}
            transparent
            depthWrite={false} // Don't write to depth buffer to avoid occlusion issues
            side={DoubleSide}
            />
          </mesh>
        )}

        {/* Back face (classic design), painted into one texture (see cardBack). */}
        <mesh ref={backRef} rotation={[0, Math.PI, 0]} position={[0, 0, -BASE_CARD_Z]} geometry={BACK_GEOMETRY} material={cardBack()} />

        {/* Front Face Logic */}
        <group ref={frontRef}>
        {isAnonymous ? (
          // face-down card belonging to somebody else
          <mesh position={[0, 0, BASE_CARD_Z]} geometry={FACE_GEOMETRY}>
            <meshBasicMaterial map={mysteryCardTexture} />
          </mesh>
        ) : (
          // Detailed player/opponent face-up card (HOLO ADDED HERE)
          <>
            {/* Card Template */}
            <mesh ref={templateRef} position={[0, 0, BASE_CARD_Z]} geometry={FACE_GEOMETRY}>
              {foil.frame
                ? <foilMaterial foilMap={cardTemplate} shineTexture={shineTexture} strength={FRAME_FOIL} above={FRAME_FOIL_ABOVE} cardOffset={[0, 0]} time={0} />
                : <meshBasicMaterial map={cardTemplate} />}
            </mesh>

            {/* --- ARTWORK IMAGE WITH HOLO EFFECT --- */}
            <mesh ref={holoMeshRef} position={[0, 0.1244, MID_CARD_Z]} geometry={ART_GEOMETRY}>
              {
                !foil.art ? (
                  <meshBasicMaterial map={texture} />
                ) : (
                  <baseHolographicMaterial
                    baseTexture={texture}
                    shineTexture={shineTexture}
                    maskTexture={maskTexture}
                    useMask={card.maskUrl ? 1.0 : 0.0}
                    pattern={ART_PATTERN[foil.art]}
                    time={0}
                  />
                )
              }
            </mesh>

            {/* Level: the whole row of stars in one mesh. */}
            {card.level > 0 && (
              <mesh ref={starsRef} position={[0, -0.3, MID_CARD_Z]} geometry={starRow(card.level)}>
                {foil.stars
                  ? <foilMaterial foilMap={levelStarTexture} shineTexture={shineTexture} strength={STAR_FOIL} alphaPremultiplied={1} cardOffset={[0, -0.3]} time={0} transparent premultipliedAlpha />
                  : <meshBasicMaterial map={levelStarTexture} transparent premultipliedAlpha alphaTest={0.01} />}
              </mesh>
            )}
            {
              card.attack !== -1 && (
                <>
                {/* Attribute */}
                <mesh ref={attributeRef} position={[0.249, -0.305, MID_CARD_Z]} geometry={ATTRIBUTE_GEOMETRY}>
                  {foil.attribute
                    ? <foilMaterial foilMap={attributeTexture} shineTexture={shineTexture} alphaPremultiplied={1} cardOffset={[0.249, -0.305]} time={0} transparent premultipliedAlpha />
                    : <meshBasicMaterial map={attributeTexture} transparent premultipliedAlpha alphaTest={0.01} />}
                </mesh>
                <group position={[-0.155, -0.405, MID_CARD_Z]}>
                  <Text
                    fontSize={0.06}
                    color={terrainColor(card.terrainBonus)}
                    anchorX="center"
                    anchorY="middle"
                    font={FONT_URL}
                  >
                    {card.attack}
                  </Text>
                </group>

                <group position={[0.155, -0.405, MID_CARD_Z]}>
                  <Text
                    fontSize={0.06}
                    color={terrainColor(card.terrainBonus)}
                    anchorX="center"
                    anchorY="middle"
                    font={FONT_URL}
                  >
                    {card.defense}
                  </Text>
                </group>
                </>
              )
            }
          </>
        )}
        </group>
      </group>
    </group>
  );
}

// Cards are memoised: the store hands back the same card object while nothing
// about it changed, so moving the cursor re-renders none of them.
export default memo(YugiohCard);
