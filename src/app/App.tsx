import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api } from "../ipc";
import { EDITOR_COMMANDS, commandFor, commandsFor } from "../shortcuts/registry";
import { finishComposition, isModifiedKey } from "../editor/composition";
import { getActiveView } from "../editor/view";
import type { EditorView } from "@codemirror/view";
import { runEditorCommand } from "./editorCommands";
import { activate, displayName, findByPath, useDocs } from "../state/documents";
import { useDialog } from "../state/dialog";
import { isModalOpen } from "../state/modal";
import { notifyError } from "../state/notices";
import {
  confirmCloseWindow,
  onDiskChange,
  openDocuments,
  requestOpen,
  restoreSession,
} from "./commands";
import { flushSession, startSessionReporting } from "./session";
import { offerRecovery, startRecovery } from "./recovery";
import { startTabWindows, type TabTransfer } from "./tabWindows";
import { importImageFiles } from "./images";
import { isImagePath } from "../editor/images";
import { runCommand } from "./run";
import { MenuBar } from "./MenuBar";
import { TabBar } from "./TabBar";
import { Workspace } from "./Workspace";
import { EmptyState } from "./EmptyState";
import { DiskBanner } from "./DiskBanner";
import { Notices } from "./Notices";
import { DialogHost } from "./DialogHost";
import { StatusBar } from "./StatusBar";
import { ModalHost } from "./ModalHost";
import { Sidebar } from "../sidebar/Sidebar";
import { followMoves } from "../sidebar/fileOps";
import { openFolder, refreshFolders, reloadFolders } from "../state/folder";
import { useSummaryUpdates } from "../state/summary";
import { usePrefs } from "../state/prefs";

const OPENABLE = /\.(md|markdown|txt)$/i;
let started = false;

/** Event listeners, the close prompt, and session restore. Runs once per window. */
async function startWindow() {
  if (started) return;
  started = true;
  const win = getCurrentWebviewWindow();

  await win.listen<{ paths: string[] }>("open-documents", ({ payload }) => {
    void openDocuments(payload.paths);
  });
  // The folder sidebar (O14): changes made outside MDNote, and renames and
  // moves made in any window, which open tabs follow.
  await win.listen<{ dirs: string[] }>("folder-changed", ({ payload }) => {
    refreshFolders(payload.dirs);
  });
  await listen<{ moves: [string, string][] }>("paths-moved", ({ payload }) => {
    followMoves(payload.moves);
  });
  await win.listen<{ path: string }>("focus-document", ({ payload }) => {
    const doc = findByPath(payload.path);
    if (doc) activate(doc.id);
  });
  await listen<{ path: string; kind: "changed" | "removed" }>(
    "document-disk-change",
    ({ payload }) => void onDiskChange(payload.path, payload.kind),
  );
  // Markdown files open in tabs; images are added to the active note (O15).
  await win.onDragDropEvent(({ payload }) => {
    if (payload.type !== "drop") return;
    const files = payload.paths.filter((p) => OPENABLE.test(p));
    if (files.length > 0) void requestOpen(files);
    const images = payload.paths.filter(isImagePath);
    if (images.length > 0) {
      const scale = window.devicePixelRatio;
      const point = { x: payload.position.x / scale, y: payload.position.y / scale };
      void importImageFiles(images, point);
    }
  });
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await confirmCloseWindow()) {
      await flushSession();
      await win.destroy();
    } else {
      // Cancelled: if File > Exit was closing every window, MDNote keeps running.
      api.cancelQuit().catch(() => {});
    }
  });

  const startup = await api.takeStartup();
  await restoreSession(startup.tabs, startup.active, startup.paths);
  if (startup.folder) await openFolder(startup.folder);
  startRecovery();
  await startTabWindows(startup.transfers as TabTransfer[]);
  await offerRecovery();
  startSessionReporting();
  await flushSession();
}

/** Keys that would reload the page and lose unsaved text. */
function isReloadKey(event: KeyboardEvent) {
  return event.key === "F5" || (event.ctrlKey && event.code === "KeyR");
}

/** The editor, if the key event happened in it. */
function editorOf(event: KeyboardEvent): EditorView | null {
  const view = getActiveView();
  return view && view.contentDOM.contains(event.target as Node) ? view : null;
}

/** Runs the shortcut for a key event in the editor, after `ready`. False if it is not one. */
function runEditorShortcut(event: KeyboardEvent, view: EditorView, ready: () => Promise<void>) {
  const windowCommand = commandFor(event);
  const editorCommands = commandsFor(event, EDITOR_COMMANDS);
  if (!windowCommand && editorCommands.length === 0) return false;
  void ready().then(() => {
    if (windowCommand) runCommand(windowCommand);
    else editorCommands.some((id) => runEditorCommand(id, view));
  });
  return true;
}

function useWindowShortcuts() {
  useEffect(() => {
    /** Physical keys whose key-down reached the page, to notice key-downs an IME kept. */
    const down = new Set<string>();

    const onKeyDown = (event: KeyboardEvent) => {
      down.add(event.code);
      const view = getActiveView();
      if (event.isComposing || view?.composing) {
        // Typing goes to the IME; a Ctrl or Alt shortcut finishes the syllable, then runs.
        const editor = editorOf(event);
        if (!editor || !isModifiedKey(event)) return;
        if (runEditorShortcut(event, editor, () => finishComposition(editor))) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (import.meta.env.PROD && isReloadKey(event)) {
        event.preventDefault();
        return;
      }
      if (useDialog.getState().queue.length > 0 || isModalOpen()) return;
      const command = commandFor(event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
    };
    // The Microsoft Korean IME keeps some Alt shortcuts for itself (Alt+= among
    // them): the page gets their key-up but never their key-down. An Alt
    // shortcut whose key comes up without having gone down runs on the key-up.
    const onKeyUp = (event: KeyboardEvent) => {
      if (down.delete(event.code) || !event.altKey || event.isComposing) return;
      if (useDialog.getState().queue.length > 0 || isModalOpen()) return;
      const editor = editorOf(event);
      if (editor && runEditorShortcut(event, editor, () => Promise.resolve())) {
        event.preventDefault();
      }
    };
    const forget = () => down.clear();
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", forget);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", forget);
    };
  }, []);
}

/** Preferences can show other files in the folder tree: the tree is listed again. */
function useFolderPreferences() {
  const showAll = usePrefs((s) => s.preferences.sidebarShowAllFiles);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reloadFolders();
  }, [showAll]);
}

/** The label on page-break lines in the preview comes from CSS, in the UI language. */
function usePageBreakLabel() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--page-break-label",
      JSON.stringify(t("preview.pageBreak")),
    );
  }, [t, i18n.language]);
}

function useWindowTitle() {
  const { t, i18n } = useTranslation();
  const active = useDocs((s) => s.docs.find((d) => d.id === s.activeId));
  const title = active
    ? t("app.windowTitle", { name: (active.dirty ? "● " : "") + displayName(active) })
    : t("app.name");
  useEffect(() => {
    getCurrentWebviewWindow().setTitle(title).catch(notifyError);
  }, [title, i18n.language]);
}

export function App() {
  const hasActive = useDocs((s) => s.activeId !== null);
  const active = useDocs((s) => s.docs.find((d) => d.id === s.activeId));

  useEffect(() => {
    startWindow().catch(notifyError);
  }, []);
  useWindowShortcuts();
  useSummaryUpdates();
  useFolderPreferences();
  useWindowTitle();
  usePageBreakLabel();

  return (
    <div className="app">
      <MenuBar />
      <div className="window-body">
        <Sidebar />
        <div className="window-main">
          <TabBar />
          <main className="workspace">
            {active ? <DiskBanner doc={active} /> : null}
            {hasActive ? <Workspace /> : <EmptyState />}
          </main>
        </div>
      </div>
      <StatusBar />
      <Notices />
      <ModalHost />
      <DialogHost />
    </div>
  );
}
