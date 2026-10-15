// The CodeMirror configuration shared by every document.
// Phase 1 is a plain-text editor; Markdown features arrive in Phase 2.

import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

type ChangeListener = (state: EditorState) => void;
let onChange: ChangeListener = () => {};

/** The editor pane registers the function that handles edits to the visible document. */
export function setChangeListener(listener: ChangeListener) {
  onChange = listener;
}

const extensions: Extension[] = [
  history(),
  drawSelection(),
  highlightActiveLine(),
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off" }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state);
  }),
];

export function createEditorState(text: string, cursor = 0): EditorState {
  const position = Math.min(Math.max(cursor, 0), text.length);
  return EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(position),
    extensions,
  });
}
