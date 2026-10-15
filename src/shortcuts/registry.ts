// Keyboard shortcuts (O8). One table drives the key handling, the menu labels and,
// from Phase 3, the F1 shortcut list, so they can never disagree.
// Phases 1–2 cover the File, tab and view commands; editing shortcuts come in Phase 3.

export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.closeTab"
  | "file.print"
  | "file.preferences"
  | "tab.next"
  | "tab.previous"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.selectAll";

/** Key combinations per command; the first one is shown in menus. */
export const SHORTCUTS: Record<CommandId, string[]> = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["F12", "Ctrl+Shift+S"],
  "file.closeTab": ["Ctrl+W", "Ctrl+F4"],
  "file.print": ["Ctrl+P"],
  "file.preferences": ["Ctrl+,"],
  "tab.next": ["Ctrl+Tab"],
  "tab.previous": ["Ctrl+Shift+Tab"],
  "edit.undo": ["Ctrl+Z"],
  "edit.redo": ["Ctrl+Y"],
  "edit.cut": ["Ctrl+X"],
  "edit.copy": ["Ctrl+C"],
  "edit.paste": ["Ctrl+V"],
  "edit.selectAll": ["Ctrl+A"],
};

/** Commands the window handles itself; the editor handles the "edit.*" keys. */
export const WINDOW_COMMANDS: CommandId[] = [
  "file.new",
  "file.open",
  "file.save",
  "file.saveAs",
  "file.closeTab",
  "file.print",
  "file.preferences",
  "tab.next",
  "tab.previous",
];

type KeyInfo = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey">;

const KEY_NAMES: Record<string, string> = { ",": "Comma" };

/**
 * Letters and digits are read from the physical key (`code`), because with the
 * Korean IME on, `key` holds a Hangul letter (Ctrl+S arrives as "ㄴ").
 */
function keyName(event: KeyInfo): string {
  const code = event.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Comma") return "Comma";
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return KEY_NAMES[key] ?? key;
}

/** "Ctrl+Shift+S" for a key event, using the same spelling as SHORTCUTS. */
export function comboOf(event: KeyInfo) {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(keyName(event));
  return parts.join("+");
}

/** The command bound to a key event, if any. */
export function commandFor(
  event: KeyInfo,
  commands: CommandId[] = WINDOW_COMMANDS,
): CommandId | undefined {
  const combo = comboOf(event);
  return commands.find((id) => SHORTCUTS[id].some((s) => s.replace("+,", "+Comma") === combo));
}

export function shortcutLabel(id: CommandId): string {
  return SHORTCUTS[id][0];
}
