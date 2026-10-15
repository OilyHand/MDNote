// What the menus, shortcuts and buttons do: the document lifecycle (O1).

import { open, save } from "@tauri-apps/plugin-dialog";
import { redo, selectAll, undo } from "@codemirror/commands";
import i18n from "../i18n";
import { api, toAppError, type LineEnding, type TabSession, type TextEncoding } from "../ipc";
import { baseName, encodingLabel, nextUntitledNumber, samePath } from "../documents/naming";
import { createEditorState } from "../editor/setup";
import { getActiveView } from "../editor/view";
import {
  activate,
  addDoc,
  displayName,
  editorStates,
  findByPath,
  getDoc,
  isSavedText,
  markSaved,
  markUnsaved,
  refreshDirty,
  removeDoc,
  scrollTops,
  updateDoc,
  useDocs,
  type Doc,
} from "../state/documents";
import { ask } from "../state/dialog";
import { notifyError, notifyInfo } from "../state/notices";
import { useRecent } from "../state/recent";
import { adoptUnsavedImages, discardUnsavedImages } from "./images";
import { setViewMode, useView } from "../state/view";

const t = i18n.t.bind(i18n);
let defaultLineEnding: LineEnding = "crlf";

export async function initCommands() {
  defaultLineEnding = await api.defaultLineEnding();
}

const fileFilters = () => [
  { name: t("fileTypes.markdown"), extensions: ["md", "markdown"] },
  { name: t("fileTypes.all"), extensions: ["*"] },
];

/** New tabs open to the right of the active one. */
function indexAfterActive(): number {
  const { docs, activeId } = useDocs.getState();
  const index = docs.findIndex((d) => d.id === activeId);
  return index < 0 ? docs.length : index + 1;
}

// ---------------------------------------------------------------------------
// New and open
// ---------------------------------------------------------------------------

export function newDocument() {
  const used = useDocs.getState().docs.flatMap((d) => (d.untitled ? [d.untitled] : []));
  const doc: Doc = {
    id: crypto.randomUUID(),
    path: null,
    untitled: nextUntitledNumber(used),
    encoding: { kind: "utf8" },
    lineEnding: defaultLineEnding,
    stamp: null,
    dirty: false,
    disk: "ok",
  };
  addDoc(doc, createEditorState(""), indexAfterActive());
}

export async function openWithDialog() {
  const picked = await open({ multiple: true, filters: fileFilters() });
  if (!picked) return;
  await requestOpen(Array.isArray(picked) ? picked : [picked]);
}

/** Asks Rust to open files; it switches to an existing tab if a file is already open. */
export async function requestOpen(paths: string[]) {
  try {
    await api.openPaths(paths);
  } catch (error) {
    notifyError(error);
  }
}

/** A single untouched, empty "Untitled" tab is replaced by the next opened file. */
function pristineUntitled(): Doc | undefined {
  const { docs } = useDocs.getState();
  const only = docs.length === 1 ? docs[0] : undefined;
  if (!only || only.path || only.dirty) return undefined;
  return editorStates.get(only.id)?.doc.length === 0 ? only : undefined;
}

interface OpenOptions {
  cursor?: number;
  scrollTop?: number;
  /** Collects files that are missing instead of reporting each one. */
  missing?: string[];
  /** Skip the encoding and line-ending notices (already shown when the file was first opened). */
  quiet?: boolean;
}

/** Reads a file and shows it in a new tab. Returns the new document, if any. */
async function openOne(path: string, options: OpenOptions = {}): Promise<Doc | undefined> {
  const existing = findByPath(path);
  if (existing) {
    activate(existing.id);
    return existing;
  }
  let loaded;
  try {
    loaded = await api.readDocument(path);
  } catch (error) {
    handleOpenError(path, error, options.missing);
    return undefined;
  }
  const replaced = pristineUntitled();
  if (replaced) removeDoc(replaced.id);

  const doc: Doc = {
    id: crypto.randomUUID(),
    path: loaded.path,
    untitled: null,
    encoding: loaded.encoding,
    lineEnding: loaded.lineEnding,
    stamp: loaded.stamp,
    dirty: false,
    disk: "ok",
  };
  addDoc(doc, createEditorState(loaded.text, options.cursor), indexAfterActive());
  if (options.scrollTop) scrollTops.set(doc.id, options.scrollTop);
  api.watchDocument(loaded.path, loaded.stamp).catch(notifyError);

  if (options.quiet) return doc;
  const name = baseName(loaded.path);
  if (loaded.ansiFallback && loaded.encoding.kind === "ansi") {
    notifyInfo(t("notices.ansiFallback", { name, codepage: loaded.encoding.codepage }));
  }
  if (loaded.mixedLineEndings) {
    notifyInfo(
      t("notices.mixedLineEndings", { name, lineEnding: t(`lineEnding.${loaded.lineEnding}`) }),
    );
  }
  return doc;
}

function handleOpenError(path: string, error: unknown, missing?: string[]) {
  const appError = toAppError(error);
  if (appError.code === "notFound" && missing) {
    missing.push(baseName(path));
    return;
  }
  if (appError.code === "notFound" && useRecent.getState().files.some((p) => samePath(p, path))) {
    api.removeRecentFile(path).catch(notifyError);
    notifyInfo(t("notices.recentMissing", { path }));
    return;
  }
  notifyError(error);
}

/** Rust routed these files to this window ("open-documents"). */
export async function openDocuments(paths: string[]) {
  for (const path of paths) await openOne(path);
}

/** Reopens the previous session's tabs, then any files from the command line. */
export async function restoreSession(tabs: TabSession[], active: number, paths: string[]) {
  const missing: string[] = [];
  const opened: (Doc | undefined)[] = [];
  for (const tab of tabs) {
    const options = { cursor: tab.cursor, scrollTop: tab.scrollTop, missing, quiet: true };
    opened.push(await openOne(tab.path, options));
  }
  const activeDoc = opened[active];
  if (activeDoc) activate(activeDoc.id);
  if (missing.length > 0) {
    notifyInfo(t("notices.sessionMissing", { count: missing.length, files: missing.join(", ") }));
  }
  await openDocuments(paths);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveDocument(id: string): Promise<boolean> {
  const doc = getDoc(id);
  if (!doc) return false;
  if (!doc.path) return saveDocumentAs(id);
  return writeTo(id, doc.path, doc.encoding);
}

export async function saveDocumentAs(id: string): Promise<boolean> {
  const doc = getDoc(id);
  if (!doc) return false;
  const path = await save({
    defaultPath: doc.path ?? `${displayName(doc)}.md`,
    filters: fileFilters(),
  });
  if (!path) return false;

  // Saving over a file that is open in another tab replaces that tab.
  const other = findByPath(path);
  if (other && other.id !== id) {
    if (other.dirty && !(await closeDocument(other.id))) return false;
    if (!other.dirty) closeQuietly(other);
  }
  return writeTo(id, path, doc.encoding);
}

async function writeTo(id: string, path: string, encoding: TextEncoding): Promise<boolean> {
  const doc = getDoc(id);
  if (!doc) return false;
  // First save: images pasted so far move next to the note, and their links follow.
  if (!doc.path) await adoptUnsavedImages(id, path).catch(notifyError);
  const state = editorStates.get(id);
  if (!state) return false;
  const snapshot = state.doc;
  try {
    const stamp = await api.writeDocument(path, snapshot.toString(), encoding, doc.lineEnding);
    if (doc.path && !samePath(doc.path, path)) api.unwatchDocument(doc.path).catch(() => {});
    updateDoc(id, { path, untitled: null, encoding, stamp, disk: "ok" });
    markSaved(id, snapshot);
    // Typing may have continued while the file was being written.
    const latest = editorStates.get(id);
    if (latest) refreshDirty(id, latest.doc);
    api.watchDocument(path, stamp).catch(notifyError);
    return true;
  } catch (error) {
    if (toAppError(error).code === "unmappable" && encoding.kind !== "utf8") {
      const choice = await ask({
        title: t("dialog.unmappable.title"),
        message: t("dialog.unmappable.message", {
          name: displayName(doc),
          encoding: encodingLabel(encoding),
        }),
        buttons: [
          { id: "utf8", label: t("dialog.unmappable.saveUtf8"), primary: true },
          { id: "cancel", label: t("dialog.unmappable.cancel") },
        ],
        cancelId: "cancel",
      });
      return choice === "utf8" ? writeTo(id, path, { kind: "utf8" }) : false;
    }
    notifyError(error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

type UnsavedChoice = "save" | "discard" | "cancel";

function askUnsaved(doc: Doc): Promise<UnsavedChoice> {
  return ask({
    title: t("dialog.unsaved.title"),
    message: t("dialog.unsaved.message", { name: displayName(doc) }),
    buttons: [
      { id: "save", label: t("dialog.unsaved.save"), primary: true },
      { id: "discard", label: t("dialog.unsaved.dontSave") },
      { id: "cancel", label: t("dialog.unsaved.cancel") },
    ],
    cancelId: "cancel",
  }) as Promise<UnsavedChoice>;
}

/** Asks about unsaved changes. Returns false if the user cancelled or saving failed. */
async function confirmDiscard(doc: Doc): Promise<boolean> {
  if (!doc.dirty) return true;
  activate(doc.id);
  const choice = await askUnsaved(doc);
  if (choice === "cancel") return false;
  if (choice === "save") return saveDocument(doc.id);
  return true;
}

function closeQuietly(doc: Doc) {
  if (doc.path) api.unwatchDocument(doc.path).catch(() => {});
  else discardUnsavedImages(doc.id);
  removeDoc(doc.id);
}

export async function closeDocument(id: string): Promise<boolean> {
  const doc = getDoc(id);
  if (!doc) return true;
  if (!(await confirmDiscard(doc))) return false;
  closeQuietly(getDoc(id) ?? doc);
  return true;
}

/** Before the window closes: ask about every unsaved document, in tab order. */
export async function confirmCloseWindow(): Promise<boolean> {
  for (const { id } of useDocs.getState().docs) {
    const doc = getDoc(id);
    if (doc && !(await confirmDiscard(doc))) return false;
  }
  // Notes that were never saved are gone with the window, and so are their images.
  for (const doc of useDocs.getState().docs) if (!doc.path) discardUnsavedImages(doc.id);
  return true;
}

// ---------------------------------------------------------------------------
// Changes made by other programs
// ---------------------------------------------------------------------------

export async function onDiskChange(path: string, kind: "changed" | "removed") {
  const doc = findByPath(path);
  if (!doc) return;
  if (kind === "changed" && !doc.dirty && (await diskMatchesSaved(doc))) return;
  updateDoc(doc.id, { disk: kind });
  if (kind === "removed") markUnsaved(doc.id);
}

/**
 * Another program saved the file without changing it (e.g. Ctrl+S in Notepad with
 * no edits). Then there is nothing to reload: just note the new version on disk.
 */
async function diskMatchesSaved(doc: Doc): Promise<boolean> {
  if (!doc.path) return false;
  try {
    const loaded = await api.readDocument(doc.path, false);
    const same =
      isSavedText(doc.id, loaded.text) &&
      loaded.lineEnding === doc.lineEnding &&
      JSON.stringify(loaded.encoding) === JSON.stringify(doc.encoding);
    if (same) updateDoc(doc.id, { stamp: loaded.stamp, disk: "ok" });
    return same;
  } catch {
    return false; // could not read it: show the banner, which offers Reload
  }
}

export async function reloadFromDisk(id: string) {
  const doc = getDoc(id);
  if (!doc?.path) return;
  try {
    const loaded = await api.readDocument(doc.path);
    const view = getActiveView();
    const state = editorStates.get(id);
    if (!state) return;
    // A normal edit, so Ctrl+Z can bring back the text from before the reload.
    const spec = { changes: { from: 0, to: state.doc.length, insert: loaded.text } };
    if (useDocs.getState().activeId === id && view) view.dispatch(spec);
    else editorStates.set(id, state.update(spec).state);
    updateDoc(id, {
      encoding: loaded.encoding,
      lineEnding: loaded.lineEnding,
      stamp: loaded.stamp,
      disk: "ok",
    });
    markSaved(id, editorStates.get(id)!.doc);
  } catch (error) {
    notifyError(error);
  }
}

export function keepMyVersion(id: string) {
  updateDoc(id, { disk: "ok" });
  markUnsaved(id);
}

// ---------------------------------------------------------------------------
// Tabs and editing
// ---------------------------------------------------------------------------

/**
 * Prints the rendered view with the print style sheet (O2). In Source Only
 * mode the preview is shown first, so there is something to print.
 */
export async function printDocument() {
  if (useView.getState().mode === "source") {
    setViewMode("split");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  window.print();
}

export function cycleTab(step: 1 | -1) {
  const { docs, activeId } = useDocs.getState();
  if (docs.length < 2) return;
  const index = docs.findIndex((d) => d.id === activeId);
  activate(docs[(index + step + docs.length) % docs.length].id);
}

export function editCommand(command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll") {
  const view = getActiveView();
  if (!view) return;
  view.focus();
  switch (command) {
    case "undo":
      undo(view);
      break;
    case "redo":
      redo(view);
      break;
    case "selectAll":
      selectAll(view);
      break;
    case "paste":
      navigator.clipboard
        .readText()
        .then((text) => view.dispatch(view.state.replaceSelection(text)))
        .catch(() => notifyInfo(t("notices.pasteBlocked")));
      break;
    default:
      document.execCommand(command);
  }
}
