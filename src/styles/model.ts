// The style model (O4): which properties each section type has, the built-in
// styles, and how a document's styles are worked out from the layers.
//
// Layers, later ones winning:
//   1. the built-in styles below;
//   2. the user's default styles (Preferences), or, if the document has a
//      style set applied, that set's copy instead (O19), so such a document
//      looks the same on every PC;
//   3. the document's own changes (its `.mdmeta` "styles").
// Block styles then take every property they still lack from Body text, as
// Word's styles are "based on" Normal. Inline styles (inline code, links,
// equations) take theirs from the text around them instead.

import {
  STYLE_KEYS,
  type CodeTheme,
  type DocMeta,
  type StyleKey,
  type StyleMap,
  type StyleProp,
  type StyleProps,
} from "../mdmeta/schema";

export interface StyleInfo {
  kind: "block" | "inline";
  props: StyleProp[];
}

const TEXT: StyleProp[] = ["fontFamily", "fallbackFont", "fontSize", "bold", "italic", "color"];
const BLOCK: StyleProp[] = [...TEXT, "lineSpacing", "spaceBefore", "spaceAfter"];
const PARAGRAPH: StyleProp[] = [...BLOCK, "alignment"];

export const STYLE_INFO: Record<StyleKey, StyleInfo> = {
  body: { kind: "block", props: PARAGRAPH },
  heading1: { kind: "block", props: PARAGRAPH },
  heading2: { kind: "block", props: PARAGRAPH },
  heading3: { kind: "block", props: PARAGRAPH },
  heading4: { kind: "block", props: PARAGRAPH },
  heading5: { kind: "block", props: PARAGRAPH },
  heading6: { kind: "block", props: PARAGRAPH },
  blockquote: { kind: "block", props: BLOCK },
  list: { kind: "block", props: BLOCK },
  inlineCode: { kind: "inline", props: TEXT },
  codeBlock: { kind: "block", props: [...BLOCK, "codeTheme"] },
  // KaTeX draws equations with its own fonts: only size, colour and spacing (O4).
  equation: { kind: "inline", props: ["fontSize", "color", "spaceBefore", "spaceAfter"] },
  tableHeader: { kind: "block", props: [...TEXT, "lineSpacing"] },
  tableCell: { kind: "block", props: [...TEXT, "lineSpacing"] },
  link: { kind: "inline", props: ["color", "underline"] },
  footnote: { kind: "block", props: BLOCK },
};

/** Code styles fall back to Consolas when their font is missing; the others to Segoe UI. */
export const CODE_STYLES: StyleKey[] = ["inlineCode", "codeBlock"];
export const DEFAULT_FONT = "Segoe UI";
export const DEFAULT_CODE_FONT = "Consolas";
export const DEFAULT_FALLBACK_FONT = "Malgun Gothic";
export const DEFAULT_CODE_THEME: CodeTheme = "github";

/**
 * The built-in styles (O4): Segoe UI 12 pt with Malgun Gothic for Korean, and
 * code in Consolas 10.5 pt. Line spacing is in Word's terms: 1.15 lines of
 * Segoe UI is about 1.5 times the font size. Colours left out are "automatic":
 * they follow the light or dark page.
 */
export const BUILT_IN_STYLES: Record<StyleKey, StyleProps> = {
  body: {
    fontFamily: DEFAULT_FONT,
    fallbackFont: DEFAULT_FALLBACK_FONT,
    fontSize: 12,
    bold: false,
    italic: false,
    lineSpacing: { rule: "multiple", value: 1.15 },
    spaceBefore: 0,
    spaceAfter: 10,
    alignment: "left",
  },
  heading1: heading(20, 24, 10),
  heading2: heading(16, 18, 8),
  heading3: heading(13, 14, 6),
  heading4: heading(12, 12, 6),
  heading5: heading(11, 12, 6),
  heading6: heading(11, 12, 6),
  blockquote: {},
  list: {},
  inlineCode: {
    fontFamily: DEFAULT_CODE_FONT,
    fallbackFont: DEFAULT_FALLBACK_FONT,
    fontSize: 10.5,
  },
  codeBlock: {
    fontFamily: DEFAULT_CODE_FONT,
    fallbackFont: DEFAULT_FALLBACK_FONT,
    fontSize: 10.5,
    lineSpacing: { rule: "multiple", value: 1.25 },
    spaceBefore: 0,
    spaceAfter: 10,
    codeTheme: DEFAULT_CODE_THEME,
  },
  equation: { spaceBefore: 0, spaceAfter: 10 },
  tableHeader: { bold: true },
  tableCell: {},
  link: { underline: true },
  footnote: { fontSize: 10, spaceBefore: 24 },
};

function heading(fontSize: number, spaceBefore: number, spaceAfter: number): StyleProps {
  return {
    fontSize,
    bold: true,
    lineSpacing: { rule: "multiple", value: 1 },
    spaceBefore,
    spaceAfter,
  };
}

export type ResolvedStyles = Record<StyleKey, StyleProps>;

function only(props: StyleProps, keep: StyleProp[]): StyleProps {
  const out: StyleProps = {};
  for (const prop of keep) {
    if (props[prop] !== undefined) (out as Record<string, unknown>)[prop] = props[prop];
  }
  return out;
}

/** Each style's own values: the layers merged, before taking anything from Body text. */
export function ownStyles(layers: (StyleMap | undefined)[]): ResolvedStyles {
  const out = {} as ResolvedStyles;
  for (const key of STYLE_KEYS) {
    let props: StyleProps = { ...BUILT_IN_STYLES[key] };
    for (const layer of layers) if (layer?.[key]) props = { ...props, ...layer[key] };
    out[key] = only(props, STYLE_INFO[key].props);
  }
  return out;
}

/** Fills in what block styles take from Body text. */
export function inherit(own: ResolvedStyles): ResolvedStyles {
  const out = {} as ResolvedStyles;
  for (const key of STYLE_KEYS) {
    const info = STYLE_INFO[key];
    out[key] =
      info.kind === "block" && key !== "body"
        ? { ...only(own.body, info.props), ...own[key] }
        : own[key];
  }
  return out;
}

/** The layers under the document's own changes (see the top of this file). */
export function baseLayer(meta: DocMeta, userDefaults: StyleMap | undefined): StyleMap | undefined {
  return meta.styleSet ? meta.styleSet.styles : userDefaults;
}

/** The styles a document is shown with. */
export function resolveStyles(meta: DocMeta, userDefaults: StyleMap | undefined): ResolvedStyles {
  return inherit(ownStyles([baseLayer(meta, userDefaults), meta.styles]));
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The document after changing one style's properties. A value equal to what
 * the style would have without the document's own change is not stored, so
 * the `.mdmeta` holds only real differences.
 */
export function withStyleChanges(
  meta: DocMeta,
  userDefaults: StyleMap | undefined,
  key: StyleKey,
  changes: StyleProps,
): DocMeta {
  const without: StyleMap = { ...meta.styles, [key]: {} };
  const plain = inherit(ownStyles([baseLayer(meta, userDefaults), without]))[key];
  const own: StyleProps = { ...meta.styles?.[key] };
  for (const [prop, value] of Object.entries(changes) as [StyleProp, unknown][]) {
    if (value === undefined || sameValue(value, plain[prop])) delete own[prop];
    else (own as Record<string, unknown>)[prop] = value;
  }
  return withOwnStyle(meta, key, own);
}

/** Replaces one style's own changes (an empty object removes them). */
export function withOwnStyle(meta: DocMeta, key: StyleKey, own: StyleProps): DocMeta {
  const styles: StyleMap = { ...meta.styles };
  if (Object.keys(own).length) styles[key] = own;
  else delete styles[key];
  const next: DocMeta = { ...meta, styles };
  if (Object.keys(styles).length === 0) delete next.styles;
  return next;
}

/** Reset to Defaults (O4): no own styles and no style set. */
export function withoutStyles(meta: DocMeta): DocMeta {
  const next = { ...meta };
  delete next.styles;
  delete next.styleSet;
  return next;
}

/** A style collection's own values that differ from the built-in styles (for Preferences). */
export function diffFromBuiltIn(own: ResolvedStyles): StyleMap {
  const out: StyleMap = {};
  for (const key of STYLE_KEYS) {
    const changed: StyleProps = {};
    for (const prop of STYLE_INFO[key].props) {
      const value = own[key][prop];
      if (value !== undefined && !sameValue(value, BUILT_IN_STYLES[key][prop])) {
        (changed as Record<string, unknown>)[prop] = value;
      }
    }
    if (Object.keys(changed).length) out[key] = changed;
  }
  return out;
}

/** The document's own values of every style (to save as a set or as the defaults). */
export function documentOwnStyles(
  meta: DocMeta,
  userDefaults: StyleMap | undefined,
): ResolvedStyles {
  return ownStyles([baseLayer(meta, userDefaults), meta.styles]);
}
