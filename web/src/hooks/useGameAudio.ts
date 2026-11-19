import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSET_URL, SERVER_URL } from '@/const';
import { selectRole, useGameStore } from '@/stores/gameStore';
import { Music } from '@/game/music';

/** The one music player for the page (Web Audio, so tracks join without a gap). */
const music = new Music();

/**
 * One piece of duel music, as the server lists it (paths relative to /assets):
 * an intro and a loop, or one file, with or without loop points (seconds).
 */
interface Track { name: string; intro?: string; loop: string; loopStart?: number; loopEnd?: number; }

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

/** A track's name for people: "VS_The_End" reads "VS The End". */
export const trackTitle = (name: string) => name.replace(/_/g, ' ');

/**
 * Duel music. A track starts the moment a duel begins and stops when the
 * player leaves it: the one they picked, or a random one on shuffle (an empty
 * choice). Pausing it and the pick are remembered, so a player who turned the
 * music off is not greeted by it in the next duel.
 */
export function useGameAudio() {
  // A phone used as a controller leaves the music to the arena display.
  const inGame = useGameStore((s) => s.view !== null && selectRole(s) !== 'controller');
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const [tracks, setTracks] = useState<string[]>([]);
  /** The track playing (or last played), by name. */
  const [track, setTrack] = useState('');
  /** The player's pick, by name; empty for shuffle. */
  const [choice, setChoice] = useState(() => read('musicTrack') ?? '');
  const choiceRef = useRef(choice);
  const lastTrack = useRef<string>('');
  // Bumped whenever playback changes, so a track that finished loading late
  // does not start over one chosen after it.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    music.stop();
    setIsPlaying(false);
  }, []);

  /** Plays the player's pick, or on shuffle a random track. */
  const playNext = useCallback(async () => {
    const run = ++generation.current;
    const tracks = await loadTracks();
    if (run !== generation.current || tracks.length === 0) return;
    // Shuffle never plays the same track twice in a row when there is a choice.
    const choices = tracks.length > 1 ? tracks.filter((t) => t.name !== lastTrack.current) : tracks;
    const track = tracks.find((t) => t.name === choiceRef.current) ?? choices[Math.floor(Math.random() * choices.length)];
    lastTrack.current = track.name;
    setTrack(track.name);

    try {
      // The intro, then the loop for ever, joined without a gap (see game/music).
      await music.play(track, ASSET_URL);
      if (run === generation.current) setIsPlaying(true);
    } catch {
      if (run !== generation.current) return;
      // The browser blocked playback until the page is interacted with: start on the first tap or key.
      const retry = () => {
        window.removeEventListener('pointerdown', retry);
        window.removeEventListener('keydown', retry);
        if (run !== generation.current) return;
        music.resume().then(() => run === generation.current && setIsPlaying(true)).catch(() => { });
      };
      window.addEventListener('pointerdown', retry);
      window.addEventListener('keydown', retry);
    }
  }, []);

  // The list for the picker.
  useEffect(() => {
    let live = true;
    loadTracks().then((list) => live && setTracks(list.map((t) => t.name)));
    return () => { live = false; };
  }, []);

  // A duel starting starts the music; leaving it stops it.
  useEffect(() => {
    // playNext only sets state after the track list and audio have loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (inGame && read('musicMuted') !== '1') playNext();
    return stop;
  }, [inGame, playNext, stop]);

  useEffect(() => {
    music.setVolume(volume);
    write('musicVolume', volume.toString());
  }, [volume]);

  const toggleMusic = useCallback(() => {
    if (isPlaying) {
      music.pause();
      setIsPlaying(false);
      write('musicMuted', '1');
      return;
    }
    write('musicMuted', '0');
    if (music.loaded) {
      music.resume().then(() => setIsPlaying(true)).catch(() => { });
    } else {
      playNext();
    }
  }, [isPlaying, playNext]);

  /** Picks a track by name (empty for shuffle) and, in a duel, plays it now. */
  const chooseTrack = useCallback((name: string) => {
    choiceRef.current = name;
    setChoice(name);
    write('musicTrack', name);
    if (!inGame) return;
    write('musicMuted', '0');
    playNext();
  }, [inGame, playNext]);

  return { isPlaying, volume, toggleMusic, setVolume, tracks, track, choice, chooseTrack };
}

/** What the music controls need (see MusicToggle). */
export type MusicControls = ReturnType<typeof useGameAudio>;
