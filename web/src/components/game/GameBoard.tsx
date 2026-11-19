import { Component, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Group, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, Path, PlaneGeometry, RepeatWrapping, Shape, ShapeGeometry, SRGBColorSpace, Vector2, Vector3, type Texture } from "three";
import YugiohCard, { WarmCardFont } from "./YugiohCard";
import SpellCasts from "./SpellCasts";
import CardOverflows from "./CardOverflows";
import RitualRites from "./RitualRites";
import { useRitualStore } from "@/stores/ritualStore";
import Lightning from "./Lightning";
import DarkHole from "./DarkHole";
import Exodia from "./Exodia";
import LeaderStrikes, { STRIKE_TRAVEL } from "./LeaderStrikes";
import { useFusionStore } from "@/stores/fusionStore";
import { ASSET_URL, SEAT_COLORS } from "@/const";
import { selectPerspective, useGameStore } from "@/stores/gameStore";
import { useUIStore } from "@/stores/uiStore";
import { useMenuStore } from "@/stores/menuStore";
import { pointTile, selectionOf, useInteraction } from "@/game/interaction";
import type { GameView, Pos, Selection } from "@/net/protocol";
import { ease } from "@/game/motion";
import { BOARD_ROTATION, displayRotation } from "@/game/orientation";
import { cardArt, catalogCard } from "@/game/catalog";
import { FOREST_TREE_HEIGHT, LABYRINTH_WALL_HEIGHT, liftAt, MOUNTAIN_HEIGHT, TOON_BOOK_HEIGHT } from "@/game/terrain";

const TERRAINS = ["normal", "sogen", "forest", "wasteland", "mountain", "umi", "yami", "toon", "crush", "labyrinth"];
// The labyrinth, toon and forest squares are built in 3D from their own atlases (see labyrinthGeometry,
// toonGeometry, forestGeometry); their plain PNGs stay the flat pictures used in menus and the builder.
const BUILT_3D = ["labyrinth", "toon", "forest"];
const TERRAIN_URLS = Object.fromEntries(TERRAINS.map((name) => [name, `${ASSET_URL}/terrains/${BUILT_3D.includes(name) ? `${name}_3d` : name}.png`]));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const EMBLEMS = [ASSET_URL + "/textures/Red_Rose_Emblem.png", ASSET_URL + "/textures/White_Rose_Emblem.png"];

const GUARD_RETRIES = 4;
const GUARD_RETRY_MS = 1000; // doubled each time

/**
 * Keeps a card that fails to draw from taking the whole scene down with it.
 * Its textures never fail (they fall back, see game/cardTextures.ts), so this
 * is for anything else (the font, say): the card is tried again shortly,
 * rather than left missing for the rest of the duel.
 */
class CardGuard extends Component<{ children: ReactNode; }, { failed: boolean; }> {
  state = { failed: false };
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.warn("card failed to draw", error);
    if (this.retries >= GUARD_RETRIES) return;
    this.timer = setTimeout(() => this.setState({ failed: false }), GUARD_RETRY_MS * 2 ** this.retries++);
  }
  componentWillUnmount() { if (this.timer) clearTimeout(this.timer); }
  render() { return this.state.failed ? null : this.props.children; }
}

// One geometry for every flat square on the board.
const SQUARE = new PlaneGeometry(1, 1);
// A square outline one unit across, its band LEADER_FRAME wide: the seat-coloured frame round a deck leader.
const LEADER_FRAME = 0.06;
const FRAME = (() => {
  const h = 0.5, i = 0.5 - LEADER_FRAME;
  const outer = new Shape([new Vector2(-h, -h), new Vector2(h, -h), new Vector2(h, h), new Vector2(-h, h)]);
  outer.holes.push(new Path([new Vector2(-i, -i), new Vector2(-i, i), new Vector2(i, i), new Vector2(i, -i)]));
  return new ShapeGeometry(outer);
})();

// The mountain is drawn in relief: its artwork doubles as a height map
// (brighter is higher). Vertices per side of the mesh, shared by every mountain square.
const RELIEF_SEGMENTS = 64;
// Where the light comes from when shading the slopes (upper left, toward the viewer).
const RELIEF_LIGHT = new Vector3(-0.45, 0.55, 0.7).normalize();

/**
 * Builds the mountain's mesh from its picture: each vertex rises with the
 * brightness under it, and sinks back to the board at the edges so the
 * square meets its neighbours without a gap. Slopes are shaded into vertex
 * colours, so the material can stay unlit like the rest of the board.
 */
function reliefGeometry(image: CanvasImageSource): PlaneGeometry {
  const n = RELIEF_SEGMENTS + 1;
  const geometry = new PlaneGeometry(1, 1, RELIEF_SEGMENTS, RELIEF_SEGMENTS);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return geometry;
  // Drawing it this small also smooths the paint strokes out of the heights.
  ctx.imageSmoothingQuality = "high";
  let pixels: Uint8ClampedArray;
  try {
    ctx.drawImage(image, 0, 0, n, n);
    pixels = ctx.getImageData(0, 0, n, n).data;
  } catch {
    return geometry; // an image the page may not read (no CORS): stay flat
  }

  const brightness = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n * n; i++) {
    const v = 0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2];
    brightness[i] = v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }

  // PlaneGeometry lays its vertices out row by row from the top, like the image.
  const position = geometry.attributes.position;
  const edge = (t: number) => {
    const d = Math.min(t, 1 - t) / 0.12; // the outer 12% eases down to the board
    return d >= 1 ? 1 : d * d * (3 - 2 * d);
  };
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const h = (brightness[i] - min) / Math.max(1, max - min);
      position.setZ(i, h * MOUNTAIN_HEIGHT * edge(col / (n - 1)) * edge(row / (n - 1)));
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const normals = geometry.attributes.normal;
  const colors = new Float32Array(n * n * 3);
  const normal = new Vector3();
  for (let i = 0; i < n * n; i++) {
    normal.fromBufferAttribute(normals, i);
    const shade = Math.min(1.15, 0.55 + 0.6 * Math.max(0, normal.dot(RELIEF_LIGHT)));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Collects the faces of a small solid built by hand (a terrain's 3D props).
 * Each face is shaded by how it turns toward RELIEF_LIGHT, baked into vertex
 * colours so the material can stay unlit like the rest of the board.
 */
class Solid {
  private positions: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private normal = new Vector3();
  private ab = new Vector3();
  private ac = new Vector3();

  /** A quad with corners in counter-clockwise order seen from outside; lit=false keeps it at full brightness. */
  quad(corners: number[][], uv: number[][], lit = true) {
    let shade = 1;
    if (lit) {
      const [a, b, c] = corners;
      this.ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      this.ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      this.normal.crossVectors(this.ab, this.ac).normalize();
      shade = Math.min(1.15, 0.55 + 0.6 * Math.max(0, this.normal.dot(RELIEF_LIGHT)));
    }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(...corners[i]);
      this.uvs.push(...uv[i]);
      this.colors.push(shade, shade, shade);
    }
  }

  /** The square's ground, filling the atlas rectangle u0..u1, v0..v1. */
  floor(u0: number, v0: number, u1: number, v1: number) {
    this.quad([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], false);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

// The labyrinth square: a walled ring around the emblem, with a wall running
// from the middle of each side out to the edge, so neighbouring labyrinth
// squares join into one maze. Half-width of the ring, and wall thickness.
const LABYRINTH_RING = 0.3;
const LABYRINTH_WALL = 0.07;

/**
 * Builds the labyrinth's mesh. Its texture (labyrinth_3d.png) is an atlas:
 * the left half is the floor seen from above, the right half the wall stone.
 */
function labyrinthGeometry(): BufferGeometry {
  const solid = new Solid();
  const h = LABYRINTH_WALL_HEIGHT;
  // Inset from the seam so mipmapping never bleeds one half into the other.
  const wallU = (t: number) => 0.505 + 0.49 * (t + 0.5);
  // Sides show a band of brick about as tall as the wall would be at this scale.
  const wallV = (z: number) => 0.3 + (z / h) * 0.25;

  solid.floor(0.005, 0, 0.495, 1);

  // One wall block from (x0, y0) to (x1, y1): its top and four sides.
  const block = (x0: number, y0: number, x1: number, y1: number) => {
    // Top, textured as if the stone were seen from above, continuous across blocks.
    solid.quad([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]],
      [[wallU(x0), y0 + 0.5], [wallU(x1), y0 + 0.5], [wallU(x1), y1 + 0.5], [wallU(x0), y1 + 0.5]]);
    // Sides, with the brick courses running along the wall.
    solid.quad([[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]], [[wallU(x0), wallV(0)], [wallU(x1), wallV(0)], [wallU(x1), wallV(h)], [wallU(x0), wallV(h)]]); // -y
    solid.quad([[x1, y1, 0], [x0, y1, 0], [x0, y1, h], [x1, y1, h]], [[wallU(x1), wallV(0)], [wallU(x0), wallV(0)], [wallU(x0), wallV(h)], [wallU(x1), wallV(h)]]); // +y
    solid.quad([[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], [[wallU(y0), wallV(0)], [wallU(y1), wallV(0)], [wallU(y1), wallV(h)], [wallU(y0), wallV(h)]]); // +x
    solid.quad([[x0, y1, 0], [x0, y0, 0], [x0, y0, h], [x0, y1, h]], [[wallU(y1), wallV(0)], [wallU(y0), wallV(0)], [wallU(y0), wallV(h)], [wallU(y1), wallV(h)]]); // -x
  };

  const r = LABYRINTH_RING, t = LABYRINTH_WALL, s = t / 2;
  // The ring.
  block(-r, r - t, r, r);
  block(-r, -r, r, -r + t);
  block(-r, -r + t, -r + t, r - t);
  block(r - t, -r + t, r, r - t);
  // The spurs out to the middle of each edge.
  block(-s, r, s, 0.5);
  block(-s, -0.5, s, -r);
  block(r, -s, 0.5, s);
  block(-0.5, -s, -r, s);
  return solid.build();
}

// The toon square: an open Toon World book lying on a rainbow floor.
// Half-size of the page spread (the two pages together are square), how far
// the cover reaches past the pages, and the cover's thickness.
const BOOK_HALF = 0.32;
const BOOK_COVER_LIP = 0.025;
const BOOK_COVER = 0.014;
// Strips across each page, for the curve from the spine to the outer edge.
const BOOK_STRIPS = 8;

/** Height of the page surface at t (0 at the spine, 1 at the outer edge): it dips into the gutter and levels out. */
function pageHeight(t: number): number {
  return BOOK_COVER + 0.022 + (TOON_BOOK_HEIGHT - BOOK_COVER - 0.022) * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2);
}

/**
 * Builds the toon mesh. Its texture (toon_3d.png, the old Toon World sprite)
 * is an atlas: the left half holds the two pages, the top right quarter the
 * page block seen end-on, the band under it the page edges, and the bottom
 * right the purple cover beside the rainbow floor.
 */
function toonGeometry(): BufferGeometry {
  const solid = new Solid();
  const w = BOOK_HALF, c = BOOK_COVER, top = TOON_BOOK_HEIGHT;

  // The rainbow floor (bottom right eighth of the atlas), inset from its edges.
  solid.floor(0.755, 0.01, 0.995, 0.49);

  // The cover: a thin purple slab a little larger than the pages. Its whole
  // surface samples one plain patch of the cover art, so it reads as cloth.
  const coverUV = [[0.505, 0.15], [0.53, 0.15], [0.53, 0.35], [0.505, 0.35]];
  const k = w + BOOK_COVER_LIP;
  solid.quad([[-k, -k, c], [k, -k, c], [k, k, c], [-k, k, c]], coverUV);
  solid.quad([[-k, -k, 0], [k, -k, 0], [k, -k, c], [-k, -k, c]], coverUV);
  solid.quad([[k, k, 0], [-k, k, 0], [-k, k, c], [k, k, c]], coverUV);
  solid.quad([[k, -k, 0], [k, k, 0], [k, k, c], [k, -k, c]], coverUV);
  solid.quad([[-k, k, 0], [-k, -k, 0], [-k, -k, c], [-k, k, c]], coverUV);

  // Page edges seen end-on (top right quarter), and from the side (the band below).
  const endU = (x: number) => 0.505 + 0.49 * ((x + w) / (2 * w));
  const endV = (z: number) => 0.8 + 0.17 * ((z - c) / (top - c));
  const edgeU = (y: number) => 0.505 + 0.49 * ((y + w) / (2 * w));
  const edgeV = (z: number) => 0.52 + 0.21 * ((z - c) / (top - c));

  // Each page curves from the spine (x = 0) to its outer edge, strip by strip.
  for (const side of [-1, 1]) {
    for (let i = 0; i < BOOK_STRIPS; i++) {
      const t0 = i / BOOK_STRIPS, t1 = (i + 1) / BOOK_STRIPS;
      // Keep x0 < x1 so every face below winds the same way on both pages.
      const [ta, tb] = side < 0 ? [t1, t0] : [t0, t1];
      const xa = side * ta * w, xb = side * tb * w;
      const za = pageHeight(ta), zb = pageHeight(tb);
      // The page itself: the left page is the atlas's first quarter, the right page the second.
      const pageU = (x: number) => 0.005 + 0.49 * ((x + w) / (2 * w));
      solid.quad([[xa, -w, za], [xb, -w, zb], [xb, w, zb], [xa, w, za]],
        [[pageU(xa), 0], [pageU(xb), 0], [pageU(xb), 1], [pageU(xa), 1]]);
      // The page block's ends, near (-y) and far (+y), following the curve.
      solid.quad([[xa, -w, c], [xb, -w, c], [xb, -w, zb], [xa, -w, za]],
        [[endU(xa), endV(c)], [endU(xb), endV(c)], [endU(xb), endV(zb)], [endU(xa), endV(za)]]);
      solid.quad([[xb, w, c], [xa, w, c], [xa, w, za], [xb, w, zb]],
        [[endU(xb), endV(c)], [endU(xa), endV(c)], [endU(xa), endV(za)], [endU(xb), endV(zb)]]);
    }
    // The outer edge of the page block.
    const x = side * w, z = pageHeight(1);
    const outer = side > 0
      ? [[x, -w, c], [x, w, c], [x, w, z], [x, -w, z]]
      : [[x, w, c], [x, -w, c], [x, -w, z], [x, w, z]];
    solid.quad(outer, outer.map(([, y, zz]) => [edgeU(y), edgeV(zz)]));
  }
  return solid.build();
}

// The forest square: a few small pines around the edge of a mossy floor,
// leaving the middle clear for a card. Sides of each cone.
const PINE_SEGMENTS = 8;
// Each pine: position, and how big it is next to the others.
const PINES = [
  { x: -0.34, y: 0.33, size: 1 },
  { x: 0.35, y: 0.3, size: 0.85 },
  { x: 0.33, y: -0.35, size: 1.05 },
  { x: -0.31, y: -0.33, size: 0.8 },
];

/**
 * Builds the forest mesh. Its texture (forest_3d.png) is an atlas: the left
 * half is the forest floor, the top right quarter holds two cone wraps side
 * by side, the needles and then the bark, each a triangle whose top-left
 * corner is the cone's tip and whose bottom edge runs around its base.
 */
function forestGeometry(): BufferGeometry {
  const solid = new Solid();
  solid.floor(0.005, 0, 0.495, 1);

  // A cone standing at (x, y) from z0 to its tip, wrapped with one triangle of the atlas.
  type Wrap = { tip: number[]; u0: number; u1: number; v: number; };
  const needles: Wrap = { tip: [0.525, 0.99], u0: 0.505, u1: 0.68, v: 0.515 };
  const bark: Wrap = { tip: [0.76, 0.99], u0: 0.755, u1: 0.98, v: 0.515 };
  const cone = (x: number, y: number, z0: number, radius: number, tip: number, wrap: Wrap, turn: number) => {
    for (let i = 0; i < PINE_SEGMENTS; i++) {
      const a0 = turn + (i / PINE_SEGMENTS) * Math.PI * 2;
      const a1 = turn + ((i + 1) / PINE_SEGMENTS) * Math.PI * 2;
      const u = (t: number) => wrap.u0 + (wrap.u1 - wrap.u0) * t;
      const apex = [x, y, tip];
      solid.quad(
        [[x + radius * Math.cos(a0), y + radius * Math.sin(a0), z0], [x + radius * Math.cos(a1), y + radius * Math.sin(a1), z0], apex, apex],
        [[u(i / PINE_SEGMENTS), wrap.v], [u((i + 1) / PINE_SEGMENTS), wrap.v], wrap.tip, wrap.tip],
      );
    }
  };

  for (const [n, { x, y, size }] of PINES.entries()) {
    const turn = n * 0.7; // so the seams and facets do not all line up
    cone(x, y, 0, 0.03 * size, FOREST_TREE_HEIGHT * 0.45 * size, bark, turn);
    // Two tiers of needles, the upper one narrower.
    cone(x, y, FOREST_TREE_HEIGHT * 0.18 * size, 0.12 * size, FOREST_TREE_HEIGHT * 0.72 * size, needles, turn);
    cone(x, y, FOREST_TREE_HEIGHT * 0.5 * size, 0.085 * size, FOREST_TREE_HEIGHT * size, needles, turn + 0.4);
  }
  return solid.build();
}

// One mesh each, shared by every square of that terrain.
const LABYRINTH = labyrinthGeometry();
const TOON = toonGeometry();
const FOREST = forestGeometry();

// On a touchscreen one finger pans the board, and a pan that ends on the square
// it began on still arrives as a click. Anything that travelled is a drag, not a tap.
const TAP_SLOP_PX = 10;

/** Clicks and taps on a square, ignoring drags. */
function onTap(x: number, y: number) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > TAP_SLOP_PX) return;
    pointTile(x, y);
  };
}

// Each seat sees the board turned so its own edge is at the bottom of the
// screen, and its cards face it.
const CARD_FACING = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

// The board rests on a slab of wooden planks. How far it reaches past the
// squares on each side, how thick it is, and how much of the board one copy
// of the wood texture covers (it holds four planks).
const TABLE_BORDER = 0.4;
const TABLE_THICKNESS = 0.3;
const WOOD_SPAN = 2.5;
// The slab's top sits just under the squares, and a dark plate between them
// keeps the hairline gaps between squares reading as a grid.
const TABLE_TOP = -0.02;
const GRID_PLATE = -0.01;

/**
 * Paints planks of wood onto a canvas: a shade per plank, wavy grain, the odd
 * knot, butt joints and seams. Grain waves complete whole cycles across the
 * canvas, so the texture tiles without a visible edge.
 */
function woodTexture(): CanvasTexture {
  const size = 512, planks = 4, ph = size / planks;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  if (!ctx) return texture;
  // Seeded, so the table looks the same on every load.
  let seed = 20240607;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    const light = 30 + rand() * 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, size, ph);
    ctx.clip();
    ctx.fillStyle = `hsl(${24 + rand() * 8}, 48%, ${light}%)`;
    ctx.fillRect(0, y0, size, ph);

    for (let g = 0; g < 45; g++) {
      const gy = y0 + rand() * ph;
      const amp = 0.5 + rand() * 3;
      const freq = ((1 + Math.floor(rand() * 3)) * 2 * Math.PI) / size;
      const phase = rand() * Math.PI * 2;
      ctx.strokeStyle = `hsla(22, 55%, ${light - 8 - rand() * 12}%, ${0.15 + rand() * 0.35})`;
      ctx.lineWidth = 0.5 + rand() * 1.5;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = gy + amp * Math.sin(x * freq + phase);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (rand() < 0.6) {
      const kx = 48 + rand() * (size - 96), ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let r = 5; r >= 1; r--) {
        ctx.strokeStyle = `hsla(20, 55%, ${light - 14}%, 0.5)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(kx, ky, 4 + r * 5, 2 + r * 1.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = `hsl(18, 50%, ${light - 20}%)`;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Where two lengths of this plank butt together.
    const joint = rand() * size;
    ctx.fillStyle = "rgba(25, 12, 5, 0.75)";
    ctx.fillRect(joint, y0, 2, ph);
    ctx.restore();

    // The seam with the plank above: a dark groove and a lit lip.
    ctx.fillStyle = "rgba(20, 10, 4, 0.85)";
    ctx.fillRect(0, y0, size, 3);
    ctx.fillStyle = "rgba(255, 220, 170, 0.12)";
    ctx.fillRect(0, y0 + 3, size, 1);
  }

  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4; // the camera looks at the table at a slant
  return texture;
}

/** The slab: its top, and the four sides with the grain running along each edge. */
function tableGeometry(size: number): BufferGeometry {
  const solid = new Solid();
  const e = size / 2 + TABLE_BORDER;
  const top = TABLE_TOP, bottom = TABLE_TOP - TABLE_THICKNESS;
  const u = (t: number) => t / WOOD_SPAN;
  // A side shows a band of one plank, as if looking at its end grain from the side.
  const v = (z: number) => 0.03 + ((z - bottom) / TABLE_THICKNESS) * 0.18;
  solid.quad([[-e, -e, top], [e, -e, top], [e, e, top], [-e, e, top]],
    [[u(-e), u(-e)], [u(e), u(-e)], [u(e), u(e)], [u(-e), u(e)]], false);
  solid.quad([[-e, -e, bottom], [e, -e, bottom], [e, -e, top], [-e, -e, top]], [[u(-e), v(bottom)], [u(e), v(bottom)], [u(e), v(top)], [u(-e), v(top)]]);
  solid.quad([[e, e, bottom], [-e, e, bottom], [-e, e, top], [e, e, top]], [[u(e), v(bottom)], [u(-e), v(bottom)], [u(-e), v(top)], [u(e), v(top)]]);
  solid.quad([[e, -e, bottom], [e, e, bottom], [e, e, top], [e, -e, top]], [[u(-e), v(bottom)], [u(e), v(bottom)], [u(e), v(top)], [u(-e), v(top)]]);
  solid.quad([[-e, e, bottom], [-e, -e, bottom], [-e, -e, top], [-e, e, top]], [[u(e), v(bottom)], [u(-e), v(bottom)], [u(-e), v(top)], [u(e), v(top)]]);
  return solid.build();
}

/** The wooden table under the board. Rebuilt only when the board's size changes. */
const Table = memo(function Table({ size }: { size: number; }) {
  const texture = useMemo(() => woodTexture(), []);
  const material = useMemo(() => new MeshBasicMaterial({ map: texture, toneMapped: false, vertexColors: true }), [texture]);
  const geometry = useMemo(() => tableGeometry(size), [size]);
  useEffect(() => () => { texture.dispose(); material.dispose(); }, [texture, material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <mesh geometry={geometry} material={material} raycast={() => null} />
      <mesh position={[0, 0, GRID_PLATE]} scale={size} geometry={SQUARE} raycast={() => null}>
        <meshBasicMaterial color="#120a05" />
      </mesh>
    </>
  );
});

/** The terrain squares. Re-renders only when the terrain itself changes. */
const Tiles = memo(function Tiles({ layout, size }: { layout: string; size: number; }) {
  const textures = useTexture(TERRAIN_URLS) as Record<string, Texture>;
  // One material per terrain, shared by every square of it, instead of one per square.
  // Terrain is flat artwork, so it is drawn exactly as painted: the PNGs are
  // sRGB (left unset, three treats them as linear and lightens them), the
  // material is unlit (the scene's strong ambient light overexposed it), and
  // tone mapping is off (ACES desaturates).
  const materials = useMemo(() => {
    const out: Record<string, MeshBasicMaterial> = {};
    for (const [name, texture] of Object.entries(textures)) {
      texture.minFilter = LinearMipmapLinearFilter;
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      // The mountain's slopes are shaded through vertex colours (see reliefGeometry).
      out[name] = new MeshBasicMaterial({ map: texture, toneMapped: false, vertexColors: name === "mountain" || BUILT_3D.includes(name) });
    }
    return out;
  }, [textures]);
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);
  const relief = useMemo(() => (textures.mountain?.image ? reliefGeometry(textures.mountain.image as CanvasImageSource) : SQUARE), [textures]);
  useEffect(() => () => { if (relief !== SQUARE) relief.dispose(); }, [relief]);
  const half = Math.floor(size / 2);
  const tiles = useMemo(() => layout.split(","), [layout]);

  return (
    <>
      {tiles.map((terrain, index) => {
        const x = (index % size) - half;
        const y = Math.floor(index / size) - half;
        return (
          // A hairline gap between squares keeps the grid readable on uniform ground.
          <mesh key={index} geometry={terrain === "mountain" ? relief : terrain === "labyrinth" ? LABYRINTH : terrain === "toon" ? TOON : terrain === "forest" ? FOREST : SQUARE} material={materials[terrain] ?? materials.normal} scale={0.985} position={[x, y, 0]} onClick={onTap(x, y)} />
        );
      })}
    </>
  );
});

/** Colour of the halo around the turn player's pieces. */
const READY_COLOR = "#ffb300";
/** How far the halo spreads, in squares: a little past the square's edge. */
const HALO_SIZE = 1.8;

/**
 * The halo's glow: a soft ring, faint in the middle (under the card), bright
 * around where the card's edges are, and fading out past the square. Painted
 * once on a canvas and shared by every halo.
 */
let haloTexture: CanvasTexture | null = null;
function halo(): CanvasTexture {
  if (haloTexture) return haloTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    // Deep amber rather than pale yellow: it reads as colour, not as light.
    gradient.addColorStop(0, "rgba(255,170,0,0.35)");
    gradient.addColorStop(0.3, "rgba(255,170,0,0.6)");
    gradient.addColorStop(0.45, "rgba(255,150,0,1)");
    gradient.addColorStop(0.65, "rgba(255,120,0,0.55)");
    gradient.addColorStop(1, "rgba(255,90,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  haloTexture = new CanvasTexture(canvas);
  haloTexture.colorSpace = SRGBColorSpace;
  return haloTexture;
}

/**
 * One of the turn player's pieces, acted or not: a soft golden halo glowing
 * on its square, so whose turn it is shows on the board. It is still, not animated, so the board keeps rendering only when
 * something changes.
 */
function ReadyFrame({ p, z }: { p: Pos; z: number; }) {
  return (
    <mesh geometry={SQUARE} position={[p.x, p.y, z]} scale={[HALO_SIZE, HALO_SIZE, 1]} raycast={() => null} renderOrder={1}>
      <meshBasicMaterial map={halo()} color={READY_COLOR} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function Square({ p, color, opacity, z = 0.05 }: { p: Pos; color: string; opacity: number; z?: number; }) {
  return (
    <mesh geometry={SQUARE} position={[p.x, p.y, z]} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/**
 * The lit squares for a selection, as seen by the team of the seat that made
 * it: blue for a summon, red where a move attacks, green where it merges two
 * of the team's cards, orange where the leader would eat one of its own.
 */
function SelectionSquares({ view, seat, sel }: { view: GameView; seat: number; sel: Selection; }) {
  const team = view.seats[seat]?.team;
  const summoning = sel.kind === "place" || sel.kind === "hand";
  return (
    <>
      {sel.targets.map((p) => {
        const occupant = view.cards.find((c) => c.x === p.x && c.y === p.y);
        const enemyLeader = view.seats.some((s) => s.alive && s.team !== team && s.leaderX === p.x && s.leaderY === p.y);
        const tint = summoning ? "#2a7bff"
          : sel.kind === "leader" && occupant ? "#ff9f1a"
          : enemyLeader || (occupant && view.seats[occupant.owner]?.team !== team) ? "#ff3b3b"
            : occupant ? "#39d353" : "#fff700";
        return <Square key={`${p.x},${p.y}`} p={p} color={tint} opacity={0.55} z={0.05 + liftAt(view, p.x, p.y)} />;
      })}
    </>
  );
}

/** Lights the squares the current mode can act on, and draws the cursor. */
function Highlights() {
  const mode = useInteraction((s) => s.mode);
  const cursor = useInteraction((s) => s.cursor);
  const view = useGameStore((s) => s.view);
  const seat = useGameStore(selectPerspective);
  // The arena display has no cursor of its own: it shows the players' (see RemoteSelections).
  const display = useGameStore((s) => s.display);
  if (!view || display) return null;
  return (
    <>
      <SelectionSquares view={view} seat={seat} sel={selectionOf(view, seat, mode)} />
      <Square p={cursor} color="#ffffff" opacity={0.4} z={0.4} />
    </>
  );
}

/** On the arena display: what each player has picked up and where it may go, with the piece ringed in their colour. */
function RemoteSelections() {
  const selections = useGameStore((s) => s.selections);
  const view = useGameStore((s) => s.view);
  if (!view) return null;
  return (
    <>
      {Object.entries(selections).map(([cid, sel]) => (
        <group key={cid}>
          <SelectionSquares view={view} seat={sel.seat} sel={sel} />
          {sel.from && <Square p={sel.from} color={SEAT_COLORS[sel.seat] ?? "#ffffff"} opacity={0.6} z={0.39 + liftAt(view, sel.from.x, sel.from.y)} />}
        </group>
      ))}
    </>
  );
}

const MENU_LAYOUT = Array(49).fill("normal").join(",");

/** Where everyone else is pointing: players in their seat's colour, spectators much fainter. */
function RemoteCursors() {
  const cursors = useGameStore((s) => s.cursors);
  return (
    <>
      {Object.entries(cursors).map(([cid, c]) => (
        <Square key={cid} p={c} color={c.spectator ? "#d0d7de" : SEAT_COLORS[c.seat] ?? "#ffffff"} opacity={c.spectator ? 0.14 : 0.3} z={0.38} />
      ))}
    </>
  );
}

// The leader's artwork sits on its rose, small enough that the rose shows all around it.
// Card art is a little taller than wide (it fills 65 x 70 of a 68 x 98 card).
const LEADER_ART = { w: 0.5, h: 0.54 };

/** The deck leader's artwork (just the picture, not the whole card), lying on its emblem. */
function LeaderArt({ num, facing }: { num: number; facing: number; }) {
  // Artwork is sRGB; set as it loads so it is drawn exactly as painted.
  const texture = useTexture(cardArt(num).art, (t) => { (Array.isArray(t) ? t : [t]).forEach((x) => { x.colorSpace = SRGBColorSpace; }); });
  return (
    <group position={[0, 0, 0.02]} rotation={[0, 0, facing]}>
      {/* A thin dark frame keeps the picture readable against the rose. */}
      <mesh geometry={SQUARE} scale={[LEADER_ART.w + 0.04, LEADER_ART.h + 0.04, 1]}>
        <meshBasicMaterial color="#120c08" />
      </mesh>
      <mesh geometry={SQUARE} scale={[LEADER_ART.w, LEADER_ART.h, 1]} position={[0, 0, 0.002]}>
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

// How long a deck leader reels from a hit, and how far it is knocked.
const HIT_TIME = 0.45;
const HIT_KNOCK = 0.09;

/** A deck leader's emblem, gliding to wherever the server says it stands, and reeling when it loses LP. */
function Leader({ seat, x, y, lift, team, mine, spectating, active, num, facing }: { seat: number; x: number; y: number; lift: number; team: number; mine: boolean; spectating: boolean; active: boolean; num: number; facing: number; }) {
  const texture = useTexture(EMBLEMS[team % 2]);
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const hurt = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  // Seconds until the hit lands (a direct attack has to fly in first), then how long it has been reeling.
  const hit = useRef<{ wait: number; t: number; } | null>(null);
  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.eventSeq === previous.eventSeq) return;
    const lost = state.lastEvents.filter((e) => e.type === "damage" && e.seat === seat && (e.amount ?? 0) > 0);
    if (!lost.length) return;
    hit.current = { wait: lost.some((e) => e.text === "direct attack") ? STRIKE_TRAVEL : 0, t: 0 };
    invalidate();
  }), [seat, invalidate]);
  // Placed once; after that useFrame glides it. Passing the live position would
  // make React snap it there and skip the glide.
  const [start] = useState<[number, number, number]>(() => [x, y, 0.1 + lift]);
  useFrame((state, delta) => {
    const position = group.current?.position as unknown as Record<string, number> | undefined;
    if (!position) return;
    const movingX = ease(position, "x", x, 0.2, delta);
    const movingY = ease(position, "y", y, 0.2, delta);
    // Climbing onto (or off) high ground.
    const movingZ = ease(position, "z", 0.1 + lift, 0.2, delta);
    let reeling = false;
    if (hit.current && body.current) {
      const h = hit.current;
      const step = Math.min(delta, 0.05);
      if (h.wait > 0) h.wait -= step;
      else h.t += step;
      const k = Math.min(1, h.t / HIT_TIME);
      const shake = h.wait > 0 || reducedMotion() ? 0 : HIT_KNOCK * (1 - k) * Math.sin(h.t * 60);
      body.current.position.set(shake, shake * 0.4, 0);
      if (hurt.current) (hurt.current.material as MeshBasicMaterial).opacity = h.wait > 0 ? 0 : 0.6 * (1 - k);
      reeling = k < 1;
      if (!reeling) hit.current = null;
    }
    // The canvas renders on demand: keep asking for frames until we arrive.
    if (movingX || movingY || movingZ || reeling) state.invalidate();
  });
  return (
    <group ref={group} position={start} onClick={onTap(x, y)}>
     <group ref={body}>
      <mesh geometry={SQUARE} position={[0, 0, -0.01]}>
        <meshBasicMaterial color={active ? "#ffe066" : spectating ? SEAT_COLORS[seat] ?? "#ffffff" : mine ? "#ffffff" : "#ff4343"} transparent opacity={active ? 0.9 : 0.55} />
      </mesh>
      <mesh geometry={SQUARE}>
        <meshBasicMaterial map={texture} transparent alphaTest={0.1} />
      </mesh>
      {/* Framed in its seat's colour, like the badge on its cards. */}
      <mesh geometry={FRAME} position={[0, 0, 0.005]} raycast={() => null}>
        <meshBasicMaterial color={SEAT_COLORS[seat] ?? "#ffffff"} toneMapped={false} />
      </mesh>
      {catalogCard(num) && (
        <CardGuard>
          <Suspense fallback={null}>
            <LeaderArt num={num} facing={facing} />
          </Suspense>
        </CardGuard>
      )}
      {/* Turns red for a moment when it is hit. */}
      <mesh ref={hurt} geometry={SQUARE} position={[0, 0, 0.03]} raycast={() => null}>
        <meshBasicMaterial color="#ff2020" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
     </group>
    </group>
  );
}

export default function GameBoard() {
  const backdrop = useMenuStore((s) => s.backdrop);
  const size = useGameStore((s) => s.view?.size) ?? backdrop?.size ?? 7;
  // Joined into a string so the selector's result only changes with the terrain.
  // With no duel on (the menu), the board is the map chosen in the lobby, or
  // an empty field of normal ground when the map is random.
  const duelLayout = useGameStore((s) => s.view?.tiles.join(","));
  const menuLayout = useMemo(() => backdrop?.tiles.join(",") ?? MENU_LAYOUT, [backdrop]);
  const layout = duelLayout ?? menuLayout;
  const playing = useGameStore((s) => s.view !== null);
  const seats = useGameStore((s) => s.view?.seats);
  const turn = useGameStore((s) => s.view?.turn ?? -1);
  const views = useGameStore((s) => s.view?.cards);
  const cards = useGameStore((s) => s.cards);
  const seat = useGameStore(selectPerspective);
  const lastEvents = useGameStore((s) => s.lastEvents);
  // Cards that just came out of the hand (or graveyard) we are looking at.
  const fromHand = useMemo(() => new Set(lastEvents
    .filter((e) => e.type === "summon" && e.seat === seat)
    .map((e) => e.cardId)), [lastEvents, seat]);
  // Cards a fusion animation is still making: they appear once it lands, and
  // ours then fly onto their square like any card played from the hand.
  const fusing = useFusionStore((s) => s.queue.map((c) => c.resultId).join(","));
  // Ritual monsters still being summoned, likewise (see RitualRites).
  const ritualHidden = useRitualStore((s) => s.hidden);
  const hiddenIds = useMemo(() => new Set([...(fusing ? fusing.split(",").map(Number) : []), ...ritualHidden]), [fusing, ritualHidden]);
  const landing = useFusionStore((s) => s.landing);
  // A card we just played flies in before the server answers (see Prediction).
  const predictedId = useGameStore((s) => s.prediction?.card.id);
  const selectedId = useInteraction((s) => (s.mode.kind === "card" ? s.mode.cardId : -1));
  // Changes staged on the picked-up card, shown on the board before they are committed.
  const stagedFlip = useInteraction((s) => s.mode.kind === "card" && s.mode.flip);
  const stagedPosition = useInteraction((s) => s.mode.kind === "card" && s.mode.switchPosition);
  const showTiles = useUIStore((s) => s.showTiles);
  const showCards = useUIStore((s) => s.showCards);
  const showPlayers = useUIStore((s) => s.showPlayers);
  // The arena display turns the board as it is set to (see ArenaDisplay).
  const display = useGameStore((s) => s.display);
  const arenaTurn = useUIStore((s) => s.arenaTurn);

  const myTeam = seats?.[seat]?.team ?? -1;
  // Teammates exist when more than one seat shares our team (2v2): then our side's cards are framed in green.
  const hasTeammates = (seats?.filter((s) => s.team === myTeam).length ?? 0) > 1;
  // Watching without a seat (e.g. a duel between bots): nobody is an enemy, so cards are framed in their owner's colour.
  const spectating = !!seats && !seats[seat];
  // Enough of the board to tell how high each square stands.
  const layoutView = useMemo(() => (duelLayout ? { size, tiles: duelLayout.split(",") } : null), [duelLayout, size]);

  return (
    <group position={[0, 0, 1]} rotation={[0, 0, display ? displayRotation(arenaTurn) : BOARD_ROTATION[seat] ?? 0]}>
      <Table size={size} />
      {showTiles && layout && <Tiles layout={layout} size={size} />}
      {playing && <Highlights />}
      {/* The ATK/DEF font, loaded before the first card is played (a card would wait on it). */}
      {playing && <CardGuard><Suspense fallback={null}><WarmCardFont /></Suspense></CardGuard>}
      {playing && <RemoteCursors />}
      {playing && <RemoteSelections />}

      {showCards && cards.map((rendered, index) => {
        if (hiddenIds.has(rendered.id)) return null;
        const view = views?.[index];
        const staged = rendered.id === selectedId && (stagedFlip || stagedPosition);
        const card = staged ? {
          ...rendered,
          isFaceDown: stagedFlip ? false : rendered.isFaceDown,
          isDefenseMode: stagedPosition ? !rendered.isDefenseMode : rendered.isDefenseMode,
        } : rendered;
        return (
          <group key={card.id}>
            {/* Each card waits for its own art and font. Without this the
                board's Suspense would blank the whole scene every time a
                card with art not yet loaded appears. */}
            <CardGuard>
              <Suspense fallback={null}>
                <YugiohCard
                  card={card}
                  isSelected={card.id === selectedId}
                  isEnemy={!spectating && seats?.[card.owner]?.team !== myTeam}
                  frameColor={
                    spectating ? SEAT_COLORS[card.owner]
                    : seats?.[card.owner]?.team !== myTeam ? "#e01b1b"
                    : hasTeammates ? "#22c55e"
                    : undefined
                  }
                  ownerColor={SEAT_COLORS[card.owner]}
                  facing={CARD_FACING[card.owner] ?? 0}
                  entrance={fromHand.has(card.id) || landing.includes(card.id) || card.id === predictedId}
                  // The card catches taps meant for its square (it stands above the
                  // board, so the tile under the finger is often a neighbour).
                  onSelect={view ? () => pointTile(view.x, view.y) : undefined}
                />
              </Suspense>
            </CardGuard>
            {/* The turn player's cards glow, so whose turn it is shows on the
                board; the ones already spent or spellbound are also dimmed. */}
            {view && view.owner === turn && (view.acted || !!view.spellbound) && (
              <Square p={view} color={view.spellbound ? "#7b2cff" : "#000000"} opacity={0.4} z={0.2 + (layoutView ? liftAt(layoutView, view.x, view.y) : 0)} />
            )}
            {view && view.owner === turn && (
              <ReadyFrame p={view} z={0.06 + (layoutView ? liftAt(layoutView, view.x, view.y) : 0)} />
            )}
          </group>
        );
      })}

      {/* Spells and traps going off, after the card itself has left the board. */}
      {playing && showCards && (
        <SpellCasts facingFor={(owner) => CARD_FACING[owner] ?? 0} isEnemy={(owner) => seats?.[owner]?.team !== myTeam} />
      )}

      {/* A ritual summoning: the field darkens and the tributes orbit the board's centre. */}
      {playing && showCards && (
        <RitualRites
          size={size}
          facingFor={(owner) => CARD_FACING[owner] ?? 0}
          upright={-(display ? displayRotation(arenaTurn) : BOARD_ROTATION[seat] ?? 0)}
          isEnemy={(owner) => seats?.[owner]?.team !== myTeam}
        />
      )}

      {/* A card played onto a full field, torn apart where it landed. */}
      {playing && showCards && (
        <CardOverflows facingFor={(owner) => CARD_FACING[owner] ?? 0} isEnemy={(owner) => seats?.[owner]?.team !== myTeam} />
      )}

      {/* Raigeki: lightning down every square of its row and column. */}
      {playing && showCards && (
        <Lightning
          liftAt={(x, y) => (layoutView ? liftAt(layoutView, x, y) : 0)}
          facingFor={(owner) => CARD_FACING[owner] ?? 0}
          isEnemy={(owner) => seats?.[owner]?.team !== myTeam}
        />
      )}

      {/* Dark Hole: the field whirls into a black hole in the middle of the board. */}
      {playing && showCards && (
        <DarkHole
          size={size}
          liftAt={(x, y) => (layoutView ? liftAt(layoutView, x, y) : 0)}
          facingFor={(owner) => CARD_FACING[owner] ?? 0}
          isEnemy={(owner) => seats?.[owner]?.team !== myTeam}
        />
      )}

      {/* Exodia assembled: the Forbidden One rises over the field and obliterates the enemy. */}
      {playing && showCards && (
        <Exodia
          size={size}
          upright={-(display ? displayRotation(arenaTurn) : BOARD_ROTATION[seat] ?? 0)}
          liftAt={(x, y) => (layoutView ? liftAt(layoutView, x, y) : 0)}
          facingFor={(owner) => CARD_FACING[owner] ?? 0}
          isEnemy={(owner) => seats?.[owner]?.team !== myTeam}
        />
      )}

      {/* A deck leader losing LP: the hit, and how much it cost. */}
      {playing && showPlayers && (
        <LeaderStrikes
          liftAt={(x, y) => (layoutView ? liftAt(layoutView, x, y) : 0)}
          upright={-(display ? displayRotation(arenaTurn) : BOARD_ROTATION[seat] ?? 0)}
        />
      )}

      {/* The turn player's deck leader glows like their cards. */}
      {showPlayers && seats?.map((s) => s.alive && s.index === turn && (
        <ReadyFrame key={`ready-${s.index}`} p={{ x: s.leaderX, y: s.leaderY }} z={0.06 + (layoutView ? liftAt(layoutView, s.leaderX, s.leaderY) : 0)} />
      ))}
      {showPlayers && seats?.map((s) => s.alive && (
        <Leader key={s.index} seat={s.index} x={s.leaderX} y={s.leaderY} lift={layoutView ? liftAt(layoutView, s.leaderX, s.leaderY) : 0} team={s.team} mine={s.team === myTeam} spectating={spectating} active={s.index === turn} num={s.leaderNum ?? -1} facing={CARD_FACING[s.index] ?? 0} />
      ))}
    </group>
  );
}
