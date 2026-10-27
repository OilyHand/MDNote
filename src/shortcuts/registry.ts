// Keyboard shortcuts and commands (O8). One table drives the key handling, the
// menu labels and the F1 shortcut list, so they can never disagree.
//
// Each command's label is the translation `commands.<id>`.

export type CommandGroup =
  "file" | "edit" | "format" | "paragraph" | "insert" | "table" | "styles" | "view";

export interface CommandSpec {
  /** Key combinations; the first one is shown in menus. */
  keys: string[];
  group: CommandGroup;
  /**
   * Handled by the source editor while it has focus. Such a command may decline
   * (Tab outside a list or table), and the key then does what it normally does.
   */
  editor?: boolean;
  /** The browser or CodeMirror already handles the keys; listed for menus and F1 only. */
  native?: boolean;
  /** Shown instead of `keys` (a translation key), for gestures such as Ctrl+wheel. */
  display?: string;
}

const file = (keys: string[] = []): CommandSpec => ({ keys, group: "file" });
const edit = (keys: string[] = []): CommandSpec => ({ keys, group: "edit", editor: true });
const format = (keys: string[] = []): CommandSpec => ({ keys, group: "format", editor: true });
const paragraph = (keys: string[] = []): CommandSpec => ({
  keys,
  group: "paragraph",
  editor: true,
});
const insert = (keys: string[] = []): CommandSpec => ({ keys, group: "insert", editor: true });
const table = (keys: string[] = []): CommandSpec => ({ keys, group: "table", editor: true });
const view = (keys: string[] = []): CommandSpec => ({ keys, group: "view" });
/** Styles and page setup (O4, O9, O19): they work wherever the focus is. */
const styles = (keys: string[] = []): CommandSpec => ({ keys, group: "styles" });

export const COMMANDS = {
  "file.new": file(["Ctrl+N"]),
  "file.open": file(["Ctrl+O"]),
  "file.openFolder": file(["Ctrl+Shift+O"]),
  "file.closeFolder": file(),
  "file.save": file(["Ctrl+S"]),
  "file.saveAs": file(["F12", "Ctrl+Shift+S"]),
  "file.print": file(["Ctrl+P"]),
  "file.closeTab": file(["Ctrl+W", "Ctrl+F4"]),
  "file.moveToNewWindow": file(),
  "tab.next": file(["Ctrl+Tab"]),
  "tab.previous": file(["Ctrl+Shift+Tab"]),
  "file.preferences": file(["Ctrl+,"]),
  "file.closeWindow": { ...file(["Alt+F4"]), native: true },
  "file.exit": file(),

  "edit.undo": { ...edit(["Ctrl+Z"]), native: true },
  "edit.redo": { ...edit(["Ctrl+Y"]), native: true },
  "edit.cut": { ...edit(["Ctrl+X"]), native: true },
  "edit.copy": { ...edit(["Ctrl+C"]), native: true },
  "edit.paste": { ...edit(["Ctrl+V"]), native: true },
  "edit.selectAll": { ...edit(["Ctrl+A"]), native: true },
  // Find and Go To also work while the preview has focus: they bring the editor forward.
  "edit.find": { keys: ["Ctrl+F"], group: "edit" },
  "edit.replace": { keys: ["Ctrl+H"], group: "edit" },
  "edit.goToLine": { keys: ["Ctrl+G"], group: "edit" },
  "edit.moveLineUp": edit(["Alt+Shift+ArrowUp"]),
  "edit.moveLineDown": edit(["Alt+Shift+ArrowDown"]),

  "format.bold": format(["Ctrl+B"]),
  "format.italic": format(["Ctrl+I"]),
  "format.underline": format(["Ctrl+U"]),
  "format.strikethrough": format(["Ctrl+Shift+X"]),
  "format.code": format(["Ctrl+`"]),
  // Word's Unlink.
  "format.removeLink": format(["Ctrl+Shift+F9"]),

  "paragraph.heading1": paragraph(["Ctrl+Alt+1"]),
  "paragraph.heading2": paragraph(["Ctrl+Alt+2"]),
  "paragraph.heading3": paragraph(["Ctrl+Alt+3"]),
  "paragraph.heading4": paragraph(["Ctrl+Alt+4"]),
  "paragraph.heading5": paragraph(["Ctrl+Alt+5"]),
  "paragraph.heading6": paragraph(["Ctrl+Alt+6"]),
  "paragraph.normal": paragraph(["Ctrl+Shift+N"]),
  "paragraph.bulletList": paragraph(["Ctrl+Shift+L"]),
  "paragraph.numberedList": paragraph(["Ctrl+Shift+7"]),
  "paragraph.taskList": paragraph(),
  "paragraph.quote": paragraph(["Ctrl+Shift+Q"]),
  "paragraph.codeBlock": paragraph(["Ctrl+Shift+`"]),
  // Tab is shared: a table cell first, then a list item, otherwise a tab character.
  "table.nextCell": table(["Tab"]),
  "table.previousCell": table(["Shift+Tab"]),
  "paragraph.indent": paragraph(["Tab"]),
  "paragraph.outdent": paragraph(["Shift+Tab"]),

  "insert.link": insert(["Ctrl+K"]),
  "insert.image": insert(),
  "insert.table": insert(),
  // Alt+= as in Word; Ctrl+Shift+M (as in Typora) for when an IME keeps Alt+=.
  "insert.equation": insert(["Alt+=", "Ctrl+Shift+M"]),
  "insert.pageBreak": insert(["Ctrl+Enter"]),

  "table.insertRowAbove": table(),
  "table.insertRowBelow": table(),
  "table.insertColumnLeft": table(),
  "table.insertColumnRight": table(),
  "table.deleteRow": table(),
  "table.deleteColumn": table(),
  "table.delete": table(),
  "table.alignLeft": table(),
  "table.alignCenter": table(),
  "table.alignRight": table(),
  "table.format": table(),

  "styles.sets": styles(),
  "styles.saveSet": styles(),
  "styles.pane": styles(),
  "styles.modify": styles(),
  // Word's Ctrl+] and Ctrl+[, for the section type at the cursor (O8).
  "styles.grow": styles(["Ctrl+]"]),
  "styles.shrink": styles(["Ctrl+["]),
  "styles.setDefault": styles(),
  "styles.reset": styles(),
  "layout.pageSetup": styles(),

  "view.split": view(),
  "view.source": view(),
  "view.preview": view(),
  "view.zoomIn": { ...view(), display: "keys.ctrlWheelUp" },
  "view.zoomOut": { ...view(), display: "keys.ctrlWheelDown" },
  "view.actualSize": view(),
  "view.fitWidth": view(),
  "view.sidebar": view(),
  // Word's Ctrl+Alt+P switches to Print Layout; here it also switches back.
  "view.printLayout": view(["Ctrl+Alt+P"]),
  "view.ruler": view(),
  "view.statusBar": view(),
  "view.shortcuts": view(["F1"]),
} satisfies Record<string, CommandSpec>;

export type CommandId = keyof typeof COMMANDS;

const spec = (id: CommandId): CommandSpec => COMMANDS[id];
const ALL_IDS = Object.keys(COMMANDS) as CommandId[];

/** Commands the window handles itself, wherever the focus is. */
export const WINDOW_COMMANDS = ALL_IDS.filter((id) => !spec(id).editor && !spec(id).native);

/** Commands the source editor handles while it has focus. */
export const EDITOR_COMMANDS = ALL_IDS.filter((id) => spec(id).editor && !spec(id).native);

type KeyInfo = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey">;

/** Physical keys whose character changes with Shift or the keyboard layout. */
const CODE_NAMES: Record<string, string> = {
  Comma: ",",
  Backquote: "`",
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  NumpadEnter: "Enter",
};

/**
 * Letters and digits are read from the physical key (`code`), because with the
 * Korean IME on, `key` holds a Hangul letter (Ctrl+S arrives as "ㄴ"), and with
 * Shift held, `key` holds the shifted character (Ctrl+Shift+7 arrives as "&").
 */
function keyName(event: KeyInfo): string {
  const code = event.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

/** "Ctrl+Shift+S" for a key event, using the same spelling as COMMANDS. */
export function comboOf(event: KeyInfo) {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(keyName(event));
  return parts.join("+");
}

/** Every command among `commands` bound to the key event, in table order. */
export function commandsFor(event: KeyInfo, commands: CommandId[]): CommandId[] {
  const combo = comboOf(event);
  return commands.filter((id) => spec(id).keys.includes(combo));
}

/** The window command bound to a key event, if any. */
export function commandFor(event: KeyInfo): CommandId | undefined {
  return commandsFor(event, WINDOW_COMMANDS)[0];
}

const KEY_LABELS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓" };

/** How a key combination is written for people: "Alt+Shift+↑". */
export function keyLabel(combo: string): string {
  return combo
    .split("+")
    .map((part) => KEY_LABELS[part] ?? part)
    .join("+");
}

/** The first key combination, as shown next to a menu item. */
export function shortcutLabel(id: CommandId): string | undefined {
  const first = spec(id).keys[0];
  return first ? keyLabel(first) : undefined;
}
