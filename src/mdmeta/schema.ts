// The `.mdmeta` file (O7): what a note's formatting looks like on disk.
//
// Reading checks every value. A value MDNote cannot use (a field from a newer
// version, a misspelt name, a wrong type) is never applied, but it is kept and
// written back unchanged, so a newer MDNote finds its settings again. Saving
// writes the fields in a fixed order, so the text of an unchanged file is the
// same every time, and a file with nothing in it is not written at all.

export const META_VERSION = 1;

/** Section types with their own style (O4), in the order they are listed. */
export const STYLE_KEYS = [
  "body",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "blockquote",
  "list",
  "inlineCode",
  "codeBlock",
  "equation",
  "tableHeader",
  "tableCell",
  "link",
  "footnote",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

export type Alignment = "left" | "center" | "right" | "justify";
export const ALIGNMENTS: Alignment[] = ["left", "center", "right", "justify"];

/**
 * Word's line spacing: a multiple of the font's single line ("Single" is 1,
 * "Double" 2), or an exact height in pt.
 */
export interface LineSpacing {
  rule: "multiple" | "exactly";
  value: number;
}

/** Colour themes for code blocks; each has a light and a dark version. */
export const CODE_THEMES = [
  "github",
  "vscode",
  "one",
  "solarized",
  "catppuccin",
  "gruvbox",
] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];

/** One style's properties. Sizes and spacing are in pt, colours "#rrggbb". */
export interface StyleProps {
  fontFamily?: string;
  /** For characters the main font lacks, such as Korean (O3). */
  fallbackFont?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  lineSpacing?: LineSpacing;
  spaceBefore?: number;
  spaceAfter?: number;
  alignment?: Alignment;
  codeTheme?: CodeTheme;
}
export type StyleProp = keyof StyleProps;

/** The order properties are written in. */
export const STYLE_PROPS: StyleProp[] = [
  "fontFamily",
  "fallbackFont",
  "fontSize",
  "bold",
  "italic",
  "underline",
  "color",
  "lineSpacing",
  "spaceBefore",
  "spaceAfter",
  "alignment",
  "codeTheme",
];

export type StyleMap = Partial<Record<StyleKey, StyleProps>>;

/** A style set applied to the document: a full copy of its styles (O19). */
export interface StyleSetCopy {
  name: string;
  styles: StyleMap;
}

export const PAPER_SIZES = ["A4", "Letter", "Legal", "A5", "B5", "custom"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export type Orientation = "portrait" | "landscape";

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Page setup (O9). Lengths in mm; `width` and `height` only for a custom size. */
export interface PageSetup {
  size: PaperSize;
  width?: number;
  height?: number;
  orientation: Orientation;
  margins: Margins;
}

/** The document's own settings: everything else comes from the defaults. */
export interface DocMeta {
  page?: PageSetup;
  styleSet?: StyleSetCopy;
  styles?: StyleMap;
  /** The file's version, if it was newer than this MDNote's. */
  version?: number;
  /** Everything in the file MDNote does not use, kept as it was. */
  extra?: Record<string, unknown>;
}

export const EMPTY_META: DocMeta = {};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 100;

const PROP_CHECKS: Record<StyleProp, (value: unknown) => boolean> = {
  fontFamily: isName,
  fallbackFont: isName,
  fontSize: (v) => isNumberIn(v, 1, 400),
  bold: (v) => typeof v === "boolean",
  italic: (v) => typeof v === "boolean",
  underline: (v) => typeof v === "boolean",
  color: (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v),
  lineSpacing: (v) =>
    isObject(v) &&
    Object.keys(v).length === 2 &&
    ((v.rule === "multiple" && isNumberIn(v.value, 0.5, 10)) ||
      (v.rule === "exactly" && isNumberIn(v.value, 1, 400))),
  spaceBefore: (v) => isNumberIn(v, 0, 400),
  spaceAfter: (v) => isNumberIn(v, 0, 400),
  alignment: (v) => (ALIGNMENTS as unknown[]).includes(v),
  codeTheme: (v) => (CODE_THEMES as readonly unknown[]).includes(v),
};

/** Splits a JSON object into the values that pass `check` and the rest. */
interface Split<T> {
  known: T | undefined;
  extra: unknown;
}

function splitStyle(value: unknown): Split<StyleProps> {
  if (!isObject(value)) return { known: undefined, extra: value };
  const known: Json = {};
  const extra: Json = {};
  for (const [name, v] of Object.entries(value)) {
    if (name in PROP_CHECKS && PROP_CHECKS[name as StyleProp](v)) known[name] = v;
    else extra[name] = v;
  }
  return {
    known: Object.keys(known).length ? (known as StyleProps) : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

function splitStyles(value: unknown): Split<StyleMap> {
  if (!isObject(value)) return { known: undefined, extra: value };
  const known: StyleMap = {};
  const extra: Json = {};
  for (const [name, v] of Object.entries(value)) {
    if (!(STYLE_KEYS as readonly string[]).includes(name)) {
      extra[name] = v;
      continue;
    }
    const style = splitStyle(v);
    if (style.known) known[name as StyleKey] = style.known;
    if (style.extra !== undefined) extra[name] = style.extra;
  }
  return {
    known: Object.keys(known).length ? known : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

const isMargins = (v: unknown): v is Margins =>
  isObject(v) &&
  Object.keys(v).length === 4 &&
  (["top", "bottom", "left", "right"] as const).every((side) => isNumberIn(v[side], 0, 500));

/** A page setup is used whole or not at all: half of one could not be shown sensibly. */
function splitPage(value: unknown): Split<PageSetup> {
  if (!isObject(value)) return { known: undefined, extra: value };
  const { size, width, height, orientation, margins, ...rest } = value;
  const custom = size === "custom";
  const valid =
    (PAPER_SIZES as readonly unknown[]).includes(size) &&
    (orientation === "portrait" || orientation === "landscape") &&
    isMargins(margins) &&
    (custom
      ? isNumberIn(width, 20, 2000) && isNumberIn(height, 20, 2000)
      : width === undefined && height === undefined);
  if (!valid) return { known: undefined, extra: value };
  const page: PageSetup = custom
    ? {
        size,
        width: width as number,
        height: height as number,
        orientation,
        margins: margins as Margins,
      }
    : { size: size as PaperSize, orientation, margins: margins as Margins };
  return { known: page, extra: Object.keys(rest).length ? rest : undefined };
}

function splitStyleSet(value: unknown): Split<StyleSetCopy> {
  if (!isObject(value) || !isName(value.name)) return { known: undefined, extra: value };
  const { name, styles, ...rest } = value;
  const parsed = splitStyles(styles ?? {});
  const extra: Json = { ...rest };
  if (parsed.extra !== undefined) extra.styles = parsed.extra;
  return {
    known: { name: name as string, styles: parsed.known ?? {} },
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export type ParseResult =
  { ok: true; meta: DocMeta; newer: boolean } | { ok: false; problem: string };

/** Reads the text of a `.mdmeta` file. */
export function parseMeta(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
  if (!isObject(json)) return { ok: false, problem: "not a JSON object" };
  const { version, page, styleSet, styles, ...rest } = json;
  if (!isNumberIn(version, 1, Number.MAX_SAFE_INTEGER) || !Number.isInteger(version)) {
    return { ok: false, problem: "no valid version number" };
  }

  const meta: DocMeta = {};
  const extra: Json = { ...rest };
  const parts = [
    ["page", page === undefined ? undefined : splitPage(page)],
    ["styleSet", styleSet === undefined ? undefined : splitStyleSet(styleSet)],
    ["styles", styles === undefined ? undefined : splitStyles(styles)],
  ] as const;
  for (const [name, part] of parts) {
    if (!part) continue;
    if (part.known) (meta as Json)[name] = part.known;
    if (part.extra !== undefined) extra[name] = part.extra;
  }
  if (version > META_VERSION) meta.version = version;
  if (Object.keys(extra).length) meta.extra = extra;
  return { ok: true, meta, newer: version > META_VERSION };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function orderedStyle(style: StyleProps): Json {
  const out: Json = {};
  for (const prop of STYLE_PROPS) {
    const value = style[prop];
    if (value === undefined) continue;
    out[prop] =
      prop === "lineSpacing"
        ? { rule: style.lineSpacing!.rule, value: style.lineSpacing!.value }
        : value;
  }
  return out;
}

function orderedStyles(styles: StyleMap): Json {
  const out: Json = {};
  for (const key of STYLE_KEYS) {
    const style = styles[key];
    if (style && Object.keys(orderedStyle(style)).length) out[key] = orderedStyle(style);
  }
  return out;
}

function orderedPage(page: PageSetup): Json {
  const { top, bottom, left, right } = page.margins;
  return {
    size: page.size,
    ...(page.size === "custom" ? { width: page.width, height: page.height } : {}),
    orientation: page.orientation,
    margins: { top, bottom, left, right },
  };
}

/** Known values win; objects present on both sides are merged, extra keys sorted after. */
function merge(known: unknown, extra: unknown): unknown {
  if (!isObject(known) || !isObject(extra)) return known === undefined ? extra : known;
  const out: Json = { ...known };
  for (const key of Object.keys(extra).sort()) {
    out[key] = key in known ? merge(known[key], extra[key]) : extra[key];
  }
  return out;
}

/** The file's JSON object, or null when the document has no settings of its own. */
export function metaObject(meta: DocMeta): Json | null {
  const known: Json = {};
  if (meta.page) known.page = orderedPage(meta.page);
  if (meta.styleSet) {
    known.styleSet = { name: meta.styleSet.name, styles: orderedStyles(meta.styleSet.styles) };
  }
  const styles = meta.styles ? orderedStyles(meta.styles) : {};
  if (Object.keys(styles).length) known.styles = styles;
  const merged = merge(known, meta.extra ?? {}) as Json;
  if (Object.keys(merged).length === 0) return null;
  return { version: meta.version ?? META_VERSION, ...merged };
}

/** The text of the `.mdmeta` file, or null when there should be no file. */
export function serializeMeta(meta: DocMeta): string | null {
  const object = metaObject(meta);
  return object ? `${JSON.stringify(object, null, 2)}\n` : null;
}

const serialized = new WeakMap<DocMeta, string | null>();

/** serializeMeta, remembered per object: dirty checks run after every keystroke. */
export function metaKey(meta: DocMeta): string | null {
  let key = serialized.get(meta);
  if (key === undefined) {
    key = serializeMeta(meta);
    serialized.set(meta, key);
  }
  return key;
}
