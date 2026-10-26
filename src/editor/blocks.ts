// Paragraph commands (O8): headings, normal paragraph, lists, quotes, code
// blocks, page breaks, and list indentation. Each one applies to every line the
// selection touches, and pressing it again undoes it.

import { EditorSelection, type ChangeSpec, type EditorState } from "@codemirror/state";
import {
  buildLine,
  isBlank,
  isBullet,
  isNumbered,
  nodeAround,
  parseLine,
  selectedLines,
  type Edit,
  type LineParts,
} from "./edits";

export const PAGE_BREAK = "<!-- pagebreak -->";

interface LineEdit {
  number: number;
  parts: LineParts;
}

/** Replaces each line with `rewrite(parts)`, keeping the cursor on the same text. */
function rewriteLines(
  state: EditorState,
  rewrite: (lines: LineEdit[]) => (LineParts | null)[],
): ReturnType<Edit> {
  const lines = selectedLines(state).map((number) => ({
    number,
    parts: parseLine(state.doc.line(number).text),
  }));
  const results = rewrite(lines);
  const changes: ChangeSpec[] = [];
  lines.forEach(({ number }, i) => {
    const next = results[i];
    if (!next) return;
    const line = state.doc.line(number);
    const text = buildLine(next);
    if (text !== line.text) changes.push(markerChange(line.from, line.text, text));
  });
  if (changes.length === 0) return { selection: state.selection };
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set, 1) };
}

/**
 * The change from `before` to `after` as a replacement of the differing middle
 * part only, so a cursor in the unchanged content stays where it was.
 */
function markerChange(from: number, before: string, after: string): ChangeSpec {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: from + start,
    to: from + before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

const nonBlank = (lines: LineEdit[]) => {
  const filled = lines.filter((l) => !isBlank(l.parts));
  return filled.length > 0 ? filled : lines;
};

/** Ctrl+Alt+1–6. A heading drops list markers, as Word's heading styles do. */
export function setHeading(level: number): Edit {
  const hashes = "#".repeat(level);
  return (state) =>
    rewriteLines(state, (lines) => {
      const targets = nonBlank(lines);
      const remove = targets.every((l) => l.parts.heading === hashes);
      return lines.map((l) =>
        targets.includes(l)
          ? {
              ...l.parts,
              indent: "",
              marker: "",
              task: "",
              heading: remove ? "" : hashes,
            }
          : null,
      );
    });
}

/** Ctrl+Shift+N: removes heading, list and quote markers. */
export const setNormal: Edit = (state) =>
  rewriteLines(state, (lines) =>
    lines.map((l) => ({
      quote: "",
      indent: "",
      marker: "",
      task: "",
      heading: "",
      content: l.parts.content,
    })),
  );

type ListKind = "bullet" | "numbered" | "task";

/** Ctrl+Shift+L, Ctrl+Shift+7 and the task list command. */
export function toggleList(kind: ListKind): Edit {
  const matches = (p: LineParts) =>
    kind === "bullet" ? isBullet(p) && !p.task : kind === "numbered" ? isNumbered(p) : !!p.task;
  return (state) =>
    rewriteLines(state, (lines) => {
      const targets = nonBlank(lines);
      if (targets.every((l) => matches(l.parts))) {
        return lines.map((l) =>
          targets.includes(l)
            ? { ...l.parts, indent: "", marker: "", task: "", heading: "" }
            : null,
        );
      }
      // Numbers count up per indentation level.
      const counters = new Map<string, number>();
      return lines.map((l) => {
        if (!targets.includes(l)) return null;
        const p = l.parts;
        let marker = "-";
        if (kind === "numbered") {
          const n = (counters.get(p.indent) ?? 0) + 1;
          counters.set(p.indent, n);
          marker = `${n}.`;
        } else if (kind === "task" && p.marker) {
          marker = p.marker;
        }
        const task = kind === "task" ? p.task || "[ ]" : "";
        return { ...p, marker, task, heading: "" };
      });
    });
}

/** Ctrl+Shift+Q: adds or removes one level of `> `. */
export const toggleQuote: Edit = (state) =>
  rewriteLines(state, (lines) => {
    const quoted = (p: LineParts) => p.quote.includes(">");
    const remove = nonBlank(lines).every((l) => quoted(l.parts));
    return lines.map(({ parts }) => {
      if (remove) return { ...parts, quote: parts.quote.replace(/^([ \t]*)>[ \t]?/, "$1") };
      // Blank lines between quoted lines keep the quote going; a lone empty line is ready to type in.
      const blankInside = buildLine(parts) === "" && lines.length > 1;
      return { ...parts, quote: blankInside ? ">" : `> ${parts.quote}` };
    });
  });

/** Ctrl+Shift+`: puts the lines in a fenced code block, or removes the fences around the cursor. */
export const toggleCodeBlock: Edit = (state) => {
  const range = state.selection.main;
  const fenced = nodeAround(state, range.head, "FencedCode");
  if (fenced) {
    const open = state.doc.lineAt(fenced.from);
    const close = state.doc.lineAt(fenced.to);
    const closed = fenced.getChildren("CodeMark").length > 1 && close.number > open.number;
    let changes: ChangeSpec[];
    if (closed && close.number === open.number + 1) {
      changes = [{ from: open.from, to: close.to }]; // nothing between the fences
    } else {
      changes = [{ from: open.from, to: Math.min(open.to + 1, state.doc.length) }];
      if (closed) changes.push({ from: close.from - 1, to: close.to });
    }
    const set = state.changes(changes);
    return { changes: set, selection: state.selection.map(set) };
  }

  const lines = selectedLines(state);
  const first = state.doc.line(lines[0]);
  const last = state.doc.line(lines[lines.length - 1]);
  // A longer fence when the content itself contains ``` lines.
  const inner = state.sliceDoc(first.from, last.to);
  const longest = Math.max(0, ...[...inner.matchAll(/^[ \t]*(`{3,})/gm)].map((m) => m[1].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  if (lines.length === 1 && !first.text.trim()) {
    return {
      changes: { from: first.from, to: first.to, insert: `${fence}\n\n${fence}` },
      selection: EditorSelection.cursor(first.from + fence.length + 1),
    };
  }
  const set = state.changes([
    { from: first.from, insert: `${fence}\n` },
    { from: last.to, insert: `\n${fence}` },
  ]);
  // Positions at the start stay after the opening fence, all others before the closing one.
  const inside = (pos: number) => set.mapPos(pos, pos === first.from ? 1 : -1);
  return {
    changes: set,
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(inside(r.anchor), inside(r.head))),
      state.selection.mainIndex,
    ),
  };
};

/**
 * Ctrl+Enter: a `<!-- pagebreak -->` line (O9) at the cursor, as its own block
 * with blank lines around it. Text after the cursor moves below the break.
 */
export const insertPageBreak: Edit = (state) => {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from).trimEnd();
  const after = line.text.slice(head - line.from).trimStart();
  const previousBlank = line.number === 1 || !state.doc.line(line.number - 1).text.trim();
  const lead = before ? `${before}\n\n` : previousBlank ? "" : "\n";
  const insert = `${lead}${PAGE_BREAK}\n\n${after}`;
  return {
    changes: { from: line.from, to: line.to, insert },
    selection: EditorSelection.cursor(line.from + insert.length - after.length),
  };
};

// ---------------------------------------------------------------------------
// List indentation (Tab / Shift+Tab)
// ---------------------------------------------------------------------------

const isItem = (p: LineParts) => p.marker !== "";

/** The nearest list item above `number` whose indentation passes `test`. */
function itemAbove(
  state: EditorState,
  number: number,
  quote: string,
  test: (indent: number) => boolean,
): LineParts | null {
  for (let n = number - 1; n >= 1; n--) {
    const parts = parseLine(state.doc.line(n).text);
    if (isBlank(parts)) continue;
    if (parts.quote !== quote) return null;
    if (isItem(parts) && test(parts.indent.length)) return parts;
    if (!isItem(parts) && parts.indent.length === 0) return null; // left the list
  }
  return null;
}

/** Tab in a list item: nests it under the item above. Declines outside lists. */
export const indentListItem: Edit = (state) => {
  const lines = selectedLines(state).map((number) => ({
    number,
    parts: parseLine(state.doc.line(number).text),
  }));
  if (!lines.some((l) => isItem(l.parts))) return null;
  const first = lines.find((l) => isItem(l.parts))!;
  const sibling = itemAbove(
    state,
    first.number,
    first.parts.quote,
    (indent) => indent === first.parts.indent.length,
  );
  // A nested item starts where the text of the item above starts.
  const width = (sibling ?? first.parts).marker.length + 1;
  const pad = " ".repeat(width);
  return rewriteLines(state, (all) =>
    all.map((l) => (isBlank(l.parts) ? null : { ...l.parts, indent: l.parts.indent + pad })),
  );
};

/** Shift+Tab in a list item: moves it out to its parent's level. Declines outside lists. */
export const outdentListItem: Edit = (state) => {
  const lines = selectedLines(state).map((number) => ({
    number,
    parts: parseLine(state.doc.line(number).text),
  }));
  const first = lines.find((l) => isItem(l.parts));
  if (!first) return null;
  const own = first.parts.indent.length;
  if (own === 0) return { selection: state.selection }; // already at the top level
  const parent = itemAbove(state, first.number, first.parts.quote, (indent) => indent < own);
  const remove = own - (parent ? parent.indent.length : 0);
  return rewriteLines(state, (all) =>
    all.map((l) =>
      isBlank(l.parts)
        ? null
        : { ...l.parts, indent: l.parts.indent.slice(Math.min(remove, l.parts.indent.length)) },
    ),
  );
};
