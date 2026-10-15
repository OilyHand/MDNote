import { describe, expect, it } from "vitest";
import { comboOf, commandFor } from "./registry";

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
});
