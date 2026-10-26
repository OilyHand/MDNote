// Runs a command from the shortcut table (menus and keys share this).

import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "../i18n";
import { api } from "../ipc";
import { COMMANDS, type CommandId } from "../shortcuts/registry";
import { getActiveView } from "../editor/view";
import { openFind, openGoToLine, openReplace } from "../editor/search";
import { activeDoc } from "../state/documents";
import { notifyError, notifyInfo } from "../state/notices";
import { showShortcuts } from "../state/modal";
import { usePrefs } from "../state/prefs";
import { fitPageWidth, setViewMode, setZoom, useView, zoomBy } from "../state/view";
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
import { isTableCommand, runEditorCommand } from "./editorCommands";
import { moveToNewWindow } from "./tabWindows";
import { open } from "@tauri-apps/plugin-dialog";
import { closeFolder, openFolder } from "../state/folder";

/** File > Open Folder…: the folder shows in the sidebar's Files tab (O14). */
async function openFolderWithDialog() {
  const picked = await open({ directory: true });
  if (typeof picked !== "string") return;
  if (await openFolder(picked)) useView.setState({ sidebar: true, sidebarTab: "files" });
}

/** The editor, shown and focused, for commands that work on the text. */
function editorView() {
  if (!activeDoc()) return null;
  if (useView.getState().mode === "preview") setViewMode("split");
  const view = getActiveView();
  view?.focus();
  return view;
}

export function runCommand(id: CommandId) {
  const active = activeDoc();
  switch (id) {
    case "file.new":
      return newDocument();
    case "file.open":
      return void openWithDialog();
    case "file.openFolder":
      return void openFolderWithDialog();
    case "file.closeFolder":
      return closeFolder();
    case "file.save":
      return void (active && saveDocument(active.id));
    case "file.saveAs":
      return void (active && saveDocumentAs(active.id));
    case "file.print":
      return void (active && printDocument());
    case "file.closeTab":
      return void (active && closeDocument(active.id));
    case "file.preferences":
      return void api.openPreferences().catch(notifyError);
    case "file.moveToNewWindow":
      return void (active && moveToNewWindow(active.id));
    case "file.closeWindow":
      return void getCurrentWindow().close().catch(notifyError);
    case "file.exit":
      return void api.quitApp().catch(notifyError);
    case "tab.next":
      return cycleTab(1);
    case "tab.previous":
      return cycleTab(-1);

    case "edit.undo":
    case "edit.redo":
    case "edit.cut":
    case "edit.copy":
    case "edit.paste":
    case "edit.selectAll":
      return editCommand(id.slice("edit.".length) as Parameters<typeof editCommand>[0]);
    case "edit.find":
    case "edit.replace":
    case "edit.goToLine": {
      const view = editorView();
      if (!view) return;
      if (id === "edit.find") openFind(view);
      else if (id === "edit.replace") openReplace(view);
      else openGoToLine(view);
      return;
    }

    case "view.split":
      return setViewMode("split");
    case "view.source":
      return setViewMode("source");
    case "view.preview":
      return setViewMode("preview");
    case "view.zoomIn":
      return zoomBy(0.1);
    case "view.zoomOut":
      return zoomBy(-0.1);
    case "view.actualSize":
      return setZoom(1);
    case "view.fitWidth":
      return fitPageWidth();
    case "view.sidebar":
      return useView.setState(({ sidebar }) => ({ sidebar: !sidebar }));
    case "view.statusBar": {
      const { preferences, update } = usePrefs.getState();
      return void update({ statusBar: !preferences.statusBar });
    }
    case "view.shortcuts":
      return showShortcuts();
  }

  if ((COMMANDS[id] as { editor?: boolean }).editor) {
    const view = editorView();
    if (view && !runEditorCommand(id, view) && isTableCommand(id)) {
      notifyInfo(i18n.t("notices.notInTable"));
    }
  }
}
