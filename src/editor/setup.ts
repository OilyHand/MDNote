// The CodeMirror configuration shared by every document: Markdown with GitHub
// extensions, syntax colours that follow the theme, and the editor options from
// Preferences (word wrap, line numbers; the font is a CSS variable).

import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdownMath } from "./math";

type ChangeListener = (state: EditorState) => void;
let onChange: ChangeListener = () => {};

/** The editor pane registers the function that handles edits to the visible document. */
export function setChangeListener(listener: ChangeListener) {
  onChange = listener;
}

export interface EditorOptions {
  wordWrap: boolean;
  lineNumbers: boolean;
}

let options: EditorOptions = { wordWrap: true, lineNumbers: false };
const wrapping = new Compartment();
const numbering = new Compartment();

/** Colours come from CSS variables, so they follow the light and dark themes. */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--syntax-heading)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--syntax-link)" },
  { tag: tags.monospace, color: "var(--syntax-code)" },
  { tag: tags.quote, color: "var(--syntax-quote)" },
  {
    tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
    color: "var(--syntax-mark)",
  },
  { tag: [tags.comment], color: "var(--syntax-quote)", fontStyle: "italic" },
]);

const configurable = (current: EditorOptions): Extension[] => [
  wrapping.of(current.wordWrap ? EditorView.lineWrapping : []),
  numbering.of(current.lineNumbers ? lineNumbers() : []),
];

const fixed: Extension[] = [
  history(),
  drawSelection(),
  highlightActiveLine(),
  markdown({ base: markdownLanguage, extensions: [markdownMath] }),
  syntaxHighlighting(markdownHighlight),
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
    extensions: [...fixed, ...configurable(options)],
  });
}

/** Sets the options for new documents and returns the effects to apply them to a view. */
export function setEditorOptions(next: EditorOptions) {
  options = next;
}

/** Applies the current options to the document in `view` (each tab has its own state). */
export function applyEditorOptions(view: EditorView) {
  view.dispatch({
    effects: [
      wrapping.reconfigure(options.wordWrap ? EditorView.lineWrapping : []),
      numbering.reconfigure(options.lineNumbers ? lineNumbers() : []),
    ],
  });
}
