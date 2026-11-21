import { useEffect, useRef, useState } from "react";
import { trackTitle, type MusicControls } from "@/hooks/useGameAudio";

type MusicToggleProps = Pick<MusicControls, 'isPlaying' | 'volume' | 'toggleMusic' | 'setVolume' | 'tracks' | 'track' | 'choice' | 'chooseTrack' | 'skipTrack'> & {
  /** minimal: the dropdown floats over the page; full: it opens inline (inside a panel). */
  style: 'minimal' | 'full';
};

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center text-white hover:text-yellow-500 transition-colors pointer-coarse:h-10 pointer-coarse:w-10";

/** One compact bar (play/pause, now playing, skip, more) with the song picker and volume in a dropdown. */
export default function MusicToggle({ isPlaying, volume, toggleMusic, setVolume, tracks, track, choice, chooseTrack, skipTrack, style }: MusicToggleProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close the floating dropdown on an outside tap or Escape.
  useEffect(() => {
    if (!open || style === 'full') return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, style]);

  const title = track ? trackTitle(track) : choice ? trackTitle(choice) : 'Shuffle';
  const muted = volume === 0;

  return (
    <div ref={root} className={`relative z-50 font-mono text-sm ${style === 'full' ? 'w-full' : 'w-56'}`}>
      <div className="flex items-center border border-white/20 bg-black/80 text-white">
        <button
          onClick={toggleMusic}
          className={iconBtn}
          aria-label={isPlaying ? 'Pause soundtrack' : 'Play soundtrack'}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6 4l10 6-10 6z" /></svg>
          )}
        </button>

        <button
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 truncate px-1 text-left text-xs hover:text-yellow-500"
          title={title}
          aria-expanded={open}
          aria-label="Music options"
        >
          <span className={isPlaying ? 'text-yellow-500/90' : 'text-gray-400'}>♪</span> {title}
        </button>

        {tracks.length > 1 && (
          <button onClick={skipTrack} className={iconBtn} aria-label="Next song" title="Next song">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l8 6-8 6zM13 4h3v12h-3z" /></svg>
          </button>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          className={iconBtn}
          aria-expanded={open}
          aria-label="Music options"
          title="Music options"
        >
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M5 7l5 6 5-6z" /></svg>
        </button>
      </div>

      {open && (
        <div className={`${style === 'full' ? 'mt-1' : 'absolute left-0 top-full mt-1 w-full shadow-lg'} flex flex-col gap-2 border border-white/20 bg-black/90 p-2 text-white`}>
          {/* Song picker: a fixed track, or shuffle for a random one each duel. */}
          {tracks.length > 0 && (
            <select
              value={choice}
              onChange={(e) => chooseTrack(e.target.value)}
              className="w-full cursor-pointer border border-white/20 bg-black/60 px-1 py-1 text-xs text-white outline-none hover:border-yellow-500 focus:border-yellow-500"
              aria-label="Choose the soundtrack song"
            >
              <option value="">🎲 Shuffle</option>
              {tracks.map((name) => <option key={name} value={name}>{trackTitle(name)}</option>)}
            </select>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume * 100}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              aria-label="Music volume"
              className="h-1 flex-1 cursor-pointer appearance-none bg-gray-700 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-yellow-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-yellow-500"
            />
            <span className="w-8 text-right tabular-nums">{Math.round(volume * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
