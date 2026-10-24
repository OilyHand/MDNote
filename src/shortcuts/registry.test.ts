import { describe, expect, it } from "vitest";
import { COMMANDS, EDITOR_COMMANDS, comboOf, commandFor, commandsFor, keyLabel } from "./registry";

type Mods = Partial<{ ctrl: boolean; shift: boolean; alt: boolean }>;

const press = (key: string, code: string, mods: Mods = {}) => ({
  key,
  code,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("shortcut registry", () => {
  it("spells key events the way the table does", () => {
    expect(comboOf(press("s", "KeyS", { ctrl: true }))).toBe("Ctrl+S");
    expect(comboOf(press("S", "KeyS", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+S");
    expect(comboOf(press("F12", "F12"))).toBe("F12");
  });

  it("finds window commands, including alternate keys", () => {
    expect(commandFor(press("s", "KeyS", { ctrl: true }))).toBe("file.save");
    expect(commandFor(press("F12", "F12"))).toBe("file.saveAs");
    expect(commandFor(press("S", "KeyS", { ctrl: true, shift: true }))).toBe("file.saveAs");
    expect(commandFor(press(",", "Comma", { ctrl: true }))).toBe("file.preferences");
    expect(commandFor(press("Tab", "Tab", { ctrl: true, shift: true }))).toBe("tab.previous");
  });

  it("works while the Korean IME turns letters into Hangul", () => {
    expect(commandFor(press("ㄴ", "KeyS", { ctrl: true }))).toBe("file.save");
    expect(commandFor(press("ㅜ", "KeyN", { ctrl: true }))).toBe("file.new");
  });

  it("leaves editing keys to the editor", () => {
    expect(commandFor(press("z", "KeyZ", { ctrl: true }))).toBeUndefined();
    expect(commandFor(press("b", "KeyB", { ctrl: true }))).toBeUndefined();
  });

  it("reads shifted and punctuation keys from the physical key", () => {
    const editor = (event: ReturnType<typeof press>) => commandsFor(event, EDITOR_COMMANDS);
    expect(editor(press("&", "Digit7", { ctrl: true, shift: true }))).toEqual([
      "paragraph.numberedList",
    ]);
    expect(editor(press("~", "Backquote", { ctrl: true, shift: true }))).toEqual([
      "paragraph.codeBlock",
    ]);
    expect(editor(press("`", "Backquote", { ctrl: true }))).toEqual(["format.code"]);
    expect(editor(press("=", "Equal", { alt: true }))).toEqual(["insert.equation"]);
    expect(editor(press("M", "KeyM", { ctrl: true, shift: true }))).toEqual(["insert.equation"]);
    expect(editor(press("1", "Digit1", { ctrl: true, alt: true }))).toEqual(["paragraph.heading1"]);
    expect(editor(press("ArrowUp", "ArrowUp", { alt: true, shift: true }))).toEqual([
      "edit.moveLineUp",
    ]);
    expect(editor(press("Enter", "NumpadEnter", { ctrl: true }))).toEqual(["insert.pageBreak"]);
  });

  it("reads function keys with modifiers, such as Word's Unlink", () => {
    expect(commandsFor(press("F9", "F9", { ctrl: true, shift: true }), EDITOR_COMMANDS)).toEqual([
      "format.removeLink",
    ]);
  });

  it("tries a table cell before a list item for Tab", () => {
    expect(commandsFor(press("Tab", "Tab"), EDITOR_COMMANDS)).toEqual([
      "table.nextCell",
      "paragraph.indent",
    ]);
  });

  it("binds every other key combination to one command only", () => {
    const owners = new Map<string, string[]>();
    for (const [id, spec] of Object.entries(COMMANDS)) {
      for (const key of spec.keys) owners.set(key, [...(owners.get(key) ?? []), id]);
    }
    const shared = [...owners].filter(([, ids]) => ids.length > 1).map(([key]) => key);
    expect(shared.sort()).toEqual(["Shift+Tab", "Tab"]);
  });

  it("writes arrow keys as arrows", () => {
    expect(keyLabel("Alt+Shift+ArrowDown")).toBe("Alt+Shift+↓");
  });
});
