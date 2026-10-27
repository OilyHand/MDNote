// The style commands (O4): Modify Style, bigger and smaller fonts (Ctrl+] and
// Ctrl+[), Set as Default and Reset to Defaults. Changes to a document are
// Undo steps like any edit; Set as Default changes Preferences.

import i18n from "../i18n";
import type { StyleKey } from "../mdmeta/schema";
import { getActiveView, viewShowing } from "../editor/view";
import { activeDoc, editorStates } from "../state/documents";
import { ask } from "../state/dialog";
import { modifyStyleDialog } from "../state/modal";
import { usePrefs } from "../state/prefs";
import { changeMeta, currentMeta, documentDefaults } from "./look";
import {
  diffFromBuiltIn,
  documentOwnStyles,
  resolveStyles,
  STYLE_INFO,
  withOwnStyle,
  withStyleChanges,
  withoutStyles,
} from "./model";
import { styleKeyAt } from "./sections";

/** The section type at the cursor of the active document. */
export function currentStyleKey(docId: string): StyleKey {
  const state = viewShowing(docId)?.state ?? editorStates.get(docId);
  return state ? styleKeyAt(state, state.selection.main.head) : "body";
}

export function modifyStyle(docId: string, key: StyleKey) {
  void modifyStyleDialog(docId, key).then(() => getActiveView()?.focus());
}

export function modifyCurrentStyle() {
  const doc = activeDoc();
  if (doc) modifyStyle(doc.id, currentStyleKey(doc.id));
}

const MIN_SIZE = 1;
const MAX_SIZE = 400;

/**
 * Ctrl+] and Ctrl+[: one point bigger or smaller, for the section type at the
 * cursor (Word changes the selection; Markdown can only style whole types).
 * A style without a size of its own (links) changes Body text's.
 */
export function growFont(step: 1 | -1) {
  const doc = activeDoc();
  if (!doc) return;
  let key = currentStyleKey(doc.id);
  if (!STYLE_INFO[key].props.includes("fontSize")) key = "body";
  const defaults = documentDefaults().styles;
  const styles = resolveStyles(currentMeta(doc.id), defaults);
  // An equation without a size of its own is 1.21 times the text around it (KaTeX).
  const size = styles[key].fontSize ?? Math.round((styles.body.fontSize ?? 12) * 1.21);
  const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size) + step));
  changeMeta(doc.id, (meta) => withStyleChanges(meta, defaults, key, { fontSize: next }));
}

/** Removes the document's own change to one style. */
export function resetStyle(docId: string, key: StyleKey) {
  changeMeta(docId, (meta) => withOwnStyle(meta, key, {}));
}

/** Reset to Defaults: the document drops its own styles and its style set (O4). */
export function resetToDefaults() {
  const doc = activeDoc();
  if (doc) changeMeta(doc.id, withoutStyles);
}

/** Set as Default: this document's styles become the user's default styles (O4). */
export async function setStylesAsDefault() {
  const doc = activeDoc();
  if (!doc) return;
  const t = i18n.t.bind(i18n);
  const choice = await ask({
    title: t("dialog.setDefault.title"),
    message: t("dialog.setDefault.message"),
    buttons: [
      { id: "set", label: t("dialog.setDefault.set"), primary: true },
      { id: "cancel", label: t("dialog.setDefault.cancel") },
    ],
    cancelId: "cancel",
  });
  if (choice !== "set") return;
  const meta = currentMeta(doc.id);
  const own = documentOwnStyles(meta, documentDefaults().styles);
  await usePrefs.getState().update({
    defaultStyles: diffFromBuiltIn(own) as Record<string, unknown>,
    defaultStyleSet: meta.styleSet && !meta.styles ? meta.styleSet.name : "",
  });
}
