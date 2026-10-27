// What a document looks like: its formatting (O7) on top of the defaults from
// Preferences (O4, O9, O12), as styles, CSS and a page.

import { useMemo } from "react";
import { create } from "zustand";
import { metaOf } from "../mdmeta/field";
import { metaChange } from "../mdmeta/field";
import {
  EMPTY_META,
  parsePage,
  parseStyleMap,
  type CodeTheme,
  type DocMeta,
  type PageSetup,
  type StyleMap,
} from "../mdmeta/schema";
import { builtInPage, effectivePage, printPageRule, type Units } from "../page/page";
import { changeDoc, editorStates, useDocMetas } from "../state/documents";
import { useFonts } from "../state/fonts";
import { usePrefs } from "../state/prefs";
import { styleSheet } from "./css";
import { DEFAULT_CODE_THEME, resolveStyles, type ResolvedStyles } from "./model";

export interface DocumentDefaults {
  /** The user's default styles (differences from the built-in ones). */
  styles: StyleMap;
  page: PageSetup;
  units: Units;
}

function defaultsFrom(state: ReturnType<typeof usePrefs.getState>): DocumentDefaults {
  const p = state.preferences;
  return {
    styles: parseStyleMap(p.defaultStyles),
    page: parsePage(p.defaultPage) ?? builtInPage(state.systemPaper),
    units: p.units === "system" ? state.systemUnits : p.units,
  };
}

/** The defaults from Preferences, checked (outside React). */
export function documentDefaults(): DocumentDefaults {
  return defaultsFrom(usePrefs.getState());
}

export function useDocumentDefaults(): DocumentDefaults {
  const defaultStyles = usePrefs((s) => s.preferences.defaultStyles);
  const defaultPage = usePrefs((s) => s.preferences.defaultPage);
  const units = usePrefs((s) => s.preferences.units);
  const systemUnits = usePrefs((s) => s.systemUnits);
  const systemPaper = usePrefs((s) => s.systemPaper);
  return useMemo(
    () => defaultsFrom(usePrefs.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs of defaultsFrom
    [defaultStyles, defaultPage, units, systemUnits, systemPaper],
  );
}

/**
 * Formatting shown before it is applied: while Modify Style or Page Setup is
 * open, while a style set is hovered (O19), while a ruler marker is dragged.
 */
export const usePreviewMeta = create<{ docId: string | null; meta: DocMeta | null }>(() => ({
  docId: null,
  meta: null,
}));

export function showPreviewMeta(docId: string, meta: DocMeta) {
  usePreviewMeta.setState({ docId, meta });
}

export function clearPreviewMeta() {
  usePreviewMeta.setState({ docId: null, meta: null });
}

/** The document's formatting as shown now (including a preview). */
export function useShownMeta(docId: string | null): DocMeta {
  const saved = useDocMetas((s) => (docId ? s[docId] : undefined));
  const preview = usePreviewMeta((s) => (s.docId === docId ? s.meta : null));
  return preview ?? saved ?? EMPTY_META;
}

export interface DocumentLook {
  styles: ResolvedStyles;
  page: PageSetup;
  codeTheme: CodeTheme;
  /** The style sheet for the page, including the printed page's size and margins. */
  css: string;
}

export function useDocumentLook(docId: string | null): DocumentLook {
  const meta = useShownMeta(docId);
  const defaults = useDocumentDefaults();
  const fonts = useFonts((s) => s.index);
  return useMemo(() => {
    const styles = resolveStyles(meta, defaults.styles);
    const page = effectivePage(meta, defaults.page);
    return {
      styles,
      page,
      codeTheme: styles.codeBlock.codeTheme ?? DEFAULT_CODE_THEME,
      css: styleSheet(styles, fonts) + `@media print {\n${printPageRule(page)}}\n`,
    };
  }, [meta, defaults, fonts]);
}

/** The document's formatting now (outside React). */
export function currentMeta(docId: string): DocMeta {
  const state = editorStates.get(docId);
  return state ? metaOf(state) : EMPTY_META;
}

/** Changes a document's formatting, as one Undo step. */
export function changeMeta(docId: string, update: (meta: DocMeta) => DocMeta) {
  const next = update(currentMeta(docId));
  if (next === currentMeta(docId)) return;
  changeDoc(docId, () => metaChange(next));
}
