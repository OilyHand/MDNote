// The Files tab (O14): the window's folder as a tree. Folders load when they
// are expanded; Rust reports outside changes. Clicking a note opens it, and
// the note in the active tab is highlighted. Right-click for the file
// operations; drag an entry onto a folder to move it; F2 renames, Delete deletes.
// (Tauri's file drop handling disables HTML drag-and-drop, so dragging uses
// pointer events, as the tab bar does.)

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FolderEntry } from "../ipc";
import { baseName } from "../documents/naming";
import { useDocs } from "../state/documents";
import {
  isWithin,
  loadFolder,
  pathKey,
  revealInTree,
  setExpanded,
  sortEntries,
  useFolder,
} from "../state/folder";
import { useView } from "../state/view";
import { requestOpen } from "../app/commands";
import { runCommand } from "../app/run";
import { closeFolder } from "../state/folder";
import { ContextMenu, SEPARATOR, type MenuItem } from "../app/Menu";
import {
  copyPath,
  deleteEntry,
  moveEntry,
  newFolderIn,
  newNoteIn,
  openEntry,
  renameEntry,
  revealEntry,
} from "./fileOps";
import { dirName } from "./relink";

const DRAG_THRESHOLD_PX = 5;

interface Drag {
  path: string;
  name: string;
  x: number;
  y: number;
  /** The folder it would be dropped into, if that is allowed. */
  target: string | null;
}

/** All entries currently listed, to find one by path. */
function findEntry(path: string): FolderEntry | undefined {
  const key = pathKey(path);
  for (const entries of Object.values(useFolder.getState().contents)) {
    const entry = entries.find((e) => pathKey(e.path) === key);
    if (entry) return entry;
  }
  return undefined;
}

export function FolderTree() {
  const { t } = useTranslation();
  const root = useFolder((s) => s.root);
  const activePath = useDocs((s) => s.docs.find((d) => d.id === s.activeId)?.path ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // The note in the active tab shows in the tree.
  useEffect(() => {
    if (activePath) void revealInTree(activePath);
  }, [activePath, root]);

  if (!root) {
    return (
      <div className="sidebar-empty">
        <p>{t("sidebar.noFolder")}</p>
        <button type="button" onClick={() => runCommand("file.openFolder")}>
          {t("commands.file.openFolder")}
        </button>
      </div>
    );
  }

  const folderItems = (folder: string): MenuItem[] => [
    { label: t("folder.newNote"), action: () => void newNoteIn(folder) },
    { label: t("folder.newFolder"), action: () => void newFolderIn(folder) },
  ];

  const backgroundItems = (): MenuItem[] => {
    const sort = useView.getState().folderSort;
    return [
      ...folderItems(root),
      SEPARATOR,
      {
        label: t("folder.sortByName"),
        checked: sort === "name",
        action: () => useView.setState({ folderSort: "name" }),
      },
      {
        label: t("folder.sortByModified"),
        checked: sort === "modified",
        action: () => useView.setState({ folderSort: "modified" }),
      },
      SEPARATOR,
      { label: t("folder.refresh"), action: () => void loadFolder(root).catch(() => {}) },
      { label: t("folder.reveal"), action: () => revealEntry(root) },
      SEPARATOR,
      { label: t("commands.file.closeFolder"), action: closeFolder },
    ];
  };

  const entryItems = (entry: FolderEntry): MenuItem[] => [
    ...(entry.isDir
      ? []
      : [{ label: t("folder.open"), action: () => openEntry(entry, true) }, SEPARATOR]),
    ...folderItems(entry.isDir ? entry.path : dirName(entry.path)),
    SEPARATOR,
    {
      label: t("folder.rename"),
      shortcut: "F2",
      action: () => useFolder.setState({ renaming: { path: entry.path, openAfter: false } }),
    },
    { label: t("folder.delete"), shortcut: "Del", action: () => void deleteEntry(entry) },
    SEPARATOR,
    { label: t("folder.reveal"), action: () => revealEntry(entry.path) },
    { label: t("folder.copyPath"), action: () => copyPath(entry.path) },
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const entry = selected ? findEntry(selected) : undefined;
    if (!entry || useFolder.getState().renaming) return;
    if (event.key === "F2") {
      useFolder.setState({ renaming: { path: entry.path, openAfter: false } });
    } else if (event.key === "Delete") {
      void deleteEntry(entry);
    } else if (event.key === "Enter") {
      if (entry.isDir)
        void setExpanded(entry.path, !useFolder.getState().expanded[pathKey(entry.path)]);
      else openEntry(entry, true);
    } else {
      return;
    }
    event.preventDefault();
  };

  /** Pressing on an entry and moving the mouse drags it; releasing on a folder moves it there. */
  const startDrag = (event: React.PointerEvent, entry: FolderEntry) => {
    if (event.button !== 0 || useFolder.getState().renaming) return;
    const source = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let target: string | null = null;
    source.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX)
        return;
      dragging = true;
      const over = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-folder]");
      const folder = over?.dataset.folder ?? null;
      const allowed =
        folder !== null &&
        !isWithin(folder, entry.path) &&
        pathKey(folder) !== pathKey(dirName(entry.path));
      target = allowed ? folder : null;
      setDrag({ path: entry.path, name: entry.name, x: e.clientX, y: e.clientY, target });
    };
    const onUp = () => {
      source.removeEventListener("pointermove", onMove);
      source.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (dragging) {
        // The click that ends a drag is not a click on the entry.
        source.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
        if (target) void moveEntry(entry.path, target);
      }
    };
    source.addEventListener("pointermove", onMove);
    source.addEventListener("pointerup", onUp);
  };

  const context = {
    selected,
    activePath,
    dropTarget: drag?.target ?? null,
    select: setSelected,
    startDrag,
    openMenu: (event: React.MouseEvent, entry: FolderEntry) => {
      event.preventDefault();
      event.stopPropagation();
      setSelected(entry.path);
      setMenu({ x: event.clientX, y: event.clientY, items: entryItems(entry) });
    },
  };

  return (
    <div className="folder">
      <div className="folder-header">
        <span className="folder-name" title={root}>
          {baseName(root)}
        </span>
        <button
          type="button"
          className="icon-button"
          title={t("folder.newNote")}
          aria-label={t("folder.newNote")}
          onClick={() => void newNoteIn(root)}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3M8 7.5v5M5.5 10h5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-button"
          title={t("folder.newFolder")}
          aria-label={t("folder.newFolder")}
          onClick={() => void newFolderIn(root)}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13zM8 7v5M5.5 9.5h5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-button"
          title={t("folder.more")}
          aria-label={t("folder.more")}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom, items: backgroundItems() });
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M3 8h.01M8 8h.01M13 8h.01" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div
        className={`folder-tree${drag?.target && pathKey(drag.target) === pathKey(root) ? " drop-target" : ""}`}
        role="tree"
        tabIndex={0}
        data-folder={root}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: backgroundItems() });
        }}
      >
        <TreeLevel dir={root} depth={0} context={context} />
      </div>
      {drag ? (
        <div className="tree-drag-label" style={{ left: drag.x + 12, top: drag.y + 8 }}>
          {drag.name}
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  );
}

interface TreeContext {
  selected: string | null;
  activePath: string | null;
  dropTarget: string | null;
  select(path: string): void;
  startDrag(event: React.PointerEvent, entry: FolderEntry): void;
  openMenu(event: React.MouseEvent, entry: FolderEntry): void;
}

function TreeLevel({ dir, depth, context }: { dir: string; depth: number; context: TreeContext }) {
  const entries = useFolder((s) => s.contents[pathKey(dir)]);
  const sort = useView((s) => s.folderSort);
  if (!entries) return null;
  return (
    <>
      {sortEntries(entries, sort).map((entry) => (
        <TreeEntry key={entry.path} entry={entry} depth={depth} context={context} />
      ))}
    </>
  );
}

function TreeEntry({
  entry,
  depth,
  context,
}: {
  entry: FolderEntry;
  depth: number;
  context: TreeContext;
}) {
  const expanded = useFolder((s) => Boolean(s.expanded[pathKey(entry.path)]));
  const renaming = useFolder((s) => s.renaming);
  const key = pathKey(entry.path);
  const isRenaming = renaming !== null && pathKey(renaming.path) === key;
  const classes = [
    "tree-item",
    entry.isDir ? "is-folder" : entry.isNote ? "is-note" : "is-file",
    context.activePath && pathKey(context.activePath) === key ? "active" : "",
    context.selected && pathKey(context.selected) === key ? "selected" : "",
    context.dropTarget && pathKey(context.dropTarget) === key ? "drop-target" : "",
  ];

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={entry.isDir ? expanded : undefined}
        aria-selected={context.selected !== null && pathKey(context.selected) === key}
        className={classes.filter(Boolean).join(" ")}
        style={{ paddingLeft: 6 + depth * 14 }}
        data-folder={entry.isDir ? entry.path : undefined}
        title={entry.path}
        onPointerDown={(e) => context.startDrag(e, entry)}
        onClick={() => {
          context.select(entry.path);
          if (entry.isDir) void setExpanded(entry.path, !expanded);
          else openEntry(entry);
        }}
        onDoubleClick={() => !entry.isDir && openEntry(entry, true)}
        onContextMenu={(e) => context.openMenu(e, entry)}
      >
        <span className="twisty" aria-hidden>
          {entry.isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        {isRenaming ? (
          <RenameBox entry={entry} openAfter={renaming.openAfter} />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
      </div>
      {entry.isDir && expanded ? (
        <TreeLevel dir={entry.path} depth={depth + 1} context={context} />
      ) : null}
    </>
  );
}

/** Renaming in place: Enter or leaving the box renames, Esc cancels. */
function RenameBox({ entry, openAfter }: { entry: FolderEntry; openAfter: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // The name without its extension is selected, as in File Explorer.
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry]);

  const finish = async (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    useFolder.setState({ renaming: null });
    const name = ref.current?.value ?? entry.name;
    const path = commit ? await renameEntry(entry.path, name) : entry.path;
    if (openAfter && path) void requestOpen([path]);
  };

  return (
    <input
      ref={ref}
      className="tree-rename"
      defaultValue={entry.name}
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void finish(true);
        else if (e.key === "Escape") void finish(false);
      }}
      onBlur={() => void finish(true)}
    />
  );
}
