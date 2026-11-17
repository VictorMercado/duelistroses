import { emit, type InputAction } from './actions';

/**
 * Gamepad source. Any controller the browser exposes through the Gamepad API
 * works, wired or Bluetooth (Xbox, DualShock/DualSense, Switch Pro, 8BitDo...):
 * the "standard" mapping puts the same physical buttons at the same indexes
 * whatever the brand.
 */
const BUTTONS: Record<number, InputAction> = {
  0: 'CONFIRM', 1: 'CANCEL', 2: 'FLIP', 3: 'HAND',
  4: 'PREV', 5: 'NEXT', 6: 'POSITION', 7: 'DETAILS', 8: 'GRAVE', 9: 'END_TURN',
  12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT',
};

const DIRECTIONS = new Set<InputAction>(['UP', 'DOWN', 'LEFT', 'RIGHT']);
const STICK_THRESHOLD = 0.55;
const REPEAT_DELAY = 320; // ms held before a direction starts repeating
const REPEAT_RATE = 110;  // ms between repeats after that

export function startGamepad(): () => void {
  // When each action was first held, and when it last fired, per pad.
  const held = new Map<string, { since: number; fired: number; }>();
  let frame = 0;
  let running = false;

  const poll = (now: number) => {
    const pads = navigator.getGamepads?.() ?? [];
    let any = false;

    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      any = true;

      const down = new Set<InputAction>();
      pad.buttons.forEach((button, index) => {
        const action = BUTTONS[index];
        if (action && (button.pressed || button.value > 0.5)) down.add(action);
      });
      // Left stick doubles as the d-pad. The dominant axis wins, so a slightly
      // diagonal push does not move the cursor two ways at once.
      const [x = 0, y = 0] = pad.axes;
      if (Math.abs(x) > STICK_THRESHOLD || Math.abs(y) > STICK_THRESHOLD) {
        if (Math.abs(x) > Math.abs(y)) down.add(x > 0 ? 'RIGHT' : 'LEFT');
        else down.add(y > 0 ? 'DOWN' : 'UP');
      }

      for (const action of Object.values(BUTTONS)) {
        const key = `${pad.index}:${action}`;
        const state = held.get(key);
        if (!down.has(action)) {
          if (state) held.delete(key);
          continue;
        }
        if (!state) {
          held.set(key, { since: now, fired: now });
          emit(action, 'gamepad');
        } else if (DIRECTIONS.has(action) && now - state.since > REPEAT_DELAY && now - state.fired > REPEAT_RATE) {
          state.fired = now;
          emit(action, 'gamepad');
        }
      }
    }

    // Stop polling when the last pad is unplugged; an event restarts it.
    if (any) frame = requestAnimationFrame(poll);
    else { running = false; held.clear(); }
  };

  const start = () => {
    if (running) return;
    running = true;
    frame = requestAnimationFrame(poll);
  };

  window.addEventListener('gamepadconnected', start);
  // A pad that was already connected before the page loaded only shows up
  // after its first button press, which fires the event above.
  if ((navigator.getGamepads?.() ?? []).some((pad) => pad?.connected)) start();

  return () => {
    window.removeEventListener('gamepadconnected', start);
    cancelAnimationFrame(frame);
    running = false;
  };
}
