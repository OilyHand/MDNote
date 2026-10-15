// Table tools, source side (O16): insert a table, add and delete rows and
// columns, align columns, move between cells with Tab, and line the columns up.
//
// Formatting only changes spaces (and adds the empty cells a short row lacks),
// so the rendered table stays the same. Korean characters count as two columns,
// so the pipes line up in the editor's monospaced font.

import { EditorSelection, type EditorState } from "@codemirror/state";
import stringWidth from "string-width";
import { EditorView } from "@codemirror/view";
import { nodeAround, runEdit, type Edit } from "./edits";

export type Align = "none" | "left" | "center" | "right";

/** One cell's content (trimmed) in the document; an empty cell has from === to. */
interface Cell {
  /** Where the cell starts, just after its pipe. */
  start: number;
  from: number;
  to: number;
  text: string;
}

interface SourceTable {
  from: number;
  to: number;
  /** Header and body rows; the delimiter row is not included. */
  rows: Cell[][];
  /** Line numbers of `rows`, and of the delimiter row. */
  lines: number[];
  delimiterLine: number;
  aligns: Align[];
  columns: number;
  leadingPipe: boolean;
  trailingPipe: boolean;
}

/** Splits a table line at unescaped pipes. Cell positions are absolute. */
function splitRow(text: string, lineFrom: number) {
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") pipes.push(i);
  }
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  const leadingPipe = pipes[0] === start;
  const trailingPipe = pipes.length > (leadingPipe ? 1 : 0) && pipes[pipes.length - 1] === end - 1;
  const inner = pipes.slice(leadingPipe ? 1 : 0, trailingPipe ? -1 : undefined);
  const bounds = [leadingPipe ? pipes[0] : -1, ...inner];
  const lastEnd = trailingPipe ? pipes[pipes.length - 1] : text.length;

  const cells: Cell[] = bounds.map((bound, i) => {
    const segment = bound + 1;
    const raw = text.slice(segment, i + 1 < bounds.length ? bounds[i + 1] : lastEnd);
    const content = raw.trim();
    // An empty cell's cursor position is just after the space following the pipe.
    const offset = content ? raw.length - raw.trimStart().length : Math.min(1, raw.length);
    const from = lineFrom + segment + offset;
    return { start: lineFrom + segment, from, to: from + content.length, text: content };
  });
  return { cells, leadingPipe, trailingPipe };
}

function alignOf(delimiter: string): Align {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : "none";
}

/** The table around `pos`, read from the source. */
export function tableAt(state: EditorState, pos: number): SourceTable | null {
  const node = nodeAround(state, pos, "Table");
  if (!node) return null;
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  if (last < first + 1) return null;
  const rows: Cell[][] = [];
  const lines: number[] = [];
  let aligns: Align[] = [];
  let leadingPipe = false;
  let trailingPipe = false;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (!line.text.trim()) break;
    const row = splitRow(line.text, line.from);
    if (n === first) {
      leadingPipe = row.leadingPipe;
      trailingPipe = row.trailingPipe;
    }
    if (n === first + 1) aligns = row.cells.map((c) => alignOf(c.text));
    else {
      rows.push(row.cells);
      lines.push(n);
    }
  }
  const columns = rows[0]?.length ?? 0;
  if (columns === 0) return null;
  while (aligns.length < columns) aligns.push("none");
  return {
    from: state.doc.line(first).from,
    to: state.doc.line(lines[lines.length - 1] ?? first + 1).to,
    rows,
    lines,
    delimiterLine: first + 1,
    aligns: aligns.slice(0, columns),
    columns,
    leadingPipe,
    trailingPipe,
  };
}

/** Which row (0 = header) and column the position is in. The delimiter row counts as the header. */
function cellIndex(state: EditorState, table: SourceTable, pos: number) {
  const lineNumber = state.doc.lineAt(pos).number;
  const line = lineNumber === table.delimiterLine ? table.lines[0] : lineNumber;
  const row = Math.max(0, table.lines.indexOf(line));
  let column = 0;
  table.rows[row].forEach((cell, i) => {
    if (pos >= cell.start) column = i;
  });
  return { row, column: Math.min(column, table.columns - 1) };
}

// ---------------------------------------------------------------------------
// Writing a table
// ---------------------------------------------------------------------------

export interface TableModel {
  rows: string[][];
  aligns: Align[];
  leadingPipe: boolean;
  trailingPipe: boolean;
}

const modelOf = (table: SourceTable): TableModel => ({
  rows: table.rows.map((cells) => cells.map((c) => c.text)),
  aligns: [...table.aligns],
  leadingPipe: table.leadingPipe,
  trailingPipe: table.trailingPipe,
});

function pad(text: string, width: number, align: Align): string {
  const space = width - stringWidth(text);
  if (space <= 0) return text;
  if (align === "right") return " ".repeat(space) + text;
  if (align === "center") {
    const left = Math.floor(space / 2);
    return " ".repeat(left) + text + " ".repeat(space - left);
  }
  return text + " ".repeat(space);
}

function delimiter(align: Align, width: number): string {
  const dashes = (n: number) => "-".repeat(Math.max(1, n));
  switch (align) {
    case "left":
      return `:${dashes(width - 1)}`;
    case "right":
      return `${dashes(width - 1)}:`;
    case "center":
      return `:${dashes(width - 2)}:`;
    default:
      return dashes(width);
  }
}

/**
 * The table's source text, and where each cell's content starts (relative to
 * the start of the text), for rows[r][c]. `padded` lines the columns up.
 */
export function renderTable(model: TableModel, padded: boolean) {
  const columns = model.aligns.length;
  const rows = model.rows.map((r) => [
    ...r,
    ...Array<string>(Math.max(0, columns - r.length)).fill(""),
  ]);
  const widths = model.aligns.map((align, c) =>
    padded ? Math.max(align === "center" ? 5 : 3, ...rows.map((r) => stringWidth(r[c] ?? ""))) : 3,
  );
  const positions: number[][] = [];
  const lines: string[] = [];
  let offset = 0;

  const writeLine = (cells: string[], aligns: Align[], record: boolean) => {
    const starts: number[] = [];
    let line = model.leadingPipe ? "| " : "";
    cells.forEach((cell, c) => {
      if (c > 0) line += " | ";
      const text = padded && c < columns ? pad(cell, widths[c], aligns[c] ?? "none") : cell;
      const lead = text.length - text.trimStart().length;
      starts.push(offset + line.length + (cell ? lead : 0));
      line += text;
    });
    if (model.trailingPipe) line += " |";
    if (record) positions.push(starts);
    lines.push(line);
    offset += line.length + 1;
  };

  rows.forEach((cells, r) => {
    writeLine(cells, model.aligns, true);
    if (r === 0) {
      writeLine(
        model.aligns.map((a, c) => delimiter(a, widths[c])),
        model.aligns.map(() => "none"),
        false,
      );
    }
  });
  return { text: lines.join("\n"), positions, rows };
}

/** Replaces the table with `model` and puts the cursor in cell [row][column] (selecting its text). */
function replaceTable(
  table: { from: number; to: number },
  model: TableModel,
  padded: boolean,
  target: { row: number; column: number },
) {
  const { text, positions, rows } = renderTable(model, padded);
  const row = Math.min(Math.max(0, target.row), positions.length - 1);
  const column = Math.min(Math.max(0, target.column), positions[row].length - 1);
  const from = table.from + positions[row][column];
  const content = rows[row][column] ?? "";
  return {
    changes: { from: table.from, to: table.to, insert: text },
    selection: EditorSelection.range(from, from + content.length),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Insert > Table: an empty table with a header row, below the current paragraph. */
export function insertTable(rows: number, columns: number, padded: boolean): Edit {
  return (state) => {
    const model: TableModel = {
      rows: Array.from({ length: Math.max(1, rows) }, () => Array<string>(columns).fill("")),
      aligns: Array<Align>(columns).fill("none"),
      leadingPipe: true,
      trailingPipe: true,
    };
    const { text, positions } = renderTable(model, padded);
    const line = state.doc.lineAt(state.selection.main.head);
    const blank = !line.text.trim();
    const before = blank
      ? line.number > 1 && state.doc.line(line.number - 1).text.trim()
        ? "\n"
        : ""
      : "\n\n";
    const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    const after = nextLine && nextLine.text.trim() ? "\n" : "";
    const at = blank ? line.from : line.to;
    const insert = `${before}${text}${after}`;
    return {
      changes: { from: at, to: line.to, insert },
      selection: EditorSelection.cursor(at + before.length + positions[0][0]),
    };
  };
}

/** Format Table, and the alignment when the cursor leaves a table. */
export function formatTable(pos?: number): Edit {
  return (state) => {
    const at = pos ?? state.selection.main.head;
    const table = tableAt(state, at);
    if (!table) return null;
    const { text } = renderTable(modelOf(table), true);
    if (text === state.sliceDoc(table.from, table.to)) return { selection: state.selection };
    const changes = state.changes({ from: table.from, to: table.to, insert: text });
    return { changes, selection: state.selection.map(changes) };
  };
}

/**
 * Tab / Shift+Tab: the next or previous cell, with its text selected. Tab in
 * the last cell adds a row, as in Word. Declines outside tables.
 */
export function moveToCell(step: 1 | -1, padded: boolean): Edit {
  return (state) => {
    const head = state.selection.main.head;
    const table = tableAt(state, head);
    if (!table) return null;
    const { row, column } = cellIndex(state, table, head);
    const index = Math.max(0, row * table.columns + column + step);
    const target = { row: Math.floor(index / table.columns), column: index % table.columns };
    const addRow = target.row >= table.rows.length;
    if (padded) {
      const model = modelOf(table);
      if (addRow) model.rows.push(Array<string>(table.columns).fill(""));
      return replaceTable(table, model, true, target);
    }
    if (addRow) {
      // Without automatic alignment, only the new row is written.
      const { text, positions } = renderTable(
        { ...modelOf(table), rows: [Array<string>(table.columns).fill("")] },
        false,
      );
      const row = text.split("\n")[0];
      return {
        changes: { from: table.to, insert: `\n${row}` },
        selection: EditorSelection.cursor(table.to + 1 + positions[0][0]),
      };
    }
    const cell = table.rows[target.row][target.column] ?? table.rows[target.row].at(-1)!;
    return { selection: EditorSelection.range(cell.from, cell.to) };
  };
}

export type TableOperation =
  | "insertRowAbove"
  | "insertRowBelow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteRow"
  | "deleteColumn"
  | "delete"
  | "alignLeft"
  | "alignCenter"
  | "alignRight";

/** The table commands of the Format menu and the editor's right-click menu. Declines outside tables. */
export function editTable(operation: TableOperation, padded: boolean): Edit {
  return (state) => {
    const head = state.selection.main.head;
    const table = tableAt(state, head);
    if (!table) return null;
    const { row, column } = cellIndex(state, table, head);
    const model = modelOf(table);
    const empty = () => Array<string>(table.columns).fill("");
    let target = { row, column };

    switch (operation) {
      case "insertRowAbove":
        model.rows.splice(row, 0, empty());
        break;
      case "insertRowBelow":
        model.rows.splice(row + 1, 0, empty());
        target = { row: row + 1, column };
        break;
      case "insertColumnLeft":
      case "insertColumnRight": {
        const at = operation === "insertColumnLeft" ? column : column + 1;
        model.rows.forEach((r) => r.splice(at, 0, ""));
        model.aligns.splice(at, 0, "none");
        target = { row, column: at };
        break;
      }
      case "deleteRow":
        if (model.rows.length === 1) return deleteWholeTable(state, table);
        model.rows.splice(row, 1);
        target = { row: Math.min(row, model.rows.length - 1), column };
        break;
      case "deleteColumn":
        if (table.columns === 1) return deleteWholeTable(state, table);
        model.rows.forEach((r) => r.splice(column, 1));
        model.aligns.splice(column, 1);
        target = { row, column: Math.min(column, table.columns - 2) };
        break;
      case "delete":
        return deleteWholeTable(state, table);
      case "alignLeft":
      case "alignCenter":
      case "alignRight":
        model.aligns[column] =
          operation === "alignLeft" ? "left" : operation === "alignCenter" ? "center" : "right";
        break;
    }
    return replaceTable(table, model, padded, target);
  };
}

/** Removes the table and one of the blank lines around it. */
function deleteWholeTable(state: EditorState, table: SourceTable) {
  let { from, to } = table;
  const last = state.doc.lineAt(to);
  if (last.number < state.doc.lines && !state.doc.line(last.number + 1).text.trim()) {
    to = state.doc.line(last.number + 1).to;
  }
  if (to < state.doc.length) to++;
  else if (from > 0) from--;
  return { changes: { from, to }, selection: EditorSelection.cursor(from) };
}

/**
 * Lines a table up when the cursor leaves it (O16). Runs right after the
 * selection change, as its own Undo step; Undo and Redo never trigger it.
 */
export const alignTablesOnLeave = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return;
  if (update.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
  const table = tableAt(update.startState, update.startState.selection.main.head);
  if (!table) return;
  const from = update.changes.mapPos(table.from, 1);
  const to = update.changes.mapPos(table.to, -1);
  const head = update.state.selection.main.head;
  if (head >= from && head <= to) return;
  const { view, state } = update;
  queueMicrotask(() => {
    if (view.state === state) runEdit(view, formatTable(from));
  });
});
