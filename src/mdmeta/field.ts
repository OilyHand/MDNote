// A document's formatting lives in its CodeMirror state, next to the text, so
// one Undo history covers both: Ctrl+Z undoes a style change like a typed word.

import { StateEffect, StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { EMPTY_META, type DocMeta } from "./schema";

const setMeta = StateEffect.define<DocMeta>();

export const metaField = StateField.define<DocMeta>({
  create: () => EMPTY_META,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMeta)) value = effect.value;
    return value;
  },
  // Moving a tab to another window carries its formatting along.
  toJSON: (value) => value,
  fromJSON: (json) => json as DocMeta,
});

/** Undo puts back the formatting from before the change. */
const metaHistory = invertedEffects.of((tr) => {
  const before = tr.startState.field(metaField);
  return before === tr.state.field(metaField) ? [] : [setMeta.of(before)];
});

/** The field and its Undo support; `meta` is the formatting a new state starts with. */
export function metaExtensions(meta?: DocMeta) {
  return [meta ? metaField.init(() => meta) : metaField, metaHistory];
}

export function metaOf(state: EditorState): DocMeta {
  return state.field(metaField, false) ?? EMPTY_META;
}

export function metaChanged(before: EditorState, after: EditorState): boolean {
  return metaOf(before) !== metaOf(after);
}

/** Replaces the formatting, as part of a transaction. */
export function metaEffect(meta: DocMeta) {
  return setMeta.of(meta);
}

/** A transaction that replaces the formatting, as its own Undo step. */
export function metaChange(meta: DocMeta): TransactionSpec {
  return {
    effects: setMeta.of(meta),
    annotations: isolateHistory.of("full"),
    userEvent: "format.meta",
  };
}
