import { useState } from 'react';
import { DEFAULT_KEYBINDINGS } from '@/const';
import type { KeyBindings } from '@/types';

export const useKeyBindings = () => {
  const [keyBindings, setKeyBindings] = useState(() => {
      const saved = localStorage.getItem('keyBindings');
      return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS;
  });
  const updateKeyBindings = (bindings: KeyBindings) => {
    setKeyBindings(bindings);
    localStorage.setItem('keyBindings', JSON.stringify(bindings));
  }
  return {keyBindings, updateKeyBindings};
}