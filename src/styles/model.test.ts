import { describe, expect, it } from "vitest";
import type { FontFamily } from "../ipc";
import type { DocMeta } from "../mdmeta/schema";
import { darkModeColor, fontIndex, fontStack, lineHeight, styleSheet } from "./css";
import {
  diffFromBuiltIn,
  documentOwnStyles,
  resolveStyles,
  withStyleChanges,
  withoutStyles,
} from "./model";

const font = (name: string, lineHeight: number, monospaced = false): FontFamily => ({
  name,
  nameKo: null,
  monospaced,
  hasHangul: false,
  lineHeight,
});
const FONTS = fontIndex([
  font("Segoe UI", 1.33),
  font("Consolas", 1.171, true),
  font("Georgia", 1.136),
]);

describe("styles", () => {
  it("take what they lack from Body text", () => {
    const styles = resolveStyles({}, undefined);
    expect(styles.heading2).toMatchObject({ fontFamily: "Segoe UI", fontSize: 16, bold: true });
    expect(styles.blockquote.fontSize).toBe(12);
    // Inline styles follow the text around them instead.
    expect(styles.link).toEqual({ underline: true });
    expect(styles.inlineCode.fontFamily).toBe("Consolas");
  });

  it("follow a change to Body text unless they set the value themselves", () => {
    const meta: DocMeta = { styles: { body: { fontFamily: "Georgia", fontSize: 11 } } };
    const styles = resolveStyles(meta, undefined);
    expect(styles.heading1.fontFamily).toBe("Georgia");
    expect(styles.heading1.fontSize).toBe(20);
    expect(styles.tableCell.fontSize).toBe(11);
  });

  it("use the user's defaults, unless a style set is applied", () => {
    const user = { heading1: { fontSize: 24 } };
    expect(resolveStyles({}, user).heading1.fontSize).toBe(24);
    const withSet: DocMeta = {
      styleSet: { name: "Report", styles: { heading1: { fontSize: 22 } } },
    };
    expect(resolveStyles(withSet, user).heading1.fontSize).toBe(22);
    // The set replaces the user's defaults entirely, so the document looks the same anywhere.
    const withEmptySet: DocMeta = { styleSet: { name: "Plain", styles: {} } };
    expect(resolveStyles(withEmptySet, user).heading1.fontSize).toBe(20);
  });

  it("store only changes that differ from what the style would be anyway", () => {
    let meta = withStyleChanges({}, undefined, "heading2", { fontSize: 18, bold: true });
    expect(meta.styles).toEqual({ heading2: { fontSize: 18 } });
    meta = withStyleChanges(meta, undefined, "heading2", { fontSize: 16 });
    expect(meta.styles).toBeUndefined();
    meta = withStyleChanges(meta, undefined, "heading2", { color: "#c00000" });
    meta = withStyleChanges(meta, undefined, "heading2", { color: undefined });
    expect(meta.styles).toBeUndefined();
  });

  it("reset to the defaults without the style set", () => {
    const meta: DocMeta = {
      styleSet: { name: "Report", styles: {} },
      styles: { body: { italic: true } },
      page: {
        size: "A5",
        orientation: "portrait",
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
      },
    };
    expect(withoutStyles(meta)).toEqual({ page: meta.page });
  });

  it("list a document's own styles as differences from the built-in ones", () => {
    const own = documentOwnStyles(
      { styles: { heading3: { italic: true } } },
      { body: { fontSize: 11 } },
    );
    expect(diffFromBuiltIn(own)).toEqual({ body: { fontSize: 11 }, heading3: { italic: true } });
  });
});

describe("style sheets", () => {
  it("use Word's line spacing: multiples of the font's own single line", () => {
    expect(
      lineHeight(
        "body",
        { fontFamily: "Segoe UI", lineSpacing: { rule: "multiple", value: 1.5 } },
        FONTS,
      ),
    ).toBe("1.995");
    expect(lineHeight("body", { lineSpacing: { rule: "exactly", value: 15 } }, FONTS)).toBe("15pt");
  });

  it("replace a font that is not installed by the default, keeping the fallback", () => {
    expect(
      fontStack("heading1", { fontFamily: "Nowhere Sans", fallbackFont: "Malgun Gothic" }, FONTS),
    ).toBe('"Segoe UI", "Malgun Gothic", sans-serif');
    expect(fontStack("codeBlock", { fontFamily: "Nowhere Mono" }, FONTS)).toBe(
      '"Consolas", monospace',
    );
    // While the font list is loading, the font is used as it is.
    expect(fontStack("body", { fontFamily: "Nowhere Sans" }, null)).toBe(
      '"Nowhere Sans", sans-serif',
    );
  });

  it("lighten dark colours for the dark page", () => {
    expect(darkModeColor("#000000")).toBe("hsl(0 0% 100%)");
    expect(darkModeColor("#ffcc00")).toBe("#ffcc00");
    expect(darkModeColor("#1f3864")).toMatch(/^hsl\(218/);
  });

  it("write a rule for every style, and dark colours for the screen only", () => {
    const css = styleSheet(
      resolveStyles({ styles: { heading2: { color: "#203864" } } }, undefined),
      FONTS,
    );
    expect(css).toContain(".page h2 {");
    expect(css).toContain("font-size: 16pt;");
    expect(css).toContain(".page :not(pre) > code {");
    expect(css).toMatch(/@media screen \{\n:root\[data-theme="dark"\] \.page h2 \{/);
  });
});
