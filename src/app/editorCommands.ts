// What each editor command in the shortcut table does. Keys reach these through
// the editor's keymap (editor/setup.ts); menus through runCommand().

import type { EditorView } from "@codemirror/view";
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import type { CommandId } from "../shortcuts/registry";
import { editorOptions } from "../editor/setup";
import { runEdit, type Edit } from "../editor/edits";
import { insertEquation, insertLink, linkTargetAt, toggleInline } from "../editor/inline";
import {
  indentListItem,
  insertPageBreak,
  outdentListItem,
  setHeading,
  setNormal,
  toggleCodeBlock,
  toggleList,
  toggleQuote,
} from "../editor/blocks";
import {
  editTable,
  formatTable,
  insertTable,
  moveToCell,
  type TableOperation,
} from "../editor/table";
import { askLink, askTableSize } from "../state/modal";

/** Source tables are padded unless automatic alignment is off in Preferences. */
const padded = () => editorOptions().formatTables;

const edit = (make: () => Edit) => (view: EditorView) => runEdit(view, make());
const table = (operation: TableOperation) => edit(() => editTable(operation, padded()));

async function insertLinkWithDialog(view: EditorView) {
  const target = linkTargetAt(view.state);
  const doc = view.state.doc;
  const result = await askLink({ text: target.text, url: target.url });
  view.focus();
  // The dialog blocks editing, but a reload from disk could still replace the text.
  if (!result || view.state.doc !== doc) return;
  runEdit(view, insertLink(target, result.text, result.url));
}

async function insertTableWithDialog(view: EditorView) {
  const size = await askTableSize();
  view.focus();
  if (size) runEdit(view, insertTable(size.rows, size.columns, padded()));
}

const COMMANDS: Partial<Record<CommandId, (view: EditorView) => boolean>> = {
  "edit.moveLineUp": moveLineUp,
  "edit.moveLineDown": moveLineDown,

  "format.bold": edit(() => toggleInline("bold")),
  "format.italic": edit(() => toggleInline("italic")),
  "format.underline": edit(() => toggleInline("underline")),
  "format.strikethrough": edit(() => toggleInline("strikethrough")),
  "format.code": edit(() => toggleInline("code")),

  "paragraph.heading1": edit(() => setHeading(1)),
  "paragraph.heading2": edit(() => setHeading(2)),
  "paragraph.heading3": edit(() => setHeading(3)),
  "paragraph.heading4": edit(() => setHeading(4)),
  "paragraph.heading5": edit(() => setHeading(5)),
  "paragraph.heading6": edit(() => setHeading(6)),
  "paragraph.normal": edit(() => setNormal),
  "paragraph.bulletList": edit(() => toggleList("bullet")),
  "paragraph.numberedList": edit(() => toggleList("numbered")),
  "paragraph.taskList": edit(() => toggleList("task")),
  "paragraph.quote": edit(() => toggleQuote),
  "paragraph.codeBlock": edit(() => toggleCodeBlock),
  "paragraph.indent": edit(() => indentListItem),
  "paragraph.outdent": edit(() => outdentListItem),

  "insert.link": (view) => {
    void insertLinkWithDialog(view);
    return true;
  },
  "insert.table": (view) => {
    void insertTableWithDialog(view);
    return true;
  },
  "insert.equation": edit(() => insertEquation),
  "insert.pageBreak": edit(() => insertPageBreak),

  "table.nextCell": edit(() => moveToCell(1, padded())),
  "table.previousCell": edit(() => moveToCell(-1, padded())),
  "table.insertRowAbove": table("insertRowAbove"),
  "table.insertRowBelow": table("insertRowBelow"),
  "table.insertColumnLeft": table("insertColumnLeft"),
  "table.insertColumnRight": table("insertColumnRight"),
  "table.deleteRow": table("deleteRow"),
  "table.deleteColumn": table("deleteColumn"),
  "table.delete": table("delete"),
  "table.alignLeft": table("alignLeft"),
  "table.alignCenter": table("alignCenter"),
  "table.alignRight": table("alignRight"),
  "table.format": edit(() => formatTable()),
};

/** Runs an editor command. Returns false if it does not apply here (Tab outside a table). */
export function runEditorCommand(id: CommandId, view: EditorView): boolean {
  const run = COMMANDS[id];
  return run ? run(view) : false;
}

/** Commands that act on a table; from a menu, they need the cursor in one. */
export const isTableCommand = (id: CommandId) => id.startsWith("table.");
