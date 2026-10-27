// Page setup (O9): paper sizes, Word's margin presets, units, and the page a
// document is shown on. Lengths are in mm, as in the `.mdmeta` file.

import type { DocMeta, Margins, PageSetup, PaperSize } from "../mdmeta/schema";

/** Portrait width and height in mm. B5 is JIS B5, as Word lists it in Korea and Japan. */
export const PAPER: Record<Exclude<PaperSize, "custom">, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  A5: [148, 210],
  B5: [182, 257],
};

/** Word's margin presets (Layout > Margins). */
export const MARGIN_PRESETS = {
  normal: { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 },
  narrow: { top: 12.7, bottom: 12.7, left: 12.7, right: 12.7 },
  moderate: { top: 25.4, bottom: 25.4, left: 19.05, right: 19.05 },
  wide: { top: 25.4, bottom: 25.4, left: 50.8, right: 50.8 },
} satisfies Record<string, Margins>;
export type MarginPreset = keyof typeof MARGIN_PRESETS;

export type Units = "cm" | "in";

/** The page for documents without their own setup: Windows' paper size, Normal margins. */
export function builtInPage(paper: "A4" | "Letter"): PageSetup {
  return { size: paper, orientation: "portrait", margins: { ...MARGIN_PRESETS.normal } };
}

/** A document's page: its own setup, else the default from Preferences. */
export function effectivePage(meta: DocMeta, defaultPage: PageSetup): PageSetup {
  return meta.page ?? defaultPage;
}

/** Width and height in mm, as the page is shown (landscape swaps them). */
export function pageSize(page: PageSetup): { width: number; height: number } {
  const [w, h] =
    page.size === "custom" ? [page.width ?? 210, page.height ?? 297] : PAPER[page.size];
  return page.orientation === "landscape" ? { width: h, height: w } : { width: w, height: h };
}

/** The smallest text column and line height margins may leave. */
export const MIN_TEXT_MM = 25;

/** Whether the margins leave room for text. */
export function marginsFit(page: PageSetup): boolean {
  const { width, height } = pageSize(page);
  const m = page.margins;
  return width - m.left - m.right >= MIN_TEXT_MM && height - m.top - m.bottom >= MIN_TEXT_MM;
}

export function presetOf(margins: Margins): MarginPreset | null {
  for (const [name, preset] of Object.entries(MARGIN_PRESETS)) {
    if ((["top", "bottom", "left", "right"] as const).every((s) => near(preset[s], margins[s]))) {
      return name as MarginPreset;
    }
  }
  return null;
}

export function samePage(a: PageSetup, b: PageSetup): boolean {
  const sa = pageSize(a);
  const sb = pageSize(b);
  return (
    a.size === b.size &&
    a.orientation === b.orientation &&
    near(sa.width, sb.width) &&
    near(sa.height, sb.height) &&
    (["top", "bottom", "left", "right"] as const).every((s) => near(a.margins[s], b.margins[s]))
  );
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

export const MM_PER_INCH = 25.4;
export const PX_PER_MM = 96 / MM_PER_INCH;

/** A length in mm, written in the UI's unit ("2.54 cm", "1\""). */
export function formatLength(mm: number, units: Units, withUnit = true): string {
  const value = units === "cm" ? mm / 10 : mm / MM_PER_INCH;
  const text = String(Math.round(value * 100) / 100);
  return withUnit ? `${text} ${units === "cm" ? "cm" : "in"}` : text;
}

/** A length typed in the UI's unit, in mm; null if it is not a number. */
export function parseLength(text: string, units: Units): number | null {
  const value = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(value) || text.trim() === "") return null;
  return Math.round((units === "cm" ? value * 10 : value * MM_PER_INCH) * 100) / 100;
}

/** The page with another paper size, orientation or margins. */
export function withPage(meta: DocMeta, page: PageSetup | undefined): DocMeta {
  const next = { ...meta };
  if (page) next.page = page;
  else delete next.page;
  return next;
}

/** The CSS that prints the page with its paper size and margins (O9). */
export function printPageRule(page: PageSetup): string {
  const { width, height } = pageSize(page);
  const m = page.margins;
  return `@page {\n  size: ${width}mm ${height}mm;\n  margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;\n}\n`;
}

/** The space between sheets in Print Layout, in CSS px at 100% zoom. */
export const PAGE_GAP_PX = 16;

/**
 * Print Layout: how many sheets a page `height` px tall fills (sheets and the
 * gaps between them), and the 1-based sheet at `y` px from its top. Both are
 * in the same pixels, zoom included.
 */
export function sheetsIn(height: number, sheetHeight: number, gap: number): number {
  return Math.max(1, Math.round((height + gap) / (sheetHeight + gap)));
}

export function sheetAt(y: number, sheets: number, sheetHeight: number, gap: number): number {
  return Math.min(sheets, Math.max(1, Math.floor((y + gap / 2) / (sheetHeight + gap)) + 1));
}
