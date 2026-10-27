import { describe, expect, it } from "vitest";
import {
  MARGIN_PRESETS,
  builtInPage,
  formatLength,
  marginsFit,
  pageSize,
  parseLength,
  presetOf,
  printPageRule,
  sheetAt,
  sheetsIn,
} from "./page";

describe("page setup", () => {
  it("swaps width and height in landscape", () => {
    expect(pageSize({ ...builtInPage("A4"), orientation: "landscape" })).toEqual({
      width: 297,
      height: 210,
    });
  });

  it("recognises Word's margin presets and refuses margins that leave no room", () => {
    expect(presetOf(MARGIN_PRESETS.wide)).toBe("wide");
    expect(presetOf({ top: 20, bottom: 20, left: 20, right: 20 })).toBeNull();
    const a5 = { ...builtInPage("A4"), size: "A5" as const };
    expect(marginsFit(a5)).toBe(true);
    expect(marginsFit({ ...a5, margins: { top: 10, bottom: 10, left: 62, right: 62 } })).toBe(
      false,
    );
  });

  it("shows lengths in the UI's unit and reads any number of decimals", () => {
    expect(formatLength(25.4, "cm")).toBe("2.54 cm");
    expect(formatLength(25.4, "in")).toBe("1 in");
    expect(parseLength("2.54", "cm")).toBe(25.4);
    expect(parseLength("1,27", "in")).toBe(32.26);
    expect(parseLength("", "cm")).toBeNull();
  });

  it("prints on the paper and with the margins of the page setup", () => {
    expect(printPageRule({ ...builtInPage("Letter"), orientation: "landscape" })).toContain(
      "size: 279.4mm 215.9mm;",
    );
  });
});

describe("Print Layout", () => {
  // Sheets 1000 px tall with 20 px between them.
  it("counts the sheets the page fills", () => {
    expect(sheetsIn(1000, 1000, 20)).toBe(1);
    expect(sheetsIn(2020, 1000, 20)).toBe(2);
    expect(sheetsIn(3040.4, 1000, 20)).toBe(3); // rounding in the layout
    expect(sheetsIn(0, 1000, 20)).toBe(1);
  });

  it("finds the sheet at a position, counting each gap half to either side", () => {
    expect(sheetAt(0, 3, 1000, 20)).toBe(1);
    expect(sheetAt(1009, 3, 1000, 20)).toBe(1);
    expect(sheetAt(1011, 3, 1000, 20)).toBe(2);
    expect(sheetAt(99999, 3, 1000, 20)).toBe(3);
    expect(sheetAt(-50, 3, 1000, 20)).toBe(1);
  });
});
