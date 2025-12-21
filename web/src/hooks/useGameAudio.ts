import { useEffect, useRef, useState } from 'react';
import { ASSET_URL } from '@/const';

// Load saved volume from localStorage or use default
const loadSavedVolume = (): number => {
  const saved = localStorage.getItem('musicVolume');
  if (saved) {
    const parsed = parseFloat(saved);
    return !isNaN(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.7;
  }
  return 0.7; // Default 70%
};

export function useGameAudio() {
  const starterAudioRef = useRef<HTMLAudioElement | null>(null);
  const loopAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(loadSavedVolume());
  const hasInitializedRef = useRef(false);
  const loopTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Only initialize once per session
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    // Create audio elements
    const starterAudio = new Audio(ASSET_URL + '/audio/VS_Yorkists_Starter.mp3');
    const loopAudio = new Audio(ASSET_URL + '/audio/VS_Yorkists_Loop.mp3');

    // Preload both audio files
    starterAudio.preload = 'auto';
    loopAudio.preload = 'auto';

    starterAudioRef.current = starterAudio;
    loopAudioRef.current = loopAudio;

    // Configure loop audio
    loopAudio.loop = true;
    loopAudio.volume = volume;

    // Set starter audio volume
    starterAudio.volume = volume;

    // Log when audio files are loaded
    starterAudio.addEventListener('loadeddata', () => {
      console.log('Starter audio loaded, duration:', starterAudio.duration);
    });

    loopAudio.addEventListener('loadeddata', () => {
      console.log('Loop audio loaded, duration:', loopAudio.duration);
    });

    // Cleanup
    return () => {
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
      }
      starterAudio.pause();
      loopAudio.pause();
    };
  }, []);

  // Update volume when it changes and save to localStorage
  useEffect(() => {
    if (starterAudioRef.current) {
      starterAudioRef.current.volume = volume;
    }
    if (loopAudioRef.current) {
      loopAudioRef.current.volume = volume;
    }

    // Save to localStorage
    localStorage.setItem('musicVolume', volume.toString());
  }, [volume]);

  const startLoopAudio = () => {
    const loopAudio = loopAudioRef.current;
    if (!loopAudio) return;

    console.log('Starting loop audio...');
    loopAudio.currentTime = 0;
    loopAudio.play()
      .then(() => {
        console.log('Loop audio playing successfully');
      })
      .catch(err => {
        console.error('Error playing loop audio:', err);
      });
  };

  const toggleMusic = () => {
    const starterAudio = starterAudioRef.current;
    const loopAudio = loopAudioRef.current;

    if (!starterAudio || !loopAudio) {
      console.error('Audio elements not initialized');
      return;
    }

    if (isPlaying) {
      console.log('Pausing music');
      // Pause both
      starterAudio.pause();
      loopAudio.pause();
      setIsPlaying(false);

      // Clear timeout if music is paused
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
        loopTimeoutRef.current = null;
      }
    } else {
      console.log('Starting music');

      // Reset to beginning
      starterAudio.currentTime = 0;
      loopAudio.currentTime = 0;

      // Clear any existing timeout
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
      }

      // Set up one-time 'ended' event listener
      const handleEnded = () => {
        console.log('Starter audio ended event fired');
        startLoopAudio();
        starterAudio.removeEventListener('ended', handleEnded);
      };

      starterAudio.addEventListener('ended', handleEnded);

      // Also set timeout as backup
      const duration = starterAudio.duration;
      console.log('Starter duration:', duration, 'Setting timeout for:', (duration * 995));

      if (duration && !isNaN(duration)) {
        loopTimeoutRef.current = window.setTimeout(() => {
          console.log('Timeout triggered - starting loop audio', duration);
          startLoopAudio();
        }, (duration * 995));
      } else {
        console.warn('Starter duration not available, using fallback 5 second timeout');
        // Fallback if duration isn't available yet
        loopTimeoutRef.current = window.setTimeout(() => {
          console.log('Fallback timeout triggered - starting loop audio');
          startLoopAudio();
        }, 1000);
      }

      // Play starter audio
      starterAudio.play()
        .then(() => {
          console.log('Starter audio playing successfully');
        })
        .catch(err => {
          console.error('Error playing starter audio:', err);
        });

      setIsPlaying(true);
    }
  };

  return {
    isPlaying,
    volume,
    toggleMusic,
    setVolume,
    starterAudio: starterAudioRef.current,
    loopAudio: loopAudioRef.current
  };
}
