// Runs a command from the shortcut table (menus and keys share this).

import { api } from "../ipc";
import type { CommandId } from "../shortcuts/registry";
import { activeDoc } from "../state/documents";
import { notifyError } from "../state/notices";
import {
  closeDocument,
  cycleTab,
  editCommand,
  newDocument,
  openWithDialog,
  printDocument,
  saveDocument,
  saveDocumentAs,
} from "./commands";

export function runCommand(id: CommandId) {
  const active = activeDoc();
  switch (id) {
    case "file.new":
      newDocument();
      break;
    case "file.open":
      void openWithDialog();
      break;
    case "file.save":
      if (active) void saveDocument(active.id);
      break;
    case "file.saveAs":
      if (active) void saveDocumentAs(active.id);
      break;
    case "file.closeTab":
      if (active) void closeDocument(active.id);
      break;
    case "file.print":
      if (active) void printDocument();
      break;
    case "file.preferences":
      api.openPreferences().catch(notifyError);
      break;
    case "tab.next":
      cycleTab(1);
      break;
    case "tab.previous":
      cycleTab(-1);
      break;
    case "edit.undo":
    case "edit.redo":
    case "edit.cut":
    case "edit.copy":
    case "edit.paste":
    case "edit.selectAll":
      editCommand(id.slice("edit.".length) as Parameters<typeof editCommand>[0]);
      break;
  }
}
