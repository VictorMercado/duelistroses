import { DEFAULT_KEYBINDINGS } from '@/const';
import type { KeyBindings } from '@/types';
import { emit, type InputAction } from './actions';

/** Bindings are editable in the settings panel and saved in localStorage. */
export function loadKeyBindings(): KeyBindings {
  try {
    const saved = localStorage.getItem('keyBindings');
    return saved ? { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) } : DEFAULT_KEYBINDINGS;
  } catch {
    return DEFAULT_KEYBINDINGS;
  }
}

/** Keys that always work, whatever the bindings say. */
const FIXED: Record<string, InputAction> = {
  arrowup: 'UP', arrowdown: 'DOWN', arrowleft: 'LEFT', arrowright: 'RIGHT',
  enter: 'CONFIRM', ' ': 'END_TURN', escape: 'CANCEL', backspace: 'CANCEL',
  tab: 'NEXT', ']': 'NEXT', '[': 'PREV', g: 'GRAVE',
};

export function keyFor(action: InputAction, bindings = loadKeyBindings()): string {
  const bound: Partial<Record<InputAction, string>> = {
    UP: bindings.cursorUp, DOWN: bindings.cursorDown, LEFT: bindings.cursorLeft, RIGHT: bindings.cursorRight,
    CONFIRM: bindings.select, CANCEL: bindings.cancel[0], HAND: bindings.playCard, DETAILS: bindings.viewDetails,
    FLIP: bindings.flipCard, POSITION: bindings.changePosition, END_TURN: bindings.endTurn,
    NEXT: 'Tab', PREV: '[', GRAVE: 'g',
  };
  return bound[action] ?? '';
}

function lookup(event: KeyboardEvent): InputAction | null {
  const key = event.key.toLowerCase();
  if (key === 'tab' && event.shiftKey) return 'PREV';
  const bindings = loadKeyBindings();
  const actions: InputAction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'CONFIRM', 'HAND', 'DETAILS', 'FLIP', 'POSITION', 'END_TURN'];
  for (const action of actions) {
    if (keyFor(action, bindings).toLowerCase() === key) return action;
  }
  if (bindings.cancel.some((bound) => bound.toLowerCase() === key)) return 'CANCEL';
  return FIXED[key] ?? null;
}

export function startKeyboard(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // Leave typing alone, and browser shortcuts.
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = lookup(event);
    if (!action) return;
    event.preventDefault();
    // Holding a key down must not end the next turn too.
    if (action === 'END_TURN' && event.repeat) return;
    emit(action, 'keyboard');
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
