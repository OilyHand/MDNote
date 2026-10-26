// The CodeMirror configuration shared by every document: Markdown with GitHub
// extensions, syntax colours that follow the theme, the editing shortcuts (O8),
// and the options from Preferences (word wrap, line numbers, the conveniences
// of O17; the font is a CSS variable).

import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentLess,
  insertTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { commandsFor, EDITOR_COMMANDS, type CommandId } from "../shortcuts/registry";
import { markdownMath } from "./math";
import { listContinuation, renumberLists } from "./lists";
import { autoCloseBrackets, wrapSelection } from "./conveniences";
import { editorPhrases, searchSupport } from "./search";
import { alignTablesOnLeave } from "./table";

type ChangeListener = (state: EditorState) => void;
let onChange: ChangeListener = () => {};
let onCursor: ChangeListener = () => {};

/** The editor pane registers the function that handles edits to the visible document. */
export function setChangeListener(listener: ChangeListener) {
  onChange = listener;
}

/** Called whenever the cursor or selection moves (for the status bar). */
export function setCursorListener(listener: ChangeListener) {
  onCursor = listener;
}

type CommandRunner = (id: CommandId, view: EditorView) => boolean;
let runCommand: CommandRunner = () => false;

/** The app registers how editor commands run (some open dialogs). */
export function setEditorCommandRunner(runner: CommandRunner) {
  runCommand = runner;
}

let onPasteImages: (files: File[]) => void = () => {};

/** The app registers what happens to images pasted into the editor (O15). */
export function setImagePasteHandler(handler: (files: File[]) => void) {
  onPasteImages = handler;
}

/**
 * Ctrl+V with only an image on the clipboard saves the image. Text wins when
 * both are there: Word, for one, copies a picture of the text along with it.
 */
const imagePaste = EditorView.domEventHandlers({
  paste(event) {
    const data = event.clipboardData;
    if (!data || data.getData("text/plain")) return false;
    const files = [...data.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return false;
    event.preventDefault();
    onPasteImages(files);
    return true;
  },
});

export interface EditorOptions {
  wordWrap: boolean;
  lineNumbers: boolean;
  listContinuation: boolean;
  closeBrackets: boolean;
  wrapSelection: boolean;
  renumberLists: boolean;
  /** Line tables up when the cursor leaves them (O16). */
  formatTables: boolean;
  /** UI language, for the search panel's words. */
  language: string;
}

let options: EditorOptions = {
  wordWrap: true,
  lineNumbers: false,
  listContinuation: true,
  closeBrackets: true,
  wrapSelection: true,
  renumberLists: true,
  formatTables: true,
  language: "en",
};

const wrapping = new Compartment();
const numbering = new Compartment();
const lists = new Compartment();
const brackets = new Compartment();
const markers = new Compartment();
const renumbering = new Compartment();
const tables = new Compartment();
const phrases = new Compartment();

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

/**
 * The shortcut table's editor commands. Several commands can share a key (Tab
 * moves between table cells, else indents a list item); the first that applies
 * wins, and if none does the key keeps its normal meaning. (CodeMirror ignores
 * keys while the IME composes; the window's key handler finishes the syllable
 * first for Ctrl and Alt shortcuts, see composition.ts.)
 */
const editorShortcuts = Prec.high(
  keymap.of([
    {
      any(view, event) {
        const ids = commandsFor(event, EDITOR_COMMANDS);
        if (ids.length === 0) return false;
        if (event.isComposing || view.composing) {
          if (!event.ctrlKey && !event.altKey) return false;
          event.preventDefault();
          return true;
        }
        if (!ids.some((id) => runCommand(id, view))) return false;
        event.preventDefault();
        return true;
      },
    },
  ]),
);

/** Tab must never move the focus out of the editor. */
const tabFallback = Prec.low(keymap.of([{ key: "Tab", run: insertTab, shift: indentLess }]));

const configurable = (o: EditorOptions): Extension[] => [
  wrapping.of(o.wordWrap ? EditorView.lineWrapping : []),
  numbering.of(o.lineNumbers ? lineNumbers() : []),
  lists.of(o.listContinuation ? listContinuation : []),
  brackets.of(o.closeBrackets ? autoCloseBrackets : []),
  markers.of(o.wrapSelection ? wrapSelection : []),
  renumbering.of(o.renumberLists ? renumberLists : []),
  tables.of(o.formatTables ? alignTablesOnLeave : []),
  phrases.of(editorPhrases(o.language)),
];

const fixed: Extension[] = [
  history(),
  drawSelection(),
  highlightActiveLine(),
  markdown({
    base: markdownLanguage,
    extensions: [markdownMath],
    addKeymap: false,
    completeHTMLTags: false,
  }),
  syntaxHighlighting(markdownHighlight),
  editorShortcuts,
  imagePaste,
  searchSupport,
  keymap.of([...defaultKeymap, ...historyKeymap]),
  tabFallback,
  EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off" }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state);
    if (update.docChanged || update.selectionSet) onCursor(update.state);
  }),
];

export function createEditorState(text: string, cursor = 0): EditorState {
  const position = Math.min(Math.max(cursor, 0), text.length);
  return EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(position),
    // The optional keymaps (lists, brackets) go first, so they act before the defaults.
    extensions: [...configurable(options), ...fixed],
  });
}

/** A document's editor state as JSON, Undo history included, to move it to another window. */
export function editorStateToJSON(state: EditorState): unknown {
  return state.toJSON({ history: historyField });
}

export function editorStateFromJSON(json: unknown): EditorState {
  return EditorState.fromJSON(
    json,
    { extensions: [...configurable(options), ...fixed] },
    { history: historyField },
  );
}

/** Sets the options for documents created or shown from now on. */
export function setEditorOptions(next: EditorOptions) {
  options = next;
}

export function editorOptions(): EditorOptions {
  return options;
}

/** Applies the current options to the document in `view` (each tab has its own state). */
export function applyEditorOptions(view: EditorView) {
  const o = options;
  view.dispatch({
    effects: [
      wrapping.reconfigure(o.wordWrap ? EditorView.lineWrapping : []),
      numbering.reconfigure(o.lineNumbers ? lineNumbers() : []),
      lists.reconfigure(o.listContinuation ? listContinuation : []),
      brackets.reconfigure(o.closeBrackets ? autoCloseBrackets : []),
      markers.reconfigure(o.wrapSelection ? wrapSelection : []),
      renumbering.reconfigure(o.renumberLists ? renumberLists : []),
      tables.reconfigure(o.formatTables ? alignTablesOnLeave : []),
      phrases.reconfigure(editorPhrases(o.language)),
    ],
  });
}
