import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768; // Matching Tailwind's 'md' breakpoint

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Media query matching is more performant than resize listeners
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    // Set initial value
    setIsMobile(mediaQuery.matches);

    // Handler for changes
    const handler = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    // Listen for changes
    mediaQuery.addEventListener('change', handler);

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, []);

  return isMobile;
}

export function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsLandscape(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}

export function useIsMobileLandscape() {
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);

  useEffect(() => {
    // Check for landscape orientation AND height typical of mobile devices
    // Using max-height similar to the max-width breakpoint
    const mediaQuery = window.matchMedia(`(orientation: landscape) and (max-height: ${MOBILE_BREAKPOINT}px)`);

    setIsMobileLandscape(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsMobileLandscape(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isMobileLandscape;
}
