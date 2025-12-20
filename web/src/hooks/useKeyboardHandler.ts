import { useEffect } from 'react';
import { useKeyBindings } from '@/hooks/useKeyBindings';
import { InputManager } from '@/game/InputManager';

/**
 * Consolidated keyboard handler hook that delegates to InputManager.
 */
export function useKeyboardHandler() {
  const { keyBindings } = useKeyBindings();

  useEffect(() => {
    const handleKeydownEvent = (e: KeyboardEvent) => {
      InputManager.getInstance().handleKeyboardEvent(e, keyBindings);
    };

    window.addEventListener('keydown', handleKeydownEvent);
    return () => window.removeEventListener('keydown', handleKeydownEvent);
  }, [keyBindings]);
}
;
