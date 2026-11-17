import { useEffect } from 'react';

/**
 * Keeps the screen on while `active`: a phone used as a controller, or the
 * arena display, would otherwise dim and lock mid-duel. Browsers drop the lock
 * whenever the page is hidden, so it is taken again when the page comes back.
 * Without the Screen Wake Lock API this does nothing.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const take = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((sentinel) => {
        if (stopped) sentinel.release().catch(() => { });
        else lock = sentinel;
      }).catch(() => { /* refused, e.g. battery saver */ });
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', take);
      lock?.release().catch(() => { });
    };
  }, [active]);
}
