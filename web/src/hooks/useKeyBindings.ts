import { useState } from 'react';
import { DEFAULT_KEYBINDINGS } from '@/const';
import type { KeyBindings } from '@/types';

export const useKeyBindings = () => {
  const [keyBindings, setKeyBindings] = useState(() => {
      const saved = localStorage.getItem('keyBindings');
      // Merge over the defaults so bindings added after a user saved theirs
      // (e.g. endTurn) are still populated.
      return saved ? { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) } : DEFAULT_KEYBINDINGS;
  });
  const updateKeyBindings = (bindings: KeyBindings) => {
    setKeyBindings(bindings);
    localStorage.setItem('keyBindings', JSON.stringify(bindings));
  }
  return {keyBindings, updateKeyBindings};
}