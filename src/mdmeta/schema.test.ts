import { describe, expect, it } from "vitest";
import { EMPTY_META, metaKey, parseMeta, serializeMeta, type DocMeta } from "./schema";

const EXAMPLE = {
  version: 1,
  page: {
    size: "A4",
    orientation: "portrait",
    margins: { top: 25.4, bottom: 25.4, left: 19.1, right: 19.1 },
  },
  styles: {
    body: { fontSize: 13, lineSpacing: { rule: "multiple", value: 1.6 } },
    heading2: { fontFamily: "Georgia", fontSize: 18, bold: true, spaceBefore: 12, spaceAfter: 6 },
    codeBlock: {
      fontFamily: "Consolas",
      fontSize: 10.5,
      lineSpacing: { rule: "exactly", value: 15 },
    },
  },
  tables: [{ index: 0, columnWidths: [160, 120, 320] }],
};

function parsed(json: unknown): DocMeta {
  const result = parseMeta(JSON.stringify(json));
  if (!result.ok) throw new Error(result.problem);
  return result.meta;
}

describe(".mdmeta files", () => {
  it("reads the example from O7, keeping what Phase 5 does not use", () => {
    const meta = parsed(EXAMPLE);
    expect(meta.page?.margins.left).toBe(19.1);
    expect(meta.styles?.heading2).toEqual({
      fontFamily: "Georgia",
      fontSize: 18,
      bold: true,
      spaceBefore: 12,
      spaceAfter: 6,
    });
    expect(meta.extra).toEqual({ tables: EXAMPLE.tables });
    expect(JSON.parse(serializeMeta(meta)!)).toEqual(EXAMPLE);
  });

  it("writes nothing for a document without settings", () => {
    expect(serializeMeta(EMPTY_META)).toBeNull();
    expect(serializeMeta({ styles: { heading1: {} } })).toBeNull();
    expect(serializeMeta(parsed({ version: 1 }))).toBeNull();
  });

  it("keeps values it cannot use, without applying them", () => {
    const meta = parsed({
      version: 1,
      styles: {
        heading1: { fontSize: "big", bold: true, letterSpacing: 2 },
        caption: { italic: true },
      },
      page: {
        size: "A3",
        orientation: "portrait",
        margins: { top: 1, bottom: 1, left: 1, right: 1 },
      },
    });
    expect(meta.styles).toEqual({ heading1: { bold: true } });
    expect(meta.page).toBeUndefined();
    const saved = JSON.parse(serializeMeta(meta)!);
    expect(saved.styles.heading1).toEqual({ bold: true, fontSize: "big", letterSpacing: 2 });
    expect(saved.styles.caption).toEqual({ italic: true });
    expect(saved.page.size).toBe("A3");
  });

  it("writes known values over the kept ones", () => {
    const meta = parsed({ version: 1, styles: { heading1: { fontSize: "big" } } });
    const changed: DocMeta = { ...meta, styles: { heading1: { fontSize: 22 } } };
    expect(JSON.parse(serializeMeta(changed)!).styles.heading1.fontSize).toBe(22);
  });

  it("keeps a newer version number", () => {
    const result = parseMeta(JSON.stringify({ version: 3, futureThing: 1 }));
    expect(result.ok && result.newer).toBe(true);
    if (result.ok) expect(JSON.parse(serializeMeta(result.meta)!).version).toBe(3);
  });

  it("reports files it cannot read", () => {
    for (const text of ["", "{", "[]", '"x"', "{}", '{"version":"1"}', '{"version":0}']) {
      expect(parseMeta(text).ok, text).toBe(false);
    }
    expect(parseMeta('\uFEFF{"version":1}').ok).toBe(true);
  });

  it("writes the same text whatever order the values were set in", () => {
    const a: DocMeta = {
      styles: { heading2: { bold: true, fontSize: 18 }, body: { italic: true } },
    };
    const b: DocMeta = {
      styles: { body: { italic: true }, heading2: { fontSize: 18, bold: true } },
    };
    expect(metaKey(a)).toBe(metaKey(b));
  });

  it("accepts custom paper sizes only with a width and height", () => {
    const margins = { top: 10, bottom: 10, left: 10, right: 10 };
    const custom = { size: "custom", width: 100, height: 150, orientation: "landscape", margins };
    expect(parsed({ version: 1, page: custom }).page).toEqual(custom);
    expect(parsed({ version: 1, page: { ...custom, width: undefined } }).page).toBeUndefined();
    expect(
      parsed({ version: 1, page: { size: "A4", width: 5, orientation: "portrait", margins } }).page,
    ).toBeUndefined();
  });
});
