// List conveniences (O17): Enter continues a list or quote, Enter on an empty
// item ends it, and numbered lists renumber themselves after every edit.

import {
  EditorSelection,
  EditorState,
  Transaction,
  type ChangeSpec,
  type StateCommand,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
} from "@codemirror/lang-markdown";
import { parseLine, treeUpTo } from "./edits";

/**
 * Enter on an empty top-level item ends the list, as in Word. Markdown needs a
 * blank line for that, or the next line would still belong to the item above.
 */
export const endListOnEmptyItem: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const parts = parseLine(line.text);
  const empty = parts.marker && !parts.content.trim() && !parts.heading;
  if (!empty || parts.indent || parts.quote || range.head !== line.to) return false;
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : "";
  const insert = previous.trim() ? "\n" : "";
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(line.from + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

/** Enter and Backspace in lists and quotes. */
export const listContinuation = keymap.of([
  { key: "Enter", run: endListOnEmptyItem },
  { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
  { key: "Backspace", run: deleteMarkupBackward },
]);

const ORDERED_ITEM = /^(?:[ \t]*>[ \t]?)*[ \t]*\d{1,9}[.)]/;

/**
 * The numbers an ordered list should have, as changes to the existing ones.
 * A list counts on from its first item's number, so typing "5." there makes it
 * start at 5. After lines are moved, though, the first item may be one that
 * came from further down: then the list starts at its lowest number, which
 * is where it started before the move.
 */
export function renumberChanges(
  state: EditorState,
  from: number,
  to: number,
  start: "first" | "lowest" = "first",
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  treeUpTo(state, to).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "OrderedList") return;
      const marks: { from: number; to: number; text: string }[] = [];
      for (let item = node.node.firstChild; item; item = item.nextSibling) {
        const mark = item.name === "ListItem" ? item.getChild("ListMark") : null;
        if (mark)
          marks.push({ from: mark.from, to: mark.to, text: state.sliceDoc(mark.from, mark.to) });
      }
      if (marks.length === 0) return;
      const numbers = marks.map((m) => Number.parseInt(m.text, 10));
      let expected = start === "lowest" ? Math.min(...numbers) : numbers[0];
      marks.forEach((mark, i) => {
        if (numbers[i] !== expected) {
          changes.push({
            from: mark.from,
            to: mark.to,
            insert: `${expected}${mark.text.slice(-1)}`,
          });
        }
        expected++;
      });
    },
  });
  return changes;
}

/**
 * After an edit near a numbered list, fixes its numbers in the same transaction,
 * so one Undo takes back both. Undo and Redo themselves are left alone.
 */
export const renumberLists = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const event = tr.annotation(Transaction.userEvent);
  if (!event || event.startsWith("undo") || event.startsWith("redo")) return tr;
  const doc = tr.newDoc;
  let from = doc.length;
  let to = 0;
  let nearList = false;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const first = Math.max(1, doc.lineAt(fromB).number - 1);
    const last = Math.min(doc.lines, doc.lineAt(toB).number + 1);
    for (let n = first; n <= last && !nearList; n++) {
      nearList = ORDERED_ITEM.test(doc.line(n).text);
    }
    from = Math.min(from, doc.line(first).from);
    to = Math.max(to, doc.line(last).to);
  });
  if (!nearList) return tr;
  const changes = renumberChanges(tr.state, from, to, tr.isUserEvent("move") ? "lowest" : "first");
  if (changes.length === 0) return tr;
  return [tr, { changes, sequential: true }];
});
