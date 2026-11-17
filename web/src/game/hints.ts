import { TERRAINS } from '@/const';
import type { Mode } from '@/game/interaction';
import type { InputAction } from '@/input/actions';

// Helpers shared by the duel's overlays (GameOverlays) and the phone
// controller (Controller): what the buttons say and do, and how they look.

export const terrainOf = (name: string) => TERRAINS.find((t) => t.type === name) ?? TERRAINS.find((t) => t.type === 'normal')!;

/** A button in the action bar: an input action, or COMMIT (confirm the picked-up card's staged change). */
export type Hint = [InputAction | "COMMIT", string];

// End turn has its own button (TurnRow), so it is never in the bar.
export function hintsFor(mode: Mode, choosing: boolean, toDefense: boolean, myTurn: boolean): Hint[] {
  if (choosing) return [["CONFIRM", "Choose"], ["DETAILS", "Inspect"]];
  switch (mode.kind) {
    case "card": {
      const staged = mode.flip || mode.switchPosition;
      return [
        ["CONFIRM", toDefense ? "Confirm on card" : staged ? "Move / confirm on card" : "Move / attack"],
        ["FLIP", mode.flip ? "Flip: ON" : "Flip / activate"],
        ["POSITION", mode.switchPosition ? (toDefense ? "Defense: ON" : "Attack: ON") : "Atk / def"],
        ["DETAILS", "Inspect"],
        ["CANCEL", "Back"],
        ["COMMIT", "Confirm"],
      ];
    }
    case "leader": return [["CONFIRM", "Step / summon"], ["HAND", "Summon"], ["CANCEL", "Back"]];
    case "place": return [["CONFIRM", "Summon here"], ["CANCEL", "Back"]];
    case "grave": return [["DOWN", "Next graveyard"], ["DETAILS", "Inspect"], ["CANCEL", "Close"]];
    case "hand": return mode.target
      ? [["CONFIRM", "Play"], ["UP", "Mark to fuse"], ["DETAILS", "Inspect"], ["CANCEL", "Back"]]
      : [["DETAILS", "Inspect"], ["CANCEL", "Close"]];
    default: return myTurn
      ? [["CONFIRM", "Pick up"], ["HAND", "Summon"], ["NEXT", "Next piece"], ["DETAILS", "Inspect"], ["GRAVE", "Graveyard"]]
      : [["HAND", "Hand"], ["DETAILS", "Inspect"], ["GRAVE", "Graveyard"]];
  }
}

const BLUE = "border-sky-400/60 bg-sky-800/90 hover:bg-sky-700 active:bg-sky-600";
const RED = "border-red-400/60 bg-red-900/90 hover:bg-red-800 active:bg-red-700";
const YELLOW = "border-yellow-400/60 bg-yellow-700/90 hover:bg-yellow-600 active:bg-yellow-500";
const PLAIN = "border-white/20 bg-black/70 hover:border-yellow-400 active:border-yellow-400 active:bg-yellow-900/50";

/** Colors by what the button does: summon and play blue, back / close / cancel red, inspect yellow. */
export function buttonColor(action: Hint[0], text: string): string {
  if (action === "COMMIT") return "border-yellow-400/70 bg-yellow-900/70 font-bold hover:bg-yellow-800";
  if (action === "CANCEL") return RED;
  if (action === "DETAILS") return YELLOW;
  if (text === "Play" || text.startsWith("Summon")) return BLUE;
  return PLAIN;
}

/**
 * Keeps --bar-h (which the turn row, the previews and the log sit above) equal
 * to the bar's real height: it grows a row when the strength chip shows. Off
 * the bar, the stylesheet's default applies again.
 */
let barObserver: ResizeObserver | null = null;
export function trackBarHeight(el: HTMLDivElement | null) {
  barObserver?.disconnect();
  barObserver = null;
  const root = document.documentElement.style;
  if (!el) { root.removeProperty("--bar-h"); return; }
  barObserver = new ResizeObserver(() => root.setProperty("--bar-h", `${el.offsetHeight}px`));
  barObserver.observe(el);
}

