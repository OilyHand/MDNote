import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { builtInSets, parseSetFile, setCopy, setFileText } = await import("./sets");
const { resolveStyles } = await import("./model");

describe("style sets", () => {
  it("round-trip through their files", () => {
    const styles = { heading1: { fontSize: 22, color: "#1f3864" }, body: { italic: true } };
    const text = setFileText("Mine 내 세트", styles);
    expect(parseSetFile(text)).toEqual({ name: "Mine 내 세트", styles });
    expect(parseSetFile('{"name":"x"}')).toBeNull();
    expect(parseSetFile("not json")).toBeNull();
  });

  it("are copied into a document whole, so other defaults cannot change them", () => {
    const report = builtInSets().find((s) => s.id === "builtin:report")!;
    const copy = setCopy(report);
    // Every built-in value is in the copy, not only the set's changes.
    expect(copy.heading1).toMatchObject({ fontSize: 18, bold: true, spaceBefore: 24 });
    expect(copy.codeBlock?.fontFamily).toBe("Consolas");
    const userDefaults = { heading1: { fontSize: 40 }, body: { fontSize: 20 } };
    const styles = resolveStyles({ styleSet: { name: "Report", styles: copy } }, userDefaults);
    expect(styles.heading1.fontSize).toBe(18);
    expect(styles.body.fontSize).toBe(11);
  });
});
