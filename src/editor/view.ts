// The window's single CodeMirror view. The editor pane swaps documents in and out of it.

import type { EditorView } from "@codemirror/view";

let current: EditorView | null = null;
let shownDocId: string | null = null;

export function setActiveView(view: EditorView | null) {
  current = view;
}

export function getActiveView(): EditorView | null {
  return current;
}

/** Which document the view holds. Right after switching tabs it can still be the previous one. */
export function setShownDocId(id: string | null) {
  shownDocId = id;
}

let focusRequested = false;

/** The next document the editor shows also gets the keyboard focus (Enter in the folder tree). */
export function requestEditorFocus() {
  focusRequested = true;
}

/**
 * Whether the editor should take the focus when it shows another document: yes,
 * unless the focus is in the sidebar, where F2 and Delete act on the tree.
 */
export function takeFocusOnShow(): boolean {
  const asked = focusRequested;
  focusRequested = false;
  return asked || !document.activeElement?.closest(".sidebar");
}

/** The view, if it currently holds document `id`; otherwise the change goes to the stored state. */
export function viewShowing(id: string): EditorView | null {
  return current && shownDocId === id ? current : null;
}
