// Tabs that move between windows (O1): Move to New Window, tearing a tab off
// by dragging it out of the tab bar, and dropping it on another window's tab
// bar. A moved tab keeps its text, metadata, Undo history and scroll position.
// Rust follows the mouse once the tab leaves the tab bar (tabs.rs).

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { create } from "zustand";
import { api } from "../ipc";
import { nextUntitledNumber } from "../documents/naming";
import { editorStateFromJSON, editorStateToJSON } from "../editor/setup";
import { viewShowing } from "../editor/view";
import {
  addDoc,
  displayName,
  editorStates,
  getDoc,
  moveDoc,
  removeDoc,
  savedMetaOf,
  savedTextOf,
  scrollTops,
  useDocs,
  type Doc,
} from "../state/documents";
import { notifyError } from "../state/notices";
import { handOverRecovery } from "./recovery";
import { flushSession } from "./session";

/** A tab on its way to another window. Rust passes it on without reading it. */
export interface TabTransfer {
  doc: Doc;
  /** The CodeMirror state with Undo history (editorStateToJSON). */
  state: unknown;
  /** The text on disk; null if the tab counts as changed until saved. */
  savedText: string | null;
  /** The `.mdmeta` text on disk (O7). */
  savedMeta: string | null;
  scrollTop: number;
}

/** The tab being dragged outside the tab bar, shown faded until the drag ends. */
export const useTabDrag = create<{ docId: string | null }>(() => ({ docId: null }));

function pack(id: string): TabTransfer | null {
  const doc = getDoc(id);
  const view = viewShowing(id);
  const state = view?.state ?? editorStates.get(id);
  if (!doc || !state) return null;
  return {
    doc,
    state: editorStateToJSON(state),
    savedText: savedTextOf(id),
    savedMeta: savedMetaOf(id),
    scrollTop: view ? view.scrollDOM.scrollTop : (scrollTops.get(id) ?? 0),
  };
}

/** The tab bar position where a drop at `clientX` lands. */
function indexAt(clientX: number): number {
  const tabs = [...document.querySelectorAll<HTMLElement>(".tabbar .tab")];
  const index = tabs.findIndex((el) => {
    const rect = el.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  return index < 0 ? tabs.length : index;
}

/** A tab arrives from another window. */
function attach(transfer: TabTransfer, index?: number) {
  if (getDoc(transfer.doc.id)) return;
  const doc = { ...transfer.doc };
  const used = useDocs.getState().docs.flatMap((d) => (d.untitled ? [d.untitled] : []));
  if (doc.untitled && used.includes(doc.untitled)) doc.untitled = nextUntitledNumber(used);
  addDoc(doc, editorStateFromJSON(transfer.state), index, {
    text: transfer.savedText,
    meta: transfer.savedMeta,
  });
  scrollTops.set(doc.id, transfer.scrollTop);
  if (doc.path) api.watchDocument(doc.path, doc.stamp).catch(notifyError);
}

/**
 * The tab left for another window. Its file stays watched and its recovery copy
 * and waiting images stay too: they belong to the window that has it now.
 */
async function detach(id: string) {
  handOverRecovery(id);
  removeDoc(id);
  // A window whose last tab moved away closes.
  if (useDocs.getState().docs.length === 0) {
    await flushSession();
    await getCurrentWebviewWindow().destroy();
  }
}

export async function moveToNewWindow(id: string) {
  if (useDocs.getState().docs.length < 2) return;
  const tab = pack(id);
  if (!tab) return;
  try {
    await invoke("move_tab_to_new_window", { tab });
    await detach(id);
  } catch (error) {
    notifyError(error);
  }
}

/** The tab was dragged out of the tab bar: Rust takes over until the mouse button is released. */
export async function startTabDrag(id: string, bar: DOMRect) {
  const tab = pack(id);
  const doc = getDoc(id);
  if (!tab || !doc) return;
  useTabDrag.setState({ docId: id });
  try {
    await invoke("start_tab_drag", {
      drag: {
        tab,
        docId: id,
        title: displayName(doc),
        tabCount: useDocs.getState().docs.length,
        barTop: bar.top,
        barBottom: bar.bottom,
      },
    });
  } catch (error) {
    useTabDrag.setState({ docId: null });
    notifyError(error);
  }
}

/** Tabs moved here when this window opened, and the events of tab drags. */
export async function startTabWindows(transfers: TabTransfer[]) {
  const win = getCurrentWebviewWindow();
  transfers.forEach((transfer) => attach(transfer));
  await win.listen<{ tab: TabTransfer; clientX: number }>("tab-attach", ({ payload }) => {
    attach(payload.tab, indexAt(payload.clientX)); // Rust brings this window forward
  });
  await win.listen<{ docId: string }>("tab-detached", ({ payload }) => {
    void detach(payload.docId);
  });
  await win.listen<{ docId: string; clientX: number }>("tab-reorder", ({ payload }) => {
    const from = useDocs.getState().docs.findIndex((d) => d.id === payload.docId);
    const to = indexAt(payload.clientX);
    moveDoc(payload.docId, to > from ? to - 1 : to);
  });
  await win.listen<boolean>("tab-drag-end", () => {
    useTabDrag.setState({ docId: null });
  });
}
