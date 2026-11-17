import { reportError } from '@/net/errorReport';
import { ASSET_URL } from '@/const';
import { selectRole, useGameStore } from '@/stores/gameStore';

const FILES = {
  move: 'movement.wav', select: 'select.wav', blip: 'blip.wav', cant: 'youcant.wav', cancel: 'cancel.wav', infoUp: 'infoup.wav',
  destroyed: 'destroyed.wav', spell: 'magic1.wav', trap: 'trap.wav', powerup: 'powerup.wav',
  bind: 'paralyzepotion.wav', terrain: 'alterTerrain.wav',
  cleanboard: 'cleanboard.wav', endTurn: 'endturn.wav', cardIn: 'cardin.wav', bonk: 'cardbonk.wav', flip: 'flip.wav',
  lifePoints: 'lifepoints.wav', lifeAttack: 'fireInflictLifePoints.wav', hurt: 'hurt.wav',
} as const;

export type Sfx = keyof typeof FILES;

/**
 * Where a sound belongs, for a room with an arena display (see ScreenRole):
 *
 *   field  what happens on the board: steps, summons, battles, spells, the
 *          turn ending. Everyone at the table hears it, so it plays on the
 *          display.
 *   hand   one player's own controls: moving through the hand, marking cards
 *          to fuse, picking a piece up, an order the game refused, their turn
 *          coming round. It plays on that player's phone (which also buzzes).
 *
 * Without a display every screen is a board and plays both. A call can name
 * the channel when a sound is used for something unusual; otherwise each
 * sound has its own, below. A new sound must be given one.
 */
export type SfxChannel = 'field' | 'hand';

const CHANNEL: Record<Sfx, SfxChannel> = {
  move: 'field', destroyed: 'field', spell: 'field', trap: 'field', powerup: 'field', bind: 'field',
  terrain: 'field', cleanboard: 'field', endTurn: 'field', cardIn: 'field', bonk: 'field',
  lifePoints: 'field', lifeAttack: 'field', hurt: 'field',
  select: 'hand', blip: 'hand', cant: 'hand', cancel: 'hand', infoUp: 'hand', flip: 'hand',
};

/** How a controller buzzes along with its hand sounds (ms on, off, on...). Phones without vibration ignore it. */
const BUZZ: Partial<Record<Sfx, number[]>> = { cant: [35, 40, 35], cancel: [10], select: [12], flip: [12], blip: [6] };

/** Whether this screen plays sounds of a channel (see SfxChannel). */
function heardHere(channel: SfxChannel): boolean {
  const role = selectRole(useGameStore.getState());
  return role === 'board' || (role === 'display') === (channel === 'field');
}

function buzz(name: Sfx) {
  const pattern = BUZZ[name];
  if (pattern && typeof navigator !== 'undefined' && 'vibrate' in navigator && selectRole(useGameStore.getState()) === 'controller') {
    try { navigator.vibrate(pattern); } catch { /* not allowed */ }
  }
}

/*
 * Effects play through one Web Audio context rather than <audio> elements.
 * Browsers only let a page make sound after it has been tapped, and iOS
 * Safari asks again for every new <audio> element: effects started by the
 * server's messages, not by a tap (everything a spectator hears, and the
 * opponent's moves), stayed silent. A context needs unlocking once, on the
 * first tap or key press, and then plays whatever starts it.
 */
type Ctx = AudioContext;
const AudioCtor: (new () => Ctx) | undefined = typeof window === 'undefined'
  ? undefined
  : window.AudioContext ?? (window as unknown as { webkitAudioContext?: new () => Ctx; }).webkitAudioContext;

let context: Ctx | null = null;
const buffers = new Map<Sfx, Promise<AudioBuffer | null>>();
// Without Web Audio: plain elements, as before.
const elements = new Map<Sfx, HTMLAudioElement>();

function audioContext(): Ctx | null {
  if (!AudioCtor) return null;
  context ??= new AudioCtor();
  return context;
}

function load(name: Sfx): Promise<AudioBuffer | null> {
  let buffer = buffers.get(name);
  if (!buffer) {
    const ctx = audioContext();
    buffer = !ctx ? Promise.resolve(null) : fetch(`${ASSET_URL}/audio/${FILES[name]}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      // The callback form: older Safari has no promise from decodeAudioData.
      .then((data) => new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
      .catch((error) => { buffers.delete(name); reportError('asset', `Could not load sound ${FILES[name]}: ${error}`); return null; }); // try again next time
    buffers.set(name, buffer);
  }
  return buffer;
}

// Idle, the context is suspended so it does not keep the audio hardware (and
// the battery) busy between moves; playing resumes it.
const IDLE_MS = 20_000;
let idle: ReturnType<typeof setTimeout> | null = null;
function keepAwake(ctx: Ctx) {
  if (ctx.state === 'suspended') ctx.resume().catch(() => { });
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => { if (ctx.state === 'running') ctx.suspend().catch(() => { }); }, IDLE_MS);
}

/** Unlocks sound on the first tap or key press: until then the browser keeps the page silent. */
function unlockOnGesture() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = audioContext();
    if (!ctx) return;
    // A silent sound started inside the gesture is what iOS needs to let the context play.
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
    ctx.resume().then(() => {
      keepAwake(ctx);
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
    }).catch(() => { });
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchend', unlock, true);
}
unlockOnGesture();

/** Fetches every effect now, so the first time one plays it is not late. */
export function preloadSfx() {
  for (const name of Object.keys(FILES) as Sfx[]) load(name);
}

/** Sounds that come with a lead-in: the card is hit first, then breaks 400ms later. */
const LEAD_IN: Partial<Record<Sfx, { sound: Sfx; delayMs: number; }>> = {
  destroyed: { sound: 'hurt', delayMs: 400 },
};

/**
 * Plays a short effect, if this screen plays its channel (see SfxChannel).
 * Failures (autoplay policy, missing file) are ignored.
 */
export function playSfx(name: Sfx, volume = 0.5, channel: SfxChannel = CHANNEL[name]) {
  if (!heardHere(channel)) return;
  if (channel === 'hand') buzz(name);
  const lead = LEAD_IN[name];
  if (lead) {
    playVoice(lead.sound, volume);
    setTimeout(() => playVoice(name, volume), lead.delayMs);
    return;
  }
  playVoice(name, volume);
}

function playVoice(name: Sfx, volume: number) {
  const ctx = audioContext();
  if (!ctx) { playElement(name, volume); return; }
  keepAwake(ctx);
  load(name).then((buffer) => {
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }).catch(() => { });
}

function playElement(name: Sfx, volume: number) {
  let audio = elements.get(name);
  if (!audio) {
    audio = new Audio(`${ASSET_URL}/audio/${FILES[name]}`);
    audio.preload = 'auto';
    elements.set(name, audio);
  }
  const voice = audio.cloneNode() as HTMLAudioElement;
  voice.volume = volume;
  voice.play().catch(() => { });
}

/** Sounds that accompany almost every update, and give way to anything more telling. */
const ROUTINE: Sfx[] = ['blip', 'move'];
/** A sound that covers others in the same update: a board wipe is one sound, not a pile of destructions. */
// Gaining or losing life points arrives with the spell that caused it: the life point sound says more.
const COVERS: Partial<Record<Sfx, Sfx[]>> = { cleanboard: ['destroyed', 'spell'], lifePoints: ['spell'], lifeAttack: ['spell'] };

/**
 * Plays the sounds one server update produced. Events in an update happen at
 * the same instant, so a fusion arrives with the summon or move that caused
 * it: the routine blip or step would play over the power-up and drown it out.
 * Routine sounds are dropped when anything else plays, and each sound plays once.
 */
export function playSfxBatch(sounds: [Sfx, number?][]) {
  const special = sounds.some(([name]) => !ROUTINE.includes(name));
  const covered = new Set(sounds.flatMap(([name]) => COVERS[name] ?? []));
  const played = new Set<Sfx>();
  for (const [name, volume] of sounds) {
    if ((special && ROUTINE.includes(name)) || covered.has(name) || played.has(name)) continue;
    played.add(name);
    playSfx(name, volume);
  }
}
