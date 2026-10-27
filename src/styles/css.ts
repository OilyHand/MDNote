// A document's styles as CSS for the rendered page (O4). Everything is in pt,
// like Word, so the page, the PDF and the Word export agree.
//
// Line spacing follows Word: "Multiple" is a multiple of the font's own single
// line, measured as Word measures it (fonts.rs), and "Exactly" is a fixed
// height. Korean (East Asian) text always uses the style's Korean font, as
// Word's "Asian text" font does, and a line holding it is as tall as that
// font's line: the render worker wraps such text in span.md-ea, which takes
// the font and line height from variables each style sets. A font that is not
// installed is replaced by the default font, keeping the Korean font (O3).
// Text colours are printed as chosen; on the dark page, dark colours are shown
// lighter, as Word does in dark mode.

import type { FontFamily } from "../ipc";
import type { StyleKey, StyleProps } from "../mdmeta/schema";
import { CODE_STYLES, DEFAULT_CODE_FONT, DEFAULT_FONT, type ResolvedStyles } from "./model";

/** The installed fonts by lower-case name, or null while the list is loading. */
export type FontIndex = Map<string, FontFamily> | null;

export function fontIndex(fonts: FontFamily[] | null): FontIndex {
  return fonts ? new Map(fonts.map((font) => [font.name.toLowerCase(), font])) : null;
}

const DEFAULT_LINE_HEIGHT = 1.2;

const quote = (name: string) => `"${name.replace(/["\\]/g, "")}"`;

/** Whether `name` is installed; true while the font list is not known yet. */
export function isInstalled(fonts: FontIndex, name: string): boolean {
  return !fonts || fonts.has(name.toLowerCase());
}

/** The font a style really uses: its own, or the default when that is not installed. */
export function shownFont(key: StyleKey, props: StyleProps, fonts: FontIndex): string {
  const fallback = CODE_STYLES.includes(key) ? DEFAULT_CODE_FONT : DEFAULT_FONT;
  const family = props.fontFamily ?? fallback;
  return isInstalled(fonts, family) ? family : fallback;
}

export function fontStack(key: StyleKey, props: StyleProps, fonts: FontIndex): string {
  const generic = CODE_STYLES.includes(key) ? "monospace" : "sans-serif";
  const names = [shownFont(key, props, fonts)];
  if (props.fallbackFont) names.push(props.fallbackFont);
  return [...new Set(names)].map(quote).join(", ") + `, ${generic}`;
}

/** The style's Korean font, if it has one that is installed. */
export function koreanFont(props: StyleProps, fonts: FontIndex): string | null {
  return props.fallbackFont && isInstalled(fonts, props.fallbackFont) ? props.fallbackFont : null;
}

/** CSS line-height for Word's line spacing, for lines in `family`. */
function spacingIn(props: StyleProps, family: string, fonts: FontIndex): string | null {
  const spacing = props.lineSpacing;
  if (!spacing) return null;
  if (spacing.rule === "exactly") return `${spacing.value}pt`;
  const single = fonts?.get(family.toLowerCase())?.lineHeight ?? DEFAULT_LINE_HEIGHT;
  return String(Math.round(spacing.value * single * 1000) / 1000);
}

/** CSS line-height for Word's line spacing. */
export function lineHeight(key: StyleKey, props: StyleProps, fonts: FontIndex): string | null {
  return spacingIn(props, shownFont(key, props, fonts), fonts);
}

/** The font and line height of Korean text in this style (span.md-ea). */
function eastAsianDeclarations(key: StyleKey, props: StyleProps, fonts: FontIndex): Declarations {
  if (!props.fontFamily || CODE_STYLES.includes(key)) return [];
  const main = shownFont(key, props, fonts);
  const korean = koreanFont(props, fonts);
  const names = korean ? [korean, main] : [main];
  return [
    ["--md-ea-font", `${[...new Set(names)].map(quote).join(", ")}, sans-serif`],
    ["--md-ea-line", spacingIn(props, korean ?? main, fonts)],
  ];
}

/** Whether the page is shown dark (the dark theme, chosen or from Windows). */
export function pageIsDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Dark colours turned light for the dark page, keeping their hue. */
export function darkModeColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= 0.5) return hex;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  const hue = Math.round(((h * 60 + 360) % 360) * 10) / 10;
  const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;
  return `hsl(${hue} ${percent(s)} ${percent(1 - l)})`;
}

function block(selector: string, declarations: Declarations): string {
  const lines = declarations
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `  ${name}: ${value};`);
  return lines.length ? `${selector} {\n${lines.join("\n")}\n}\n` : "";
}

const pt = (value: number | undefined) => (value === undefined ? undefined : `${value}pt`);
const weight = (bold: boolean | undefined) =>
  bold === undefined ? undefined : bold ? "700" : "400";
const style = (italic: boolean | undefined) =>
  italic === undefined ? undefined : italic ? "italic" : "normal";

type Declarations = [string, string | null | undefined][];

function textDeclarations(key: StyleKey, props: StyleProps, fonts: FontIndex): Declarations {
  return [
    ...eastAsianDeclarations(key, props, fonts),
    ["font-family", props.fontFamily || props.fallbackFont ? fontStack(key, props, fonts) : null],
    ["font-size", pt(props.fontSize)],
    ["font-weight", weight(props.bold)],
    ["font-style", style(props.italic)],
    ["color", props.color],
    ["line-height", lineHeight(key, props, fonts)],
  ];
}

const margins = (props: StyleProps): Declarations => [
  ["margin-top", pt(props.spaceBefore)],
  ["margin-bottom", pt(props.spaceAfter)],
];

/** Where each style applies on the page (inside `scope`). */
const SELECTORS: Record<StyleKey, string[]> = {
  body: [""],
  heading1: ["h1"],
  heading2: ["h2"],
  heading3: ["h3"],
  heading4: ["h4"],
  heading5: ["h5"],
  heading6: ["h6"],
  blockquote: ["blockquote"],
  list: ["ul", "ol"],
  inlineCode: [":not(pre) > code"],
  codeBlock: ["pre"],
  equation: [".katex"],
  tableHeader: ["th"],
  tableCell: ["td"],
  link: ["a"],
  footnote: [".footnotes"],
};

function selector(scope: string, key: StyleKey, prefix = ""): string {
  return SELECTORS[key].map((s) => `${prefix}${scope}${s ? ` ${s}` : ""}`).join(",\n");
}

/** The rules for the page: one per style, plus the dark-page colours. */
export function styleSheet(styles: ResolvedStyles, fonts: FontIndex, scope = ".page"): string {
  let css = "";
  for (const [key, props] of Object.entries(styles) as [StyleKey, StyleProps][]) {
    const declarations = textDeclarations(key, props, fonts);
    if (key === "body") {
      css += block(scope, declarations);
      css += block(`${scope} p`, [...margins(props), ["text-align", props.alignment]]);
    } else if (key === "equation") {
      css += block(selector(scope, key), declarations);
      css += block(`${scope} .katex-display`, margins(props));
    } else if (key === "link") {
      css += block(selector(scope, key), [
        ["color", props.color],
        [
          "text-decoration",
          props.underline === undefined ? undefined : props.underline ? "underline" : "none",
        ],
      ]);
    } else if (key === "footnote") {
      css += block(selector(scope, key), [...declarations, ["margin-top", pt(props.spaceBefore)]]);
    } else {
      css += block(selector(scope, key), [
        ...declarations,
        ...margins(props),
        ["text-align", props.alignment],
      ]);
    }
  }

  // Korean text takes the font and line height of the style it is in.
  css += block(`${scope} .md-ea`, [
    ["font-family", "var(--md-ea-font)"],
    ["line-height", "var(--md-ea-line)"],
  ]);

  // Dark page: chosen colours, lightened. Screen only: printing always uses the light page.
  let dark = "";
  for (const [key, props] of Object.entries(styles) as [StyleKey, StyleProps][]) {
    if (!props.color) continue;
    dark += block(selector(scope, key, "PREFIX"), [["color", darkModeColor(props.color)]]);
  }
  if (dark) {
    css += `@media screen {\n${dark.replaceAll("PREFIX", ':root[data-theme="dark"] ')}}\n`;
    css += `@media screen and (prefers-color-scheme: dark) {\n${dark.replaceAll(
      "PREFIX",
      ':root:not([data-theme="light"]) ',
    )}}\n`;
  }
  return css;
}
