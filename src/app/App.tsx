import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api } from "../ipc";
import { commandFor } from "../shortcuts/registry";
import { activate, displayName, findByPath, useDocs } from "../state/documents";
import { useDialog } from "../state/dialog";
import { notifyError } from "../state/notices";
import {
  confirmCloseWindow,
  onDiskChange,
  openDocuments,
  requestOpen,
  restoreSession,
} from "./commands";
import { flushSession, startSessionReporting } from "./session";
import { runCommand } from "./run";
import { MenuBar } from "./MenuBar";
import { TabBar } from "./TabBar";
import { Workspace } from "./Workspace";
import { EmptyState } from "./EmptyState";
import { DiskBanner } from "./DiskBanner";
import { Notices } from "./Notices";
import { DialogHost } from "./DialogHost";

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
  await win.listen<{ path: string }>("focus-document", ({ payload }) => {
    const doc = findByPath(payload.path);
    if (doc) activate(doc.id);
  });
  await listen<{ path: string; kind: "changed" | "removed" }>(
    "document-disk-change",
    ({ payload }) => void onDiskChange(payload.path, payload.kind),
  );
  await win.onDragDropEvent(({ payload }) => {
    if (payload.type !== "drop") return;
    const files = payload.paths.filter((p) => OPENABLE.test(p));
    if (files.length > 0) void requestOpen(files);
  });
  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await confirmCloseWindow()) {
      await flushSession();
      await win.destroy();
    }
  });

  const startup = await api.takeStartup();
  await restoreSession(startup.tabs, startup.active, startup.paths);
  startSessionReporting();
  await flushSession();
}

/** Keys that would reload the page and lose unsaved text. */
function isReloadKey(event: KeyboardEvent) {
  return event.key === "F5" || (event.ctrlKey && event.code === "KeyR");
}

function useWindowShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (import.meta.env.PROD && isReloadKey(event)) {
        event.preventDefault();
        return;
      }
      if (useDialog.getState().queue.length > 0) return;
      const command = commandFor(event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
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
  useWindowTitle();
  usePageBreakLabel();

  return (
    <div className="app">
      <MenuBar />
      <TabBar />
      <main className="workspace">
        {active ? <DiskBanner doc={active} /> : null}
        {hasActive ? <Workspace /> : <EmptyState />}
      </main>
      <Notices />
      <DialogHost />
    </div>
  );
}
