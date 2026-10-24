// The folder sidebar's file operations (O14). Rust renames, moves and deletes,
// taking a note's .mdn and .assets along, and tells every window
// ("paths-moved"); this side asks the questions, keeps open tabs on the right
// files, and offers to fix links that a move would break.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import i18n from "../i18n";
import { api, type FolderEntry } from "../ipc";
import { baseName } from "../documents/naming";
import {
  changeDoc,
  editorStates,
  findByPath,
  updateDoc,
  useDocs,
  type Doc,
} from "../state/documents";
import { ask } from "../state/dialog";
import { notifyError, notifyInfo } from "../state/notices";
import { isWithin, loadFolder, pathKey, setExpanded, useFolder } from "../state/folder";
import { getActiveView, requestEditorFocus, viewShowing } from "../editor/view";
import { closeDocument, requestOpen } from "../app/commands";
import { companionMoves, dirName, relinks, type Relink } from "./relink";

const t = i18n.t.bind(i18n);
const NOTE = /\.(md|markdown)$/i;

/** Open tabs follow renames and moves made by any window (Rust's "paths-moved"). */
export function followMoves(moves: [string, string][]) {
  for (const doc of useDocs.getState().docs) {
    if (!doc.path) continue;
    const move = moves.find(([from]) => isWithin(doc.path!, from));
    if (move)
      updateDoc(doc.id, { path: move[1] + doc.path.slice(move[0].replace(/[\\/]+$/, "").length) });
  }
  // The renamed entry is no longer being renamed.
  const { renaming } = useFolder.getState();
  if (renaming && moves.some(([from]) => pathKey(from) === pathKey(renaming.path))) {
    useFolder.setState({ renaming: null });
  }
}

/** New Note: an empty note named "New note", whose name is then edited in place. */
export async function newNoteIn(folder: string) {
  try {
    const path = await api.createNote(folder, t("folder.newNoteName"));
    await setExpanded(folder, true);
    await loadFolder(folder);
    useFolder.setState({ renaming: { path, openAfter: true } });
  } catch (error) {
    notifyError(error);
  }
}

export async function newFolderIn(folder: string) {
  try {
    const path = await api.createFolder(folder, t("folder.newFolderName"));
    await setExpanded(folder, true);
    await loadFolder(folder);
    useFolder.setState({ renaming: { path, openAfter: false } });
  } catch (error) {
    notifyError(error);
  }
}

/** The path Rust gives a renamed entry: a note keeps its extension. */
function renamedPath(path: string, name: string): string {
  let newName = name.trim();
  if (NOTE.test(path) && !NOTE.test(newName)) newName += path.slice(path.lastIndexOf("."));
  return `${dirName(path)}\\${newName}`;
}

/** The text of a note: from its tab if it is open, otherwise from disk. */
async function noteText(path: string, doc: Doc | undefined): Promise<string> {
  if (doc) {
    const state = viewShowing(doc.id)?.state ?? editorStates.get(doc.id);
    if (state) return state.doc.toString();
  }
  return (await api.readDocument(path, false)).text;
}

function applyRelinks(text: string, changes: Relink[]): string {
  let result = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

/**
 * Renames or moves a note or folder. For a note whose relative links would no
 * longer reach their files, MDNote asks first, and can update the links: in
 * the open tab (as an edit to save), or else in the file itself.
 */
async function relocate(
  path: string,
  guessed: string,
  perform: () => Promise<string>,
): Promise<string | null> {
  const doc = findByPath(path);
  let broken: Set<string> | null = null;
  let update = false;
  if (NOTE.test(path)) {
    try {
      const plan = relinks(await noteText(path, doc), path, guessed, companionMoves(path, guessed));
      if (plan.length > 0) {
        const exists = await api.existingFiles(plan.map((change) => change.target));
        broken = new Set(plan.filter((_, i) => exists[i]).map((change) => pathKey(change.target)));
      }
    } catch {
      broken = null; // an unreadable note is moved without checking its links
    }
  }
  if (broken && broken.size > 0) {
    const choice = await ask({
      title: t("folder.relinkTitle"),
      message: t("folder.relinkMessage", { name: baseName(path), count: broken.size }),
      buttons: [
        { id: "update", label: t("folder.relinkUpdate"), primary: true },
        { id: "keep", label: t("folder.relinkKeep") },
        { id: "cancel", label: t("folder.cancel") },
      ],
      cancelId: "cancel",
    });
    if (choice === "cancel") return null;
    update = choice === "update";
  }

  let moved: string;
  try {
    moved = await perform();
  } catch (error) {
    notifyError(error);
    return null;
  }
  if (!update || !broken) return moved;

  // Worked out again for the actual new path and the text as it is now.
  const needed = (text: string) =>
    relinks(text, path, moved, companionMoves(path, moved)).filter((change) =>
      broken!.has(pathKey(change.target)),
    );
  if (doc) {
    changeDoc(doc.id, (state) => ({
      changes: needed(state.doc.toString()).map(({ from, to, insert }) => ({ from, to, insert })),
      userEvent: "input.relink",
    }));
    return moved;
  }
  try {
    const loaded = await api.readDocument(moved, false);
    const text = applyRelinks(loaded.text, needed(loaded.text));
    if (text !== loaded.text) {
      await api.writeDocument(moved, text, loaded.encoding, loaded.lineEnding, false);
    }
  } catch (error) {
    notifyError(error);
  }
  return moved;
}

/** Rename (F2, or in place after New Note / New Folder). Returns the new path. */
export async function renameEntry(path: string, name: string): Promise<string | null> {
  if (!name.trim() || name.trim() === baseName(path)) return path;
  return relocate(path, renamedPath(path, name), () => api.renameEntry(path, name));
}

/** Dragging an entry onto a folder. */
export async function moveEntry(path: string, folder: string) {
  if (pathKey(dirName(path)) === pathKey(folder)) return;
  if (isWithin(folder, path)) {
    notifyInfo(t("errors.intoItself"));
    return;
  }
  await relocate(path, `${folder}\\${baseName(path)}`, () => api.moveEntry(path, folder));
}

/**
 * Delete, after asking: to the Recycle Bin, a note with its .mdn and .assets.
 * Tabs of deleted notes close, unless they have unsaved changes, which stay
 * (with the "deleted" notice) so nothing is lost.
 */
export async function deleteEntry(entry: FolderEntry) {
  const choice = await ask({
    title: t("folder.deleteTitle", { name: entry.name }),
    message: t(entry.isDir ? "folder.deleteFolderMessage" : "folder.deleteNoteMessage"),
    buttons: [
      { id: "delete", label: t("folder.delete"), primary: true },
      { id: "cancel", label: t("folder.cancel") },
    ],
    cancelId: "cancel",
  });
  if (choice !== "delete") return;
  try {
    await api.deleteEntry(entry.path);
  } catch (error) {
    notifyError(error);
    return;
  }
  for (const doc of useDocs.getState().docs) {
    if (doc.path && isWithin(doc.path, entry.path) && !doc.dirty) void closeDocument(doc.id);
  }
}

/**
 * Opens a note from the tree. A click keeps the focus in the tree, so F2 and
 * Delete still act on it; Enter or a double-click (`focus`) moves on to the
 * editor. Other files are shown in File Explorer, never started.
 */
export function openEntry(entry: FolderEntry, focus = false) {
  if (!entry.isNote) {
    revealItemInDir(entry.path).catch(notifyError);
    return;
  }
  const doc = findByPath(entry.path);
  if (focus && doc && useDocs.getState().activeId === doc.id) {
    getActiveView()?.focus();
    return;
  }
  if (focus) requestEditorFocus();
  void requestOpen([entry.path]);
}

export function revealEntry(path: string) {
  revealItemInDir(path).catch(notifyError);
}

export function copyPath(path: string) {
  navigator.clipboard.writeText(path).catch(notifyError);
}
