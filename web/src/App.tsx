import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useRef } from "react";
import { TOUCH } from "three";
import { Perf } from "r3f-perf";
import { useUIStore } from "@/stores/uiStore";
import { selectRole, useGameStore } from "@/stores/gameStore";
import GameBoard from "@/components/game/GameBoard";
import FusionSequence, { FusionSkip } from "@/components/game/FusionSequence";
import ControlPanel from "@/components/ui/ControlPanel";
import MusicToggle from "@/components/ui/MusicToggle";
import FPSCounter from "@/components/ui/FPSCounter";
import Hud from "@/components/ui/Hud";
import Lobby, { WaitingRoom } from "@/components/ui/Lobby";
import Builder from "@/components/ui/Builder";
import AdminDashboard from "@/components/ui/AdminDashboard";
import ProfilePage from "@/components/ui/Profile";
import TestTools from "@/components/ui/TestTools";
import Controller from "@/components/ui/Controller";
import { DisplayBadge } from "@/components/ui/ArenaDisplay";
import { startDisplaySync } from "@/game/arenaDisplay";
import { bindRenderer } from "@/game/cardTextures";
import ActivationFlash from "@/components/ui/ActivationFlash";
import CardPreview from "@/components/ui/CardPreview";
import { useMenuStore } from "@/stores/menuStore";
import DestinyBanner from "@/components/ui/DestinyBanner";
import { ActionBar, AdminPanel, ThinkingPanel, ChoiceDialog, EventLog, FocusPortals, GameOver, GraveyardView, HandView, PausedOverlay, TilePreview, TurnRow } from "@/components/ui/GameOverlays";
import { BaseHolographicMaterial } from "@/shaders/BaseHolographic";
import { GodRaysMaterial } from "@/shaders/GodRays";
import { useIsMobileLandscape } from "@/hooks/useIsMobile";
import { useGameAudio } from "@/hooks/useGameAudio";
import { useWakeLock } from "@/hooks/useWakeLock";
import { startInteraction, useInteraction } from "@/game/interaction";
import { countFrame } from "@/game/frameStats";
import { startKeyboard } from "@/input/keyboard";
import { startGamepad } from "@/input/gamepad";
import { session } from "@/net/session";
import { watchRenderer } from "@/net/errorReport";

extend({ BaseHolographicMaterial, GodRaysMaterial });

const DEG = Math.PI / 180;

function leave() {
  session.disconnect();
  // Drop ?room= so the lobby does not immediately rejoin.
  if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
}

/** Draws a new frame whenever game, input or display state changes; the canvas renders on demand. */
function RenderOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const redraw = () => invalidate();
    const stops = [useGameStore.subscribe(redraw), useInteraction.subscribe(redraw), useUIStore.subscribe(redraw)];
    return () => stops.forEach((stop) => stop());
  }, [invalidate]);
  useFrame(countFrame);
  return null;
}

const FOV = 20;
const TAN_HALF_FOV = Math.tan((FOV / 2) * DEG);
// The fixed camera looks down at the board from this angle (OrbitControls' polar angle).
const POLAR = 140 * DEG;
// Straight down: the arena display laid flat on a table (see ArenaDisplay), seen from any side.
const POLAR_FLAT = 90 * DEG;
// Screen space kept clear of the board for the HUD: the seat panels on top,
// the action bar below, and a little at the sides. In CSS pixels.
// Phones stack the action bar in two rows.
const marginFor = (width: number) => ({ top: width < 640 ? 88 : 92, bottom: width < 640 ? 84 : 60, side: 6 });
// How far a pinch can bring the fixed camera in, as a share of the fitted distance.
const MIN_ZOOM = 0.35;

/**
 * How far back the fixed camera stands, and how far up the board it aims, so the
 * board fills the screen between the HUD at the top and the action bar below.
 * Seen at an angle the near edge looks bigger than the far one, so aiming at the
 * board's middle would leave it off-centre; the aim is shifted to even it out.
 */
function fitCamera(size: number, width: number, height: number, polar = POLAR) {
  const MARGIN = marginFor(width);
  const aspect = width / Math.max(1, height);
  // Where the board may reach, in normalised screen units (-1..1).
  const top = 1 - (2 * MARGIN.top) / height;
  const bottom = -1 + (2 * MARGIN.bottom) / height;
  const side = 1 - (2 * MARGIN.side) / width;
  if (top <= bottom || side <= 0) return { distance: size + 14, aim: 0 };

  // Camera axes: it sits along `back` from its target, with `up` its screen up.
  const back = { y: Math.cos(polar), z: Math.sin(polar) };
  const up = { y: Math.sin(polar), z: -Math.cos(polar) };
  const half = size / 2 + 0.1;
  const boardZ = 1; // GameBoard's group sits at z = 1

  // Screen extents of the board for a camera `d` back from (0, aim, 0).
  const extents = (d: number, aim: number) => {
    let high = -Infinity, low = Infinity, wide = 0;
    for (const y of [-half, half]) {
      const vy = y - aim - back.y * d;
      const vz = boardZ - back.z * d;
      const depth = -(vy * back.y + vz * back.z);
      const sy = (vy * up.y + vz * up.z) / (depth * TAN_HALF_FOV);
      high = Math.max(high, sy);
      low = Math.min(low, sy);
      wide = Math.max(wide, half / (depth * TAN_HALF_FOV * aspect));
    }
    return { high, low, wide };
  };

  // Settle the aim and the distance together: the aim keeps the board inside
  // the free band, the distance makes it just fit.
  let distance = size + 14;
  let aim = 0;
  for (let i = 0; i < 40; i++) {
    const e = extents(distance, aim);
    distance *= Math.max((e.high - e.low) / (top - bottom), e.wide / side);
    const centred = extents(distance, aim);
    // Screen units per world unit of aim, near enough for the next step.
    const perUnit = (centred.high - centred.low) / (2 * half);
    // Shift only by what spills past the band. When the height decides the fit
    // that centres the board; when the width does (a narrow screen, with height
    // to spare) it leaves the aim alone, as moving it would only shrink the board.
    const spill = Math.max(0, centred.high - top) - Math.max(0, bottom - centred.low);
    aim += spill / Math.max(perUnit, 1e-3) * 0.8;
  }
  return { distance, aim };
}

/** Camera and its controls. Inside the canvas so it can fit the board to the screen's shape. */
function Camera() {
  const enableZoom = useUIStore((s) => s.enableZoom);
  const enableRotate = useUIStore((s) => s.enableRotate);
  const enablePan = useUIStore((s) => s.enablePan);
  const free = useUIStore((s) => s.enableFreeCamera);
  // In the menu the camera frames the map shown there (see GameBoard).
  const backdropSize = useMenuStore((s) => s.backdrop?.size);
  const size = useGameStore((s) => s.view?.size) ?? backdropSize ?? 7;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const isMobileLandscape = useIsMobileLandscape();
  const controls = useRef<{ target: { x: number; y: number; z: number; }; getDistance: () => number; update: () => void; object: { position: { set: (x: number, y: number, z: number) => void; }; }; } | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const playing = useGameStore((s) => s.view !== null);
  // The arena display can look straight down, to lie on a table.
  const display = useGameStore((s) => s.display);
  const arenaFlat = useUIStore((s) => s.arenaFlat);
  const flat = display && arenaFlat;
  const polar = flat ? POLAR_FLAT : POLAR;

  // The board fills whatever screen it is on, big monitor or portrait phone;
  // landscape phones stay close and pan instead.
  const fit = fitCamera(size, width, height, polar);
  const distance = isMobileLandscape ? size + 4 : fit.distance;
  const aim = isMobileLandscape || free ? 0 : fit.aim;

  // Start fully zoomed out, the whole board in view: on load, when the screen's
  // shape or the board's size changes the fit, and on going between the menu
  // and a duel. Without this the camera keeps three's default spot, 5 units
  // away, which the zoom limits allow, so it starts zoomed in.
  useEffect(() => {
    const c = controls.current;
    if (free || !c) return;
    // The controls' own camera, placed on the fixed viewing angle at the fitted distance.
    c.object.position.set(0, aim + Math.cos(polar) * distance, Math.sin(polar) * distance);
    c.target.x = 0;
    c.target.y = aim;
    c.target.z = 0;
    c.update();
    invalidate();
  }, [invalidate, distance, aim, free, playing, polar]);

  return (
    <OrbitControls
      ref={controls as never}
      target={[0, aim, 0]}
      enableDamping={false}
      enableZoom={enableZoom}
      enableRotate={enableRotate}
      enablePan={enablePan}
      screenSpacePanning
      touches={{ ONE: free ? TOUCH.ROTATE : TOUCH.PAN, TWO: free ? TOUCH.DOLLY_PAN : TOUCH.DOLLY_ROTATE }}
      minPolarAngle={free ? 1 * DEG : polar}
      maxPolarAngle={free ? 179 * DEG : polar}
      minAzimuthAngle={free ? -89 * DEG : 0}
      maxAzimuthAngle={free ? 89 * DEG : 0}
      // The fixed camera can pinch / wheel in for a closer look, but never further out than the fit.
      minDistance={free ? 0.2 : enableZoom ? distance * MIN_ZOOM : distance}
      maxDistance={free ? 100 : distance}
      onChange={(e) => {
        // Keep the board on screen when panning with the fixed camera.
        const c = e?.target as typeof controls.current | undefined;
        const target = c?.target;
        if (!c || !target || free) return;
        // Zoomed in, panning reaches further so the whole board stays reachable.
        const zoomed = Math.max(0, Math.min(1, (distance - c.getDistance()) / (distance * (1 - MIN_ZOOM))));
        const range = size / 3 + (size / 6) * zoomed;
        target.x = Math.max(-range, Math.min(range, target.x));
        target.y = Math.max(-range, Math.min(range, target.y));
        target.z = Math.max(-range, Math.min(range, target.z));
      }}
    />
  );
}

/**
 * The 3D scene. It subscribes to settings only, never to game state, so playing never re-renders it.
 * It renders on demand: a frame is drawn only when something changed or is animating, so an idle
 * board costs no GPU time (and no battery).
 */
function Scene() {
  const showStats = useUIStore((s) => s.show3jsStats);
  const lowPower = useUIStore((s) => s.lowPower);

  return (
    <Canvas className="canvas" frameloop="demand" camera={{ fov: FOV }} dpr={lowPower ? [1, 1.5] : [1, 2]} onCreated={({ gl }) => { watchRenderer(gl.getContext(), gl.domElement); bindRenderer(gl); }}>
      <color attach="background" args={["black"]} />
      <ambientLight intensity={5} />
      <Suspense fallback={null}>
        <GameBoard />
      </Suspense>
      {/* Outside the board's group: it is held in front of the camera, not on the table. */}
      <FusionSequence />
      <Camera />
      <RenderOnChange />
      {showStats && <Perf style={{ position: "absolute", top: 0, left: "30%", transform: "translateX(-50%)", width: "20rem" }} />}
    </Canvas>
  );
}

export default function App() {
  const showControlPanel = useUIStore((s) => s.showControlPanel);
  const setShowControlPanel = useUIStore((s) => s.setShowControlPanel);
  const showFPS = useUIStore((s) => s.showFPS);
  const status = useGameStore((s) => s.status);
  const inGame = useGameStore((s) => s.view !== null);
  const menuScreen = useMenuStore((s) => s.screen);
  // With an arena display in the room, the board is on the display and phones are controllers.
  const role = useGameStore(selectRole);
  const audio = useGameAudio();
  useWakeLock(role === "display");
  // Settings belong to the start page and the duel: the deck builder, map editor and
  // other menu screens have no gear (and no settings panel left open over them).
  const settingsHere = status !== "idle" || menuScreen === "lobby";

  // Input sources and the interaction machine are wired once for the page.
  useEffect(() => {
    startInteraction();
    startDisplaySync();
    const stopKeyboard = startKeyboard();
    const stopGamepad = startGamepad();
    return () => { stopKeyboard(); stopGamepad(); };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 h-[var(--app-h,100dvh)] w-full overflow-hidden bg-black">
      {/* The board is always there: an empty field behind the menu, the duel once one starts.
          A controller has none: the board is on the arena display. */}
      {!(inGame && role === "controller") && <Scene />}

      {status === "idle" && (menuScreen === "lobby" ? <Lobby /> : menuScreen === "admin" ? <AdminDashboard /> : menuScreen === "profile" ? <ProfilePage /> : <Builder />)}
      {status !== "idle" && !inGame && <WaitingRoom onLeave={leave} />}

      {inGame && role === "controller" && (
        <>
          <Controller />
          <ChoiceDialog />
          <GraveyardView />
          <PausedOverlay />
          <GameOver onLeave={leave} />
          <CardPreview />
          <TilePreview />
        </>
      )}

      {inGame && role === "display" && (
        <>
          <Hud />
          <EventLog />
          <FusionSkip />
          <DestinyBanner />
          <ActivationFlash />
          <PausedOverlay />
          <GameOver onLeave={leave} />
          <DisplayBadge />
        </>
      )}

      {inGame && role === "board" && (
        <>
          <Hud />
          <EventLog />
          <AdminPanel />
          <ThinkingPanel />
          <TestTools />
          <FocusPortals />
          <HandView />
          <ActionBar />
          <TurnRow />
          <ChoiceDialog />
          <FusionSkip />
          <GraveyardView />
          <DestinyBanner />
          <ActivationFlash />
          <PausedOverlay />
          <GameOver onLeave={leave} />
          <CardPreview />
          <TilePreview />
        </>
      )}

      {/* In a duel on phones and tablets the gear sits under your own HUD panel, and this one
          only shows to close the open panel. Desktops keep it here, in the top-right corner. */}
      {settingsHere && <button
        onClick={() => setShowControlPanel(!showControlPanel)}
        className={`fixed right-[max(0.5rem,env(safe-area-inset-right))] top-(--hud-top) z-[70] ${inGame && !showControlPanel ? "hidden lg:flex" : "flex"} h-9 w-9 items-center justify-center  border border-white/20 bg-black/80 text-sm text-white hover:border-yellow-500 pointer-coarse:h-11 pointer-coarse:w-11`}
        title="Settings"
        aria-label="Settings"
      >
        {showControlPanel ? "⚔️" : "⚙️"}
      </button>}
      {settingsHere && showControlPanel && (
        <div className="absolute top-0 z-[60] flex h-full w-full justify-end md:pointer-events-none">
          <ControlPanel controlsRef={{ current: null }} {...audio} />
        </div>
      )}
      <div className="absolute left-2 top-2 z-[70] hidden flex-row gap-2 xl:flex">
        {showFPS && <FPSCounter style="minimal" />}
        <MusicToggle isPlaying={audio.isPlaying} volume={audio.volume} toggleMusic={audio.toggleMusic} setVolume={audio.setVolume} style="minimal" />
      </div>
    </div>
  );
}
