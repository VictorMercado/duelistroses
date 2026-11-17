/**
 * The input layer. Every device - keyboard, gamepad, mouse, touch - is turned
 * into the same small set of actions here, and the game only ever sees those.
 * Adding a device means writing one source that calls emit(); nothing else
 * changes.
 */
export type InputAction =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
  | 'CONFIRM' | 'CANCEL'
  | 'HAND' | 'FLIP' | 'POSITION' | 'DETAILS'
  | 'NEXT' | 'PREV' | 'END_TURN' | 'GRAVE';

export type InputDevice = 'keyboard' | 'gamepad' | 'pointer';

type Handler = (action: InputAction, device: InputDevice) => void;

let handler: Handler = () => { };

export function setInputHandler(next: Handler) { handler = next; }
export function emit(action: InputAction, device: InputDevice) { handler(action, device); }

/** What to print on a button for each action, per device. */
export const GLYPHS: Record<'gamepad', Record<InputAction, string>> = {
  gamepad: {
    UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
    CONFIRM: 'A', CANCEL: 'B', FLIP: 'X', HAND: 'Y',
    POSITION: 'LT', DETAILS: 'RT', PREV: 'LB', NEXT: 'RB', END_TURN: 'Start', GRAVE: 'Back',
  },
};
