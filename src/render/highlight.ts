// Code highlighting with Shiki. The JavaScript regex engine avoids WebAssembly
// (so the strict CSP stays as it is), and each language loads on first use.

import {
  bundledLanguages,
  createHighlighter,
  createJavaScriptRegexEngine,
  type BundledLanguage,
  type HighlighterGeneric,
} from "shiki";
import type { Element } from "hast";

const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighter:
  Promise<HighlighterGeneric<BundledLanguage, "github-light" | "github-dark">> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighter({
    themes: [THEMES.light, THEMES.dark],
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
 * code block is kept). Colours are CSS variables for both themes, so switching
 * between light and dark needs no re-render.
 */
export async function highlightCode(code: string, language: string): Promise<Element | undefined> {
  const lang = resolveLanguage(language);
  if (!lang) return undefined;
  try {
    const shiki = await getHighlighter();
    if (!shiki.getLoadedLanguages().includes(lang)) await shiki.loadLanguage(lang);
    const root = shiki.codeToHast(code.replace(/\n$/, ""), {
      lang,
      themes: THEMES,
      defaultColor: false,
    });
    const pre = root.children[0];
    return pre?.type === "element" ? pre : undefined;
  } catch {
    return undefined; // a broken grammar must never break the preview
  }
}
