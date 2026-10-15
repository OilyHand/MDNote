// Building blocks for the formatting commands (O8): reading a Markdown line into
// its parts, finding the lines and words a command applies to, and running an
// edit as one Undo step.

import type { EditorState, TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

/** A command as a pure function of the state, so it can be tested without a view. */
export type Edit = (state: EditorState) => TransactionSpec | null;

/** Runs an edit as its own Undo step. Returns false when the edit does not apply. */
export function runEdit(view: EditorView, edit: Edit): boolean {
  const spec = edit(view.state);
  if (!spec) return false;
  view.dispatch({
    scrollIntoView: true,
    userEvent: "input.format",
    ...spec,
    annotations: isolateHistory.of("full"),
  });
  return true;
}

/** The syntax tree, parsed at least up to `upTo`. */
export function treeUpTo(state: EditorState, upTo: number) {
  return ensureSyntaxTree(state, upTo, 200) ?? syntaxTree(state);
}

export type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** The innermost node named `name` around `pos`, if any. */
export function nodeAround(state: EditorState, pos: number, name: string): SyntaxNode | null {
  const tree = treeUpTo(state, pos);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === name) return node;
    }
  }
  return null;
}

/** The line numbers a selection covers. A selection ending at a line start leaves that line out. */
export function selectedLines(state: EditorState, ranges = state.selection.ranges): number[] {
  const lines = new Set<number>();
  for (const range of ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && last > first && state.doc.line(last).from === range.to) last--;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/** A Markdown line split into its markers and its content. */
export interface LineParts {
  /** Indentation and blockquote markers (`> `). */
  quote: string;
  /** Indentation of a list item inside the quote. */
  indent: string;
  /** `-`, `*`, `+`, `1.` or `1)`, without the space after it. */
  marker: string;
  /** `[ ]` or `[x]`. */
  task: string;
  /** `#` to `######`. */
  heading: string;
  content: string;
}

// quote markers, indentation, list marker (with an optional task box), heading, content
const LINE =
  /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:([-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:(\[[ xX]\])(?:[ \t]+|$))?)?(?:(#{1,6})(?:[ \t]+|$))?(.*)$/;

export function parseLine(text: string): LineParts {
  const m = LINE.exec(text)!;
  return {
    quote: m[1],
    indent: m[2],
    marker: m[3] ?? "",
    task: m[4] ?? "",
    heading: m[5] ?? "",
    content: m[6],
  };
}

export function buildLine(parts: LineParts): string {
  const marker = parts.marker ? `${parts.marker} ` : "";
  const task = parts.task ? `${parts.task} ` : "";
  const heading = parts.heading ? `${parts.heading} ` : "";
  return `${parts.quote}${parts.indent}${marker}${task}${heading}${parts.content}`;
}

export const isBlank = (parts: LineParts) => !parts.content.trim() && !parts.heading;
export const isBullet = (parts: LineParts) => /^[-*+]$/.test(parts.marker);
export const isNumbered = (parts: LineParts) => /^\d/.test(parts.marker);

/** How many characters of the line are markers (quote, list, task, heading). */
export function prefixLength(text: string): number {
  const parts = parseLine(text);
  return text.length - parts.content.length;
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

/** The word the cursor is inside (not at its edge), as in Word. */
export function wordAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const i = pos - line.from;
  if (i === 0 || i === text.length) return null;
  if (!WORD_CHAR.test(text[i - 1]) || !WORD_CHAR.test(text[i])) return null;
  let start = i;
  let end = i;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  return { from: line.from + start, to: line.from + end };
}

const percentEncode = (c: string) =>
  [...new TextEncoder().encode(c)]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");

/**
 * A link target that works in other Markdown apps too. Spaces and parentheses
 * are percent-encoded; Korean letters stay readable. For a file path, `%`, `#`
 * and `?` are encoded as well, since they would otherwise read as URL syntax.
 */
export function encodeLinkTarget(target: string, isPath = false): string {
  return target.replace(isPath ? /[%\s()<>#?[\]]/g : /[\s()<>]/g, percentEncode);
}
