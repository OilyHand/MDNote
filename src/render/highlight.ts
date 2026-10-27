// Code highlighting with Shiki. The JavaScript regex engine avoids WebAssembly
// (so the strict CSP stays as it is), and each language and theme loads on
// first use.

import {
  bundledLanguages,
  createHighlighter,
  createJavaScriptRegexEngine,
  type BundledLanguage,
  type BundledTheme,
  type HighlighterGeneric,
} from "shiki";
import type { Element } from "hast";
import type { CodeTheme } from "../mdmeta/schema";

/** Each code colour theme (O4) as the light page's and the dark page's Shiki theme. */
export const THEME_PAIRS: Record<CodeTheme, { light: BundledTheme; dark: BundledTheme }> = {
  github: { light: "github-light", dark: "github-dark" },
  vscode: { light: "light-plus", dark: "dark-plus" },
  one: { light: "one-light", dark: "one-dark-pro" },
  solarized: { light: "solarized-light", dark: "solarized-dark" },
  catppuccin: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  gruvbox: { light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
};

let highlighter: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighter({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

/** Language names and aliases Shiki knows (e.g. "ts", "py", "sh"). */
function resolveLanguage(name: string): BundledLanguage | undefined {
  return name in bundledLanguages ? (name as BundledLanguage) : undefined;
}

/**
 * Highlights `code`, or returns undefined for unknown languages (the plain
 * code block is kept). Colours are CSS variables for both the light and the
 * dark page, so switching between them needs no re-render.
 */
export async function highlightCode(
  code: string,
  language: string,
  theme: CodeTheme = "github",
): Promise<Element | undefined> {
  const lang = resolveLanguage(language);
  if (!lang) return undefined;
  const themes = THEME_PAIRS[theme] ?? THEME_PAIRS.github;
  try {
    const shiki = await getHighlighter();
    if (!shiki.getLoadedLanguages().includes(lang)) await shiki.loadLanguage(lang);
    const loaded = shiki.getLoadedThemes();
    for (const name of [themes.light, themes.dark]) {
      if (!loaded.includes(name)) await shiki.loadTheme(name);
    }
    const root = shiki.codeToHast(code.replace(/\n$/, ""), {
      lang,
      themes,
      defaultColor: false,
    });
    const pre = root.children[0];
    return pre?.type === "element" ? pre : undefined;
  } catch {
    return undefined; // a broken grammar must never break the preview
  }
}
