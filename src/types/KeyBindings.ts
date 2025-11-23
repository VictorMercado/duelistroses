export interface KeyBindings {
  select: string;           // Default: "k"
  cancel: string[];         // Default: ["l", "Escape"]
  playCard: string;         // Default: "j" (placeholder)
  viewDetails: string;      // Default: "i"
  flipCard: string;         // Default: "o"
  changePosition: string;   // Default: "u"
  cursorUp: string;         // Default: "w"
  cursorDown: string;       // Default: "s"
  cursorLeft: string;       // Default: "a"
  cursorRight: string;      // Default: "d"
}

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  select: "k",
  cancel: ["l", "Escape"],
  playCard: "j",
  viewDetails: "i",
  flipCard: "o",
  changePosition: "u",
  cursorUp: "w",
  cursorDown: "s",
  cursorLeft: "a",
  cursorRight: "d"
};
