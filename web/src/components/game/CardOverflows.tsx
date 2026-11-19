import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicMaterial,
  PlaneGeometry, ShaderMaterial, Vector3,
} from "three";
import YugiohCard from "./YugiohCard";
import { previewRenderCard } from "@/game/catalog";
import { MYSTERY_CARD, useCardTexture } from "@/game/cardTextures";
import { ASSET_URL } from "@/const";
import { useGameStore } from "@/stores/gameStore";
import { useFusionStore } from "@/stores/fusionStore";
import { useUIStore } from "@/stores/uiStore";

// The card's face, in board units (see YugiohCard).
const CARD_W = 0.68;
const CARD_H = 0.98;
// Where the artwork sits on the face, as uv (x0, y0, x1, y1): a 0.65 × 0.7 plane raised 0.1244.
const ART_RECT = [
  (CARD_W - 0.65) / 2 / CARD_W,
  (CARD_H / 2 + 0.1244 - 0.35) / CARD_H,
  1 - (CARD_W - 0.65) / 2 / CARD_W,
  (CARD_H / 2 + 0.1244 + 0.35) / CARD_H,
];
const PLANE = new PlaneGeometry(1, 1);

// Timeline, in seconds: the card slams down, spins up, then tears and comes apart.
const DROP = 0.22;
const SPIN_END = 0.95;
const TURNS = 2.2;
const SPIN_DECAY = 4; // how fast the spin dies away once it has torn
const LIFE = 0.75; // how long a pixel lasts once torn off
const RIP_LENGTH = 1.25; // until the last pixel has torn off
const END = SPIN_END + RIP_LENGTH + LIFE;
const REST_Z = 0.11;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// Every pixel is drawn by the GPU from its own few numbers, so a card's worth costs one draw call.
const VERTEX = /* glsl */ `
  attribute vec2 aHome;
  attribute vec2 aUv;
  attribute float aSide;
  attribute float aDelay;
  attribute vec3 aVel;
  attribute float aSpin;
  attribute float aEdge;
  uniform float uTime;
  uniform vec2 uCell;
  uniform vec2 uCellUv;
  varying vec2 vUv;
  varying float vLife;
  varying float vEdge;

  void main() {
    float t = max(uTime, 0.0);
    // The two halves pull apart along the tear, slowly, then the pixels go.
    float pull = smoothstep(0.0, 0.3, t) * 0.035 + t * 0.03;
    vec3 p = vec3(aHome, 0.0);
    p.x += aSide * pull;
    float lt = max(t - aDelay, 0.0);
    vLife = clamp(lt / ${LIFE.toFixed(2)}, 0.0, 1.0);
    // Torn off: flung out with drag, tumbling, shrinking to nothing.
    float flight = (1.0 - exp(-2.6 * lt)) / 2.6;
    p += aVel * flight;
    p.z += 0.4 * lt * lt * step(0.0, lt);
    float angle = aSpin * lt;
    float size = 1.0 - smoothstep(0.35, 1.0, vLife);
    vec2 corner = position.xy * uCell * size;
    corner.x *= mix(1.0, abs(cos(angle * 0.7)) * 0.8 + 0.2, step(0.0001, lt)); // a flat chip turning over
    float c = cos(angle), s = sin(angle);
    p.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
    vUv = aUv + uv * uCellUv;
    vEdge = aEdge * smoothstep(0.0, 0.12, t);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uTemplate;
  uniform sampler2D uArt;
  uniform vec4 uArtRect;
  uniform float uMystery;
  varying vec2 vUv;
  varying float vLife;
  varying float vEdge;

  void main() {
    vec2 artUv = (vUv - uArtRect.xy) / (uArtRect.zw - uArtRect.xy);
    bool inArt = uMystery < 0.5 && all(greaterThanEqual(artUv, vec2(0.0))) && all(lessThanEqual(artUv, vec2(1.0)));
    vec3 color = inArt ? texture2D(uArt, artUv).rgb : texture2D(uTemplate, vUv).rgb;
    // The tear glows white-hot; torn pixels flare to embers, then char.
    color = mix(color, vec3(1.0, 0.92, 0.75), vEdge * (1.0 - vLife) * 0.85);
    color = mix(color, vec3(1.0, 0.42, 0.12), smoothstep(0.0, 0.45, vLife) * 0.75);
    color = mix(color, vec3(0.12, 0.02, 0.02), smoothstep(0.45, 1.0, vLife) * 0.7);
    float alpha = 1.0 - smoothstep(0.65, 1.0, vLife);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Pseudo-random in [0, 1), the same for the same inputs. */
function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The card's face cut into a grid of pixels, each with where it sits, when it tears off and where it flies. */
function pixelGeometry(cols: number, rows: number, seed: number): InstancedBufferGeometry {
  const n = cols * rows;
  const home = new Float32Array(n * 2), uv = new Float32Array(n * 2), side = new Float32Array(n);
  const delay = new Float32Array(n), vel = new Float32Array(n * 3), spin = new Float32Array(n), edge = new Float32Array(n);
  const cw = CARD_W / cols, ch = CARD_H / rows;
  // A jagged tear down the middle, a little different every time.
  const tearX = (y: number) => 0.045 * Math.sin(y * 21 + seed * 7) + 0.022 * Math.sin(y * 57 + seed * 3) + 0.012 * Math.sin(y * 131);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const x = -CARD_W / 2 + (col + 0.5) * cw;
      const y = -CARD_H / 2 + (row + 0.5) * ch;
      const r = (k: number) => hash(i * 13.37 + k * 7.1 + seed);
      const dx = x - tearX(y);
      const d = Math.abs(dx);
      home.set([x, y], i * 2);
      uv.set([col / cols, row / rows], i * 2);
      side[i] = dx < 0 ? -1 : 1;
      edge[i] = d < cw * 1.6 ? 1 : 0;
      // The tear runs from the top down, and the pixels go from the tear outwards.
      delay[i] = 0.18 + d * 1.25 + (CARD_H / 2 - y) * 0.28 + r(1) * 0.18;
      const out = 0.35 + r(2) * 0.7;
      vel.set([side[i] * out + (r(3) - 0.5) * 0.25, y * 0.6 + (r(4) - 0.5) * 0.5, 0.25 + r(5) * 0.6], i * 3);
      spin[i] = (r(6) < 0.5 ? -1 : 1) * (5 + r(7) * 10);
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.index = PLANE.index;
  geometry.setAttribute("position", PLANE.getAttribute("position"));
  geometry.setAttribute("uv", PLANE.getAttribute("uv"));
  geometry.setAttribute("aHome", new InstancedBufferAttribute(home, 2));
  geometry.setAttribute("aUv", new InstancedBufferAttribute(uv, 2));
  geometry.setAttribute("aSide", new InstancedBufferAttribute(side, 1));
  geometry.setAttribute("aDelay", new InstancedBufferAttribute(delay, 1));
  geometry.setAttribute("aVel", new InstancedBufferAttribute(vel, 3));
  geometry.setAttribute("aSpin", new InstancedBufferAttribute(spin, 1));
  geometry.setAttribute("aEdge", new InstancedBufferAttribute(edge, 1));
  geometry.instanceCount = n;
  return geometry;
}

function Pixels({ textureUrl, fallbackUrl, templateUrl, mystery, cols, rows, seed, material }: {
  textureUrl: string; fallbackUrl?: string; templateUrl: string; mystery: boolean; cols: number; rows: number; seed: number;
  material: (m: ShaderMaterial | null) => void;
}) {
  const art = useCardTexture(textureUrl, fallbackUrl ?? MYSTERY_CARD);
  const template = useCardTexture(mystery ? MYSTERY_CARD : templateUrl, ASSET_URL + "/textures/normalTemplate.png");
  const geometry = useMemo(() => pixelGeometry(cols, rows, seed), [cols, rows, seed]);
  const shader = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: -1 },
      uCell: { value: [CARD_W / cols, CARD_H / rows] },
      uCellUv: { value: [1 / cols, 1 / rows] },
      uTemplate: { value: template },
      uArt: { value: art },
      uArtRect: { value: ART_RECT },
      uMystery: { value: mystery ? 1 : 0 },
    },
  }), [cols, rows, template, art, mystery]);
  useEffect(() => () => { geometry.dispose(); shader.dispose(); }, [geometry, shader]);
  useEffect(() => { material(shader); return () => material(null); }, [shader, material]);
  return <mesh geometry={geometry} material={shader} frustumCulled={false} raycast={() => null} />;
}

/**
 * A card torn apart where it ended up. `from`: a monster crushed by crush
 * terrain walked there, so it slides in from the square it left rather than
 * slamming down from above.
 */
interface Overflow { key: string; num?: number; x: number; y: number; seat: number; from?: { x: number; y: number; }; }

/** One card with no room on the field: it spins, tears, and comes apart pixel by pixel. */
function OverflowEffect({ overflow, facing, isEnemy, onDone }: { overflow: Overflow; facing: number; isEnemy: boolean; onDone: () => void; }) {
  const lowPower = useUIStore((s) => s.lowPower);
  const spin = useRef<Group>(null);
  const cardGroup = useRef<Group>(null);
  const pixelGroup = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const pixels = useRef<ShaderMaterial | null>(null);
  const t = useRef(0);
  const done = useRef(false);

  const card = useMemo(() => {
    const preview = previewRenderCard(overflow.num ?? -1);
    return { ...preview, isFaceDown: false, position: new Vector3(0, 0, 0) };
  }, [overflow.num]);
  const mystery = overflow.num === undefined;
  // Each tear is jagged its own way, the same on every render.
  const seed = useMemo(() => hash([...overflow.key].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7) % 9973) * 100, [overflow.key]);
  const setPixels = useMemo(() => (m: ShaderMaterial | null) => { pixels.current = m; }, []);

  useFrame((state, delta) => {
    if (done.current) return;
    t.current += Math.min(delta, 0.05);
    const time = t.current;

    // Spin: winds up through the drop and the spin, then dies away while it tears.
    const omega = (2 * Math.PI * TURNS * 2) / (SPIN_END - DROP);
    let angle: number;
    if (time < DROP) angle = 0;
    else if (time < SPIN_END) angle = 2 * Math.PI * TURNS * Math.pow((time - DROP) / (SPIN_END - DROP), 2);
    else angle = 2 * Math.PI * TURNS + (omega / SPIN_DECAY) * (1 - Math.exp(-SPIN_DECAY * (time - SPIN_END)));

    if (spin.current) {
      spin.current.rotation.z = angle;
      const drop = easeOut(clamp01(time / DROP));
      const rise = 0.18 * clamp01((time - DROP) / (SPIN_END - DROP));
      const from = overflow.from;
      spin.current.position.z = REST_Z + (from ? 0 : 0.6 * (1 - drop)) + rise;
      // Walking onto crush terrain: the rest of its step, from the square it left.
      const left = from ? 1 - drop : 0;
      // A shudder as it winds up, just before it gives.
      const shake = 0.012 * clamp01((time - SPIN_END + 0.35) / 0.35) * (time < SPIN_END ? 1 : 0);
      spin.current.position.x = shake * Math.sin(time * 90) + (from ? (from.x - overflow.x) * left : 0);
      spin.current.position.y = shake * Math.cos(time * 77) + (from ? (from.y - overflow.y) * left : 0);
    }

    const torn = time >= SPIN_END;
    if (cardGroup.current) cardGroup.current.visible = !torn;
    if (pixelGroup.current) pixelGroup.current.visible = torn;
    if (pixels.current) pixels.current.uniforms.uTime.value = time - SPIN_END;

    // A red glow underneath, pulsing faster as it spins up, gone once it tears.
    if (halo.current) {
      const glow = clamp01((time - DROP) / 0.3) * (1 - clamp01((time - SPIN_END) / 0.4));
      const pulse = 0.7 + 0.3 * Math.sin(time * (10 + 30 * clamp01(time / SPIN_END)));
      (halo.current.material as MeshBasicMaterial).opacity = 0.55 * glow * pulse;
      const grow = 1.15 + 0.35 * clamp01((time - SPIN_END) / 0.4);
      halo.current.scale.set(CARD_W * grow, CARD_W * grow, 1);
    }

    if (time >= END) { done.current = true; onDone(); return; }
    state.invalidate(); // the board renders on demand: keep frames coming
  });

  return (
    <group position={[overflow.x, overflow.y, 0]}>
      <mesh ref={halo} geometry={PLANE} position={[0, 0, REST_Z - 0.01]} raycast={() => null}>
        <meshBasicMaterial color="#ff3a2a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <group ref={spin} position={[0, 0, REST_Z + 0.6]}>
        <group ref={cardGroup}>
          <Suspense fallback={null}>
            <YugiohCard card={card} facing={facing} isEnemy={isEnemy} />
          </Suspense>
        </group>
        <group ref={pixelGroup} rotation={[0, 0, facing]} visible={false}>
          <Suspense fallback={null}>
            <Pixels
              textureUrl={card.textureUrl}
              fallbackUrl={card.textureFallbackUrl}
              templateUrl={card.templateUrl}
              mystery={mystery}
              cols={lowPower ? 16 : 24}
              rows={lowPower ? 23 : 35}
              seed={seed}
              material={setPixels}
            />
          </Suspense>
        </group>
      </group>
    </group>
  );
}

/**
 * A card played with no room for it on the field (5 monsters, or 5 spells
 * and traps) lands and is destroyed at once; a strong monster that walks (or
 * is summoned) onto crush terrain is crushed. The server has already taken it
 * off the board, so this plays a stand-in tearing apart where it landed. It
 * waits for a fusion chain to finish playing back first.
 */
export default function CardOverflows({ facingFor, isEnemy }: { facingFor: (seat: number) => number; isEnemy: (seat: number) => boolean; }) {
  const [overflows, setOverflows] = useState<Overflow[]>([]);

  useEffect(() => {
    // Overflows held back while a fusion chain plays, and the watch for its end.
    let held: Overflow[] = [];
    let stopWaiting: (() => void) | undefined;
    const release = () => {
      stopWaiting?.();
      stopWaiting = undefined;
      const ready = held;
      held = [];
      setOverflows((current) => [...current, ...ready]);
    };
    const stop = useGameStore.subscribe((state, previous) => {
      if (state.eventSeq === previous.eventSeq) return;
      const fresh = state.lastEvents
        .filter((e) => e.type === "destroyed" && (e.text === "overflow" || e.text === "crushed"))
        .map((e, i) => {
          // A crushed monster that was standing elsewhere walked onto the crush terrain.
          const was = e.text === "crushed" ? previous.view?.cards.find((c) => c.id === e.cardId) : undefined;
          const from = was && (was.x !== e.x || was.y !== e.y) ? { x: was.x, y: was.y } : undefined;
          return { key: `${state.eventSeq}:${i}`, num: e.num, x: e.x, y: e.y, seat: e.seat, from };
        });
      if (!fresh.length) return;
      held.push(...fresh);
      if (!useFusionStore.getState().queue.length) { release(); return; }
      stopWaiting ??= useFusionStore.subscribe((s) => { if (!s.queue.length) release(); });
    });
    return () => { stop(); stopWaiting?.(); };
  }, []);

  return (
    <>
      {overflows.map((overflow) => (
        <OverflowEffect
          key={overflow.key}
          overflow={overflow}
          facing={facingFor(overflow.seat)}
          isEnemy={isEnemy(overflow.seat)}
          onDone={() => setOverflows((current) => current.filter((o) => o.key !== overflow.key))}
        />
      ))}
    </>
  );
}
