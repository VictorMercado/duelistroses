import { memo, useRef, useLayoutEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { CanvasTexture, CircleGeometry, Group, DoubleSide, Mesh, MeshBasicMaterial, Euler, Quaternion, SRGBColorSpace, Vector3 } from "three";
import { type Card } from "@/types";
import { ASSET_URL, getGlowColor } from "@/const"
import { useUIStore } from "@/stores/uiStore";
import { ease } from "@/game/motion";
import { terrainColor } from "@/game/terrain";
import { BLANK_MASK, MYSTERY_CARD, useCardTexture } from "@/game/cardTextures";

// Shader time used while battery saver holds the shimmer still.
const FROZEN_TIME = 1.3;

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
  onSelect?: () => void;
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

// Scratch space for turning the badge upright each frame.
const worldTurn = new Quaternion();
const worldEuler = new Euler();

/**
 * Loads the ATK/DEF font before the first card needs it: drei's Text suspends
 * on its font, and a card summoned before it arrived would wait for it. Draws
 * nothing; mount it in the board while a duel is on.
 */
export function WarmCardFont() {
  return <Text font={FONT_URL} fontSize={0.001} visible={false}>0123456789</Text>;
}

function YugiohCard({ card, isSelected = false, isEnemy = false, frameColor, ownerColor, facing = 0, isPreview = false, entrance = false, onSelect }: CardPropType) {
  const lowPower = useUIStore((s) => s.lowPower);
  const camera = useThree((s) => s.camera);
  const intro = useRef<Intro | null>(null);
  const outerGroup = useRef<Group>(null);
  const innerGroup = useRef<Group>(null);
  const glowRef = useRef<Mesh>(null);
  const badgeRef = useRef<Group>(null);
  const holoMeshRef = useRef<Mesh>(null);
  const isSelectedInHand = false;
  // Each falls back to something drawable if it cannot be loaded, so a card never goes missing (see game/cardTextures.ts).
  const texture = useCardTexture(card.textureUrl, card.textureFallbackUrl ?? MYSTERY_CARD);
  const shineTexture = useCardTexture(ASSET_URL + "/textures/shine_mask_2.png", BLANK_MASK);
  const maskTexture = useCardTexture(card.maskUrl || BLANK_MASK);
  const attributeTexture = useCardTexture(card.attribute?.attributeUrl || BLANK_MASK);
  const cardTemplate = useCardTexture(card.templateUrl, ASSET_URL + "/textures/normalTemplate.png");
  const levelStarTexture = useCardTexture(ASSET_URL + "/textures/levelStar.png");
  const mysteryCardTexture = useCardTexture(MYSTERY_CARD);

  // Setting textures to repeat/wrap is usually good for holo patterns, 
  // though 512x512 fits the card well by default.
  // shineTexture.wrapS = shineTexture.wrapT = THREE.RepeatWrapping;

  const defaultCardRotation = isPreview ? 0 : facing;

  // The server strips the identity of cards we may not see.
  const isAnonymous = !!card.hidden;
  const isEnemyCard = isEnemy;

  const BASE_CARD_Z = 0.001;
  const MID_CARD_Z = 0.002;
  const TOP_CARD_Z = 0.003;
  const OPP_CARD_Z = -0.001;

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
    // Shimmer and god rays animate unless battery saver is on, in which case they hold still.
    const shimmer = card.rarity !== 'common';
    const time = shimmer && !lowPower ? state.clock.getElapsedTime() : FROZEN_TIME;
    for (const mesh of [glowRef.current, holoMeshRef.current]) {
      const uniforms = (mesh?.material as { uniforms?: { time?: { value: number; }; }; } | undefined)?.uniforms;
      if (uniforms?.time) uniforms.time.value = time;
    }
    let moving = shimmer && !lowPower;

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
      moving ||= easing === 1;
    }
    // Put the position badge on the owner's top-right corner, upright for the owner:
    // undo the card's own turn (e.g. into defense) but keep its owner's facing. Hidden while the card flies in from the hand, where it faces the camera.
    const badge = badgeRef.current;
    const outer = outerGroup.current;
    if (badge && outer) {
      badge.visible = !intro.current;
      const cardTurn = worldEuler.setFromQuaternion(outer.getWorldQuaternion(worldTurn)).z;
      const boardTurn = outer.parent ? worldEuler.setFromQuaternion(outer.parent.getWorldQuaternion(worldTurn)).z : 0;
      const ownerTurn = boardTurn + defaultCardRotation;
      badge.rotation.z = ownerTurn - cardTurn;
    }
    // The canvas renders on demand: ask for another frame only while something moves.
    if (moving) state.invalidate();
  });
  
  if (isAnonymous && isPreview)  {
    return(
      <group rotation={[0, 0, 0]}>
        <mesh position={[0, 0, BASE_CARD_Z]}>
          <planeGeometry args={[0.68, 0.98]} />
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
      onSelect?.();
    }}>
      {isEnemyCard && !isPreview && (
        <mesh position={[0, 0, OPP_CARD_Z]}>
          <planeGeometry args={[0.85, 1.25]} />
          <meshStandardMaterial transparent opacity={0.6} color="#b45672" />
        </mesh>
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
            raycast={() => null}
          />
        </group>
      )}

      {/* SELECTION BORDER */}
      {isSelectedInHand && (
         <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[0.74, 1.04]} />
          <meshBasicMaterial color="#0044aa" side={DoubleSide} />
        </mesh>
      )}
      <group ref={innerGroup}>
        {/* A thin frame (see frameColor), between the front and back faces so it
            turns and flips with the card. The back is taller than the front. */}
        {frameColor && !isPreview && (
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={card.isFaceDown ? [0.71, 1.09] : [0.71, 1.01]} />
            <meshBasicMaterial color={frameColor} side={DoubleSide} toneMapped={false} />
          </mesh>
        )}
        {/* Rarity Glow - God Rays Effect */}
        {(card.rarity === 'ultimate' || card.rarity === 'starlight') && (
          <mesh ref={glowRef} position={[0, 0, -0.01]}>
            {/* Larger plane for rays to extend */}
            <planeGeometry args={[1.5, 1.8]} />
            <godRaysMaterial 
            color={getGlowColor(card.rarity)}
            time={0} // Will be updated by useFrame if we pass a ref, or we can just let R3F handle it?
                      // Better to use a ref to the material and update time in useFrame for performance
                      // OR just pass state.clock.elapsedTime as a prop, but that causes re-renders.
                      // Let's use the ref approach.
            alpha={1.0}
            transparent
            depthWrite={false} // Don't write to depth buffer to avoid occlusion issues
            side={DoubleSide}
            />
          </mesh>
        )}

       {/* Back Face (Classic Design) */}
        <group rotation={[0, Math.PI, 0]}>
          <mesh position={[0, 0, BASE_CARD_Z]}>
            <planeGeometry args={[0.68, 1.06]} />
            <meshStandardMaterial color="#7e6346" />
          </mesh>
          <mesh position={[0, 0, MID_CARD_Z]}>
            <planeGeometry args={[0.61, 1]} />
            <meshStandardMaterial color="#513224" />
          </mesh>
          <mesh position={[0, 0, TOP_CARD_Z]} scale={[0.6, 1.3, 1]}>
            <circleGeometry args={[0.2, 32]} />
            <meshStandardMaterial color="black" />
          </mesh>
        </group>

        {/* Front Face Logic */}
        {isAnonymous ? (
          // face-down card belonging to somebody else
          <group rotation={[0, 0, 0]}>
            <mesh position={[0, 0, BASE_CARD_Z]}>
              <planeGeometry args={[0.68, 0.98]} />
              <meshBasicMaterial map={mysteryCardTexture} />
            </mesh>
          </group>
        ) : (
          // Detailed player/opponent face-up card (HOLO ADDED HERE)
          <group rotation={[0, 0, 0]}>
            {/* Card Template */}
            <mesh position={[0, 0, BASE_CARD_Z]}>
              <planeGeometry args={[0.68, 0.98]} />
              <meshBasicMaterial map={cardTemplate} />
            </mesh>

            {/* --- ARTWORK IMAGE WITH HOLO EFFECT --- */}
            <mesh ref={holoMeshRef} position={[0, 0.1244, MID_CARD_Z]}>
              <planeGeometry args={[0.65, 0.7]} />
              {/* Replaced meshBasicMaterial with custom shader */}
              {
                card.rarity === "common" ? (
                  <meshBasicMaterial map={texture} />
                ) : (
                  <baseHolographicMaterial
                    baseTexture={texture}
                    shineTexture={shineTexture}
                    maskTexture={maskTexture}
                    useMask={card.maskUrl ? 1.0 : 0.0}
                    time={0}
                  />
                )
              }
            </mesh>

            {/* Level */}
            {
              Array.from({ length: card.level }, (_, index) => {
                const starSpacing = 0.043;
                const totalWidth = (card.level - 1) * starSpacing;
                const centerOffset = -(totalWidth / 2) - 0.05;
                const xPosition = (index * starSpacing) + centerOffset;
                
                return (
                  <mesh key={index} position={[xPosition, -0.3, MID_CARD_Z]}>
                    <planeGeometry args={[0.04, 0.040]} />
                    <meshBasicMaterial map={levelStarTexture} alphaTest={0.01}/>
                  </mesh>
                );
              })
            }
            {
              card.attack !== -1 && (
                <>
                {/* Attribute */}
                <mesh position={[0.249, -0.305, MID_CARD_Z]}>
                  <planeGeometry args={[0.069, 0.069]} />
                  <meshBasicMaterial map={attributeTexture} alphaTest={0.01}/>
                </mesh>
                <mesh position={[-0.155, -0.405, MID_CARD_Z]}>
                  <Text
                    fontSize={0.06}
                    color={terrainColor(card.terrainBonus)}
                    anchorX="center"
                    anchorY="middle"
                    font={FONT_URL}
                  >
                    {card.attack}
                  </Text>
                </mesh>

                <mesh position={[0.155, -0.405, MID_CARD_Z]}>
                  <Text
                    fontSize={0.06}
                    color={terrainColor(card.terrainBonus)}
                    anchorX="center"
                    anchorY="middle"
                    font={FONT_URL}
                  >
                    {card.defense}
                  </Text>
                </mesh>
                </>
              )
            }
          </group>
        )}
      </group>
    </group>
  );
}

// Cards are memoised: the store hands back the same card object while nothing
// about it changed, so moving the cursor re-renders none of them.
export default memo(YugiohCard);
