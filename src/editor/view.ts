// The window's single CodeMirror view. The editor pane swaps documents in and out of it.

import type { EditorView } from "@codemirror/view";

let current: EditorView | null = null;

export function setActiveView(view: EditorView | null) {
  current = view;
}

export function getActiveView(): EditorView | null {
  return current;
}
