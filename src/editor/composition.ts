// Shortcuts pressed while the IME is still composing a syllable (O8).
//
// CodeMirror ignores every key while the IME composes, so a Ctrl or Alt
// shortcut pressed right after typing Korean (the last syllable still
// underlined) was lost. Instead, the syllable is finished first and the
// shortcut runs afterwards, as in Word. Keys typed into the IME itself, without
// Ctrl or Alt, stay with the IME, so typing never triggers a shortcut.

import type { EditorView } from "@codemirror/view";

/** A key that is a deliberate shortcut even mid-composition. */
export const isModifiedKey = (event: KeyboardEvent) => event.ctrlKey || event.altKey;

/**
 * Ends the composition, keeping the composed text, and resolves once the
 * editor has taken it in. Leaving the editable element makes the browser
 * confirm the composition; focus comes straight back.
 */
export function finishComposition(view: EditorView): Promise<void> {
  view.contentDOM.blur();
  view.focus();
  return new Promise((resolve) => {
    let frames = 0;
    const check = () => {
      if (!view.composing || ++frames > 10) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}
