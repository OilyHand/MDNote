// Bracket and marker conveniences (O17). None of them act while the Korean IME
// is composing, so they never split or duplicate a syllable.

import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";

/**
 * `( [ { "` close automatically; typing the closing character steps over it, and
 * Backspace between an empty pair deletes both. `'` is left out: it is an
 * apostrophe far more often than a quote.
 */
export const autoCloseBrackets = [
  markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{", '"'] } }),
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
];

const WRAP_MARKERS = new Set(["*", "_", "`", "~"]);

/** Typing `*`, `_`, `` ` `` or `~` with text selected wraps the text instead of replacing it. */
export const wrapSelection = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!WRAP_MARKERS.has(text) || view.composing) return false;
  const { state } = view;
  if (state.selection.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    state.update(
      state.changeByRange((range) =>
        range.empty
          ? {
              changes: { from: range.from, insert: text },
              range: EditorSelection.cursor(range.from + 1),
            }
          : {
              changes: [
                { from: range.from, insert: text },
                { from: range.to, insert: text },
              ],
              range: EditorSelection.range(range.anchor + 1, range.head + 1),
            },
      ),
      { scrollIntoView: true, userEvent: "input.type" },
    ),
  );
  return true;
});
