import { trackTitle, type MusicControls } from "@/hooks/useGameAudio";

type MusicToggleProps = Pick<MusicControls, 'isPlaying' | 'volume' | 'toggleMusic' | 'setVolume' | 'tracks' | 'track' | 'choice' | 'chooseTrack'> & {
  style: 'minimal' | 'full';
};

export default function MusicToggle({ isPlaying, volume, toggleMusic, setVolume, tracks, track, choice, chooseTrack, style }: MusicToggleProps) {
  return (
    <div className={style === 'minimal' ? 'flex flex-row z-50' : 'flex flex-col gap-2 z-50'}>
      <button
        onClick={toggleMusic}
        className="bg-black/80 text-white px-4 py-2 border border-white/20 hover:border-yellow-500 hover:bg-black/90 transition-all font-mono text-sm flex items-center gap-2"
        aria-label={isPlaying ? 'Pause SoundTrack' : 'Play SoundTrack'}
      >
        {isPlaying ? (
          <>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Pause SoundTrack</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            <span>Play SoundTrack</span>
          </>
        )}
      </button>
      
      {/* Song picker: a fixed track, or shuffle for a random one each duel. */}
      {tracks.length > 0 && (
        <label className="bg-black/80 text-white px-4 py-2 border border-white/20 font-mono text-sm flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs text-gray-400">
            <span>Song</span>
            {isPlaying && track && <span className="truncate text-yellow-500/80" title="Playing now">♪ {trackTitle(track)}</span>}
          </span>
          <select
            value={choice}
            onChange={(e) => chooseTrack(e.target.value)}
            className="w-full bg-black/60 border border-white/20 px-1 py-1 text-white outline-none hover:border-yellow-500 focus:border-yellow-500 cursor-pointer"
            aria-label="Choose the soundtrack song"
          >
            <option value="">🎲 Shuffle</option>
            {tracks.map((name) => <option key={name} value={name}>{trackTitle(name)}</option>)}
          </select>
        </label>
      )}

      {/* Volume Slider */}
      <div className="bg-black/80 text-white px-4 py-2 border border-white/20 font-mono text-sm flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>Volume</span>
          <span>{Math.round(volume * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={volume * 100}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="w-full h-1 bg-gray-700 appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-yellow-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-yellow-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />
      </div>
    </div>
  );
}
