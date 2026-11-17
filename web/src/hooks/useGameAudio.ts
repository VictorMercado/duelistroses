import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSET_URL, SERVER_URL } from '@/const';
import { selectRole, useGameStore } from '@/stores/gameStore';

/** One piece of duel music, as the server lists it (paths relative to /assets). */
interface Track { name: string; intro?: string; loop: string; }

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

function savedVolume(): number {
  const parsed = parseFloat(read('musicVolume') ?? '');
  return !isNaN(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.7;
}

let tracksPromise: Promise<Track[]> | null = null;
function loadTracks(): Promise<Track[]> {
  tracksPromise ??= fetch(`${SERVER_URL}/api/music`)
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? list : []))
    .catch(() => { tracksPromise = null; return []; });
  return tracksPromise;
}

/**
 * Duel music. A random track starts the moment a duel begins and stops when
 * the player leaves it. Pausing it is remembered, so a player who turned the
 * music off is not greeted by it in the next duel.
 */
export function useGameAudio() {
  // A phone used as a controller leaves the music to the arena display.
  const inGame = useGameStore((s) => s.view !== null && selectRole(s) !== 'controller');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const audio = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(volume);
  const lastTrack = useRef<string>('');
  // Bumped whenever playback changes, so a track that finished loading late
  // does not start over one chosen after it.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    audio.current?.pause();
    audio.current = null;
    setIsPlaying(false);
  }, []);

  /** Plays a file; when the intro ends, the loop takes over and repeats. */
  const playFile = useCallback((path: string, loop: boolean, then?: () => void) => {
    const element = new Audio(`${ASSET_URL}/${path}`);
    element.loop = loop;
    element.volume = volumeRef.current;
    if (then) element.addEventListener('ended', then, { once: true });
    audio.current?.pause();
    audio.current = element;
    return element.play();
  }, []);

  const playRandom = useCallback(async () => {
    const run = ++generation.current;
    const tracks = await loadTracks();
    if (run !== generation.current || tracks.length === 0) return;
    // Never the same track twice in a row when there is a choice.
    const choices = tracks.length > 1 ? tracks.filter((t) => t.name !== lastTrack.current) : tracks;
    const track = choices[Math.floor(Math.random() * choices.length)];
    lastTrack.current = track.name;

    const start = () => track.intro
      ? playFile(track.intro, false, () => { if (run === generation.current) playFile(track.loop, true).catch(() => { }); })
      : playFile(track.loop, true);

    try {
      await start();
      if (run === generation.current) setIsPlaying(true);
    } catch {
      // The browser blocked playback until the page is interacted with: start on the first tap or key.
      const retry = () => {
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
        if (run !== generation.current) return;
        audio.current?.play().then(() => run === generation.current && setIsPlaying(true)).catch(() => { });
      };
      window.addEventListener('pointerdown', retry);
      window.addEventListener('keydown', retry);
    }
  }, [playFile]);

  // A duel starting starts the music; leaving it stops it.
  useEffect(() => {
    // playRandom only sets state after the track list and audio have loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inGame && read('musicMuted') !== '1') playRandom();
    return stop;
  }, [inGame, playRandom, stop]);

  useEffect(() => {
    volumeRef.current = volume;
    if (audio.current) audio.current.volume = volume;
    write('musicVolume', volume.toString());
  }, [volume]);

  const toggleMusic = useCallback(() => {
    if (isPlaying) {
      audio.current?.pause();
      setIsPlaying(false);
      write('musicMuted', '1');
      return;
    }
    write('musicMuted', '0');
    if (audio.current) {
      audio.current.play().then(() => setIsPlaying(true)).catch(() => { });
    } else {
      playRandom();
    }
  }, [isPlaying, playRandom]);

  return { isPlaying, volume, toggleMusic, setVolume };
}
