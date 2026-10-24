// The folder in this window's sidebar (O14): which folders are expanded and
// what they contain. Rust lists one folder level at a time and reports changes
// made outside MDNote ("folder-changed"); only folders on screen are loaded.

import { create } from "zustand";
import { api, type FolderEntry } from "../ipc";
import { notifyError } from "./notices";
import { usePrefs } from "./prefs";
import type { FolderSort } from "./view";

/** Windows paths compare without regard to case or slash direction. */
export const pathKey = (path: string) =>
  path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Whether `path` is `folder` or inside it. */
export const isWithin = (path: string, folder: string) => {
  const key = pathKey(path);
  const base = pathKey(folder);
  return key === base || key.startsWith(`${base}\\`);
};

interface FolderStore {
  root: string | null;
  /** Contents of the loaded folders, by pathKey. */
  contents: Record<string, FolderEntry[]>;
  expanded: Record<string, boolean>;
  /** The entry whose name is being edited in place; a new note opens afterwards. */
  renaming: { path: string; openAfter: boolean } | null;
}

export const useFolder = create<FolderStore>(() => ({
  root: null,
  contents: {},
  expanded: {},
  renaming: null,
}));

/** Lists `dir` again. A folder that disappeared is dropped from the tree. */
export async function loadFolder(dir: string) {
  const showAll = usePrefs.getState().preferences.sidebarShowAllFiles;
  try {
    const entries = await api.listFolder(dir, showAll);
    useFolder.setState((s) => ({ contents: { ...s.contents, [pathKey(dir)]: entries } }));
  } catch (error) {
    useFolder.setState((s) => {
      const contents = { ...s.contents };
      delete contents[pathKey(dir)];
      return { contents };
    });
    const root = useFolder.getState().root;
    if (root && pathKey(root) === pathKey(dir)) throw error;
  }
}

/** File > Open Folder…, and session restore. False if the folder cannot be read. */
export async function openFolder(path: string): Promise<boolean> {
  useFolder.setState({
    root: path,
    contents: {},
    expanded: { [pathKey(path)]: true },
    renaming: null,
  });
  try {
    await loadFolder(path);
  } catch (error) {
    closeFolder();
    notifyError(error);
    return false;
  }
  api.watchFolder(path).catch(notifyError);
  return true;
}

export function closeFolder() {
  useFolder.setState({ root: null, contents: {}, expanded: {}, renaming: null });
  api.unwatchFolder().catch(() => {});
}

export async function setExpanded(dir: string, open: boolean) {
  useFolder.setState((s) => ({ expanded: { ...s.expanded, [pathKey(dir)]: open } }));
  if (open) await loadFolder(dir).catch(notifyError);
}

/** Folders that changed (Rust's "folder-changed"): reloaded if they are shown. */
export function refreshFolders(dirs: string[]) {
  const { contents } = useFolder.getState();
  for (const dir of dirs) if (contents[pathKey(dir)]) void loadFolder(dir).catch(() => {});
}

/** Every shown folder again (after Preferences changed which files are listed). */
export function reloadFolders() {
  const { contents } = useFolder.getState();
  const dirs = Object.values(contents).flatMap((entries) =>
    entries.filter((e) => e.isDir).map((e) => e.path),
  );
  const root = useFolder.getState().root;
  if (root) void loadFolder(root).catch(() => {});
  for (const dir of dirs) if (contents[pathKey(dir)]) void loadFolder(dir).catch(() => {});
}

/** Expands the folders above `path`, so the note shows in the tree. */
export async function revealInTree(path: string) {
  const root = useFolder.getState().root;
  if (!root || !isWithin(path, root) || pathKey(path) === pathKey(root)) return;
  const base = root.replace(/[\\/]+$/, "");
  const parts = path.slice(base.length + 1).split(/[\\/]/);
  parts.pop();
  let dir = base;
  for (const part of parts) {
    dir = `${dir}\\${part}`;
    if (!useFolder.getState().expanded[pathKey(dir)]) await setExpanded(dir, true);
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then by name (numbers in names counted as numbers) or newest first. */
export function sortEntries(entries: FolderEntry[], sort: FolderSort): FolderEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sort === "modified" && a.modifiedMs !== b.modifiedMs) return b.modifiedMs - a.modifiedMs;
    return collator.compare(a.name, b.name);
  });
}
