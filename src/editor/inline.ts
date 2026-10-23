// Text formatting that toggles (O8): bold, italic, underline, strikethrough and
// inline code, plus equations and links.
//
// - Inside formatted text, the shortcut removes that formatting.
// - With no selection inside a word, it formats the whole word, as Word does.
// - Otherwise it wraps the selection, or inserts the markers around the cursor.

import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import {
  encodeLinkTarget,
  nodeAround,
  prefixLength,
  treeUpTo,
  wordAround,
  type Edit,
  type SyntaxNode,
} from "./edits";

export type InlineKind = "bold" | "italic" | "underline" | "strikethrough" | "code";

interface Markers {
  open: string;
  close: string;
  /** The syntax node for this formatting; underline is HTML and found by text. */
  node?: string;
}

const MARKERS: Record<InlineKind, Markers> = {
  bold: { open: "**", close: "**", node: "StrongEmphasis" },
  italic: { open: "*", close: "*", node: "Emphasis" },
  underline: { open: "<u>", close: "</u>" },
  strikethrough: { open: "~~", close: "~~", node: "Strikethrough" },
  code: { open: "`", close: "`", node: "InlineCode" },
};

/** A formatted span: its outer bounds and where its content starts and ends. */
interface Span {
  from: number;
  openTo: number;
  closeFrom: number;
  to: number;
}

function spanOfNode(node: SyntaxNode): Span | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first.from === last.from) return null;
  if (!first.name.endsWith("Mark") || !last.name.endsWith("Mark")) return null;
  return { from: node.from, openTo: first.to, closeFrom: last.from, to: node.to };
}

/** The formatted span of `name` that holds the range. A cursor right outside it does not count. */
function enclosingSpan(state: EditorState, from: number, to: number, name: string): Span | null {
  for (let node = nodeAround(state, from, name); node; node = node.parent) {
    if (node.name !== name || node.from > from || node.to < to) continue;
    if (from === to && (node.from === from || node.to === from)) continue;
    return spanOfNode(node);
  }
  return null;
}

/** `<u>…</u>` on the same line around the range. */
function enclosingUnderline(state: EditorState, from: number, to: number): Span | null {
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  const selected = state.sliceDoc(from, to);
  if (selected.length >= 7 && selected.startsWith("<u>") && selected.endsWith("</u>")) {
    return { from, openTo: from + 3, closeFrom: to - 4, to };
  }
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(to - line.from);
  const open = before.lastIndexOf("<u>");
  if (open < 0 || before.includes("</u>", open)) return null;
  const close = after.indexOf("</u>");
  if (close < 0 || after.slice(0, close).includes("<u>")) return null;
  return {
    from: line.from + open,
    openTo: line.from + open + 3,
    closeFrom: to + close,
    to: to + close + 4,
  };
}

/**
 * The markers sit right outside `from`–`to`, e.g. `**|**` right after Ctrl+B.
 * A longer run of the same character does not count: in `**bold**`, the `*`
 * next to "bold" belongs to the bold markers, not to an italic.
 */
function markersAround(state: EditorState, from: number, to: number, m: Markers): boolean {
  const before = state.sliceDoc(Math.max(0, from - m.open.length - 1), from);
  const after = state.sliceDoc(to, to + m.close.length + 1);
  if (!before.endsWith(m.open) || !after.startsWith(m.close)) return false;
  const repeated = (marker: string) => /^(.)\1*$/.test(marker);
  if (repeated(m.open) && before.length > m.open.length && before[0] === m.open[0]) return false;
  if (repeated(m.close) && after.length > m.close.length && after.at(-1) === m.close[0]) {
    return false;
  }
  return true;
}

/** Inline code that contains a backtick needs double backticks. */
function markersFor(m: Markers, text: string): Markers {
  return m.node === "InlineCode" && text.includes("`") ? { open: "`` ", close: " ``" } : m;
}

export function toggleInline(kind: InlineKind): Edit {
  const m = MARKERS[kind];
  return (state) =>
    state.changeByRange((range) => {
      const span = m.node
        ? enclosingSpan(state, range.from, range.to, m.node)
        : enclosingUnderline(state, range.from, range.to);

      if (span) {
        const changes = state.changes([
          { from: span.from, to: span.openTo },
          { from: span.closeFrom, to: span.to },
        ]);
        const from = changes.mapPos(range.from, 1);
        const to = changes.mapPos(range.to, -1);
        return { changes, range: EditorSelection.range(from, Math.max(from, to)) };
      }

      if (range.empty) {
        const pos = range.head;
        if (markersAround(state, pos, pos, m)) {
          return {
            changes: { from: pos - m.open.length, to: pos + m.close.length },
            range: EditorSelection.cursor(pos - m.open.length),
          };
        }
        const word = wordAround(state, pos);
        if (word) {
          const w = markersFor(m, state.sliceDoc(word.from, word.to));
          return {
            changes: [
              { from: word.from, insert: w.open },
              { from: word.to, insert: w.close },
            ],
            range: EditorSelection.cursor(pos + w.open.length),
          };
        }
        return {
          changes: { from: pos, insert: m.open + m.close },
          range: EditorSelection.cursor(pos + m.open.length),
        };
      }

      // Markers right outside the selection that the parser did not see as a span.
      if (markersAround(state, range.from, range.to, m)) {
        return {
          changes: [
            { from: range.from - m.open.length, to: range.from },
            { from: range.to, to: range.to + m.close.length },
          ],
          range: EditorSelection.range(range.from - m.open.length, range.to - m.open.length),
        };
      }
      return wrapRange(state, range.from, range.to, m);
    });
}

/**
 * Wraps the selected text. Each line is wrapped on its own (Markdown formatting
 * cannot cross paragraphs), leaving out list and quote markers and the
 * whitespace at either end, as Word does.
 */
function wrapRange(state: EditorState, from: number, to: number, m: Markers) {
  const changes: ChangeSpec[] = [];
  const firstLine = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to).number;
  let single: { start: number; end: number; open: string } | null = null;
  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n);
    let start = Math.max(from, line.from);
    let end = Math.min(to, line.to);
    if (firstLine !== lastLine && start === line.from) start += prefixLength(line.text);
    const text = state.sliceDoc(start, end);
    start += text.length - text.trimStart().length;
    end -= text.length - text.trimEnd().length;
    if (start >= end) continue;
    const w = markersFor(m, state.sliceDoc(start, end));
    changes.push({ from: start, insert: w.open }, { from: end, insert: w.close });
    single = firstLine === lastLine ? { start, end, open: w.open } : null;
  }
  if (changes.length === 0) {
    return { changes: [], range: EditorSelection.range(from, to) };
  }
  if (single) {
    // Select the same text as before, now inside the markers.
    const offset = single.open.length;
    return {
      changes,
      range: EditorSelection.range(single.start + offset, single.end + offset),
    };
  }
  const set = state.changes(changes);
  return { changes: set, range: EditorSelection.range(set.mapPos(from, 1), set.mapPos(to, -1)) };
}

/**
 * Alt+=: `$…$` around the selection or at the cursor; a `$$` block on an empty
 * line or around several selected lines.
 */
export const insertEquation: Edit = (state) =>
  state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const multiLine = range.to > line.to;
    if (multiLine) {
      const last = state.doc.lineAt(range.to);
      return {
        changes: [
          { from: line.from, insert: "$$\n" },
          { from: last.to, insert: "\n$$" },
        ],
        range: EditorSelection.range(line.from + 3, last.to + 3),
      };
    }
    if (range.empty && !line.text.trim()) {
      return {
        changes: { from: line.from, to: line.to, insert: "$$\n\n$$" },
        range: EditorSelection.cursor(line.from + 3),
      };
    }
    const text = state.sliceDoc(range.from, range.to);
    const from = range.from + (text.length - text.trimStart().length);
    const to = range.to - (text.length - text.trimEnd().length);
    return {
      changes: [
        { from, insert: "$" },
        { from: to, insert: "$" },
      ],
      range: range.empty
        ? EditorSelection.cursor(range.head + 1)
        : EditorSelection.range(from + 1, to + 1),
    };
  });

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export interface LinkTarget {
  /** What the link replaces. */
  from: number;
  to: number;
  text: string;
  url: string;
  /** The cursor is in an existing link, which the dialog edits (and can remove). */
  existing: boolean;
}

const URL_LIKE = /^(?:https?:\/\/|www\.|mailto:)\S+$/i;

/**
 * What Ctrl+K edits: the link around the cursor, or the selection (a selected
 * address becomes both text and address), or the word under the cursor.
 */
export function linkTargetAt(state: EditorState): LinkTarget {
  const range = state.selection.main;
  const link = nodeAround(state, range.from, "Link");
  if (link && link.from <= range.from && link.to >= range.to) {
    const marks = link.getChildren("LinkMark");
    const url = link.getChild("URL");
    if (marks.length >= 2) {
      let target = url ? state.sliceDoc(url.from, url.to) : "";
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      return {
        from: link.from,
        to: link.to,
        text: state.sliceDoc(marks[0].to, marks[1].from),
        url: target,
        existing: true,
      };
    }
  }
  if (!range.empty) {
    const text = state.sliceDoc(range.from, range.to);
    return {
      from: range.from,
      to: range.to,
      text,
      url: URL_LIKE.test(text.trim()) ? text : "",
      existing: false,
    };
  }
  const word = wordAround(state, range.head);
  if (word) return { ...word, text: state.sliceDoc(word.from, word.to), url: "", existing: false };
  return { from: range.head, to: range.head, text: "", url: "", existing: false };
}

/** Where the text a link shows sits: [text](url) shows "text", <url> shows "url". */
function linkText(link: SyntaxNode): { from: number; to: number } | null {
  if (link.name === "Autolink") return link.getChild("URL");
  const marks = link.getChildren("LinkMark");
  return marks.length >= 2 ? { from: marks[0].to, to: marks[1].from } : null;
}

const LINKS = new Set(["Link", "Autolink"]);

/**
 * Remove Link (Ctrl+Shift+F9, as Word's Unlink): the links in the selection,
 * or the one around the cursor, become their plain text. Images stay.
 */
export const removeLinks: Edit = (state) => {
  const links = new Map<number, SyntaxNode>();
  for (const range of state.selection.ranges) {
    if (range.empty) {
      const link =
        nodeAround(state, range.head, "Link") ?? nodeAround(state, range.head, "Autolink");
      if (link) links.set(link.from, link);
      continue;
    }
    treeUpTo(state, range.to).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (!LINKS.has(node.name)) return;
        links.set(node.from, node.node);
        return false;
      },
    });
  }
  const changes: ChangeSpec[] = [];
  // Only the markup around the text goes, so the cursor stays on the same letter.
  for (const link of links.values()) {
    const text = linkText(link);
    if (text) changes.push({ from: link.from, to: text.from }, { from: text.to, to: link.to });
  }
  if (changes.length === 0) return null;
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set) };
};

/** `[text](url)` in place of the target. An empty text shows the address. */
export function insertLink(target: LinkTarget, text: string, url: string): Edit {
  return () => {
    const shown = (text.trim() || url.trim()).replace(/([[\]])/g, "\\$1");
    const markdown = `[${shown}](${encodeLinkTarget(url.trim())})`;
    return {
      changes: { from: target.from, to: target.to, insert: markdown },
      selection: EditorSelection.cursor(target.from + markdown.length),
    };
  };
}
