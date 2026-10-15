// Images pasted, dropped, or chosen with Insert > Image (O15). Rust saves the
// files in the note's image folder; the editor gets `![](relative/path)` links,
// written so that other Markdown apps can read them too. Undo removes the link;
// the image file stays.

import type { ChangeSpec, EditorState } from "@codemirror/state";
import { open } from "@tauri-apps/plugin-dialog";
import i18n from "../i18n";
import { api } from "../ipc";
import { encodeLinkTarget } from "../editor/edits";
import { IMAGE_EXTENSIONS, insertImageLinks, pastedImageName } from "../editor/images";
import { getActiveView } from "../editor/view";
import {
  activeDoc,
  editorStates,
  notifyDocEdited,
  refreshDirty,
  useDocs,
} from "../state/documents";
import { notifyError } from "../state/notices";

/** Inserts the links into the document (at `at`, or in place of the selection). */
function insertLinks(docId: string, links: string[], at?: number) {
  if (links.length === 0) return;
  const spec = (state: EditorState) => ({
    ...insertImageLinks(state, links, at),
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  const view = getActiveView();
  if (view && useDocs.getState().activeId === docId) {
    view.dispatch(spec(view.state));
    view.focus();
    return;
  }
  // The user switched tabs while the image was being saved.
  const state = editorStates.get(docId);
  if (!state) return;
  const next = state.update(spec(state)).state;
  editorStates.set(docId, next);
  refreshDirty(docId, next.doc);
  notifyDocEdited(docId);
}

/** Ctrl+V with an image on the clipboard (e.g. a Win+Shift+S screenshot). */
export async function pasteImages(files: File[]) {
  const doc = activeDoc();
  if (!doc) return;
  try {
    const links: string[] = [];
    for (const file of files) {
      // Screenshots arrive as a generic "image.png"; copied files keep their name.
      const name = file.name && file.name !== "image.png" ? file.name : pastedImageName(file.type);
      const bytes = new Uint8Array(await file.arrayBuffer());
      links.push(await api.saveImage(doc.path, doc.id, name, bytes));
    }
    insertLinks(doc.id, links);
  } catch (error) {
    notifyError(error);
  }
}

/**
 * Image files dropped on the window or chosen in a dialog: copied into the
 * image folder and linked where they were dropped in the editor, otherwise at
 * the cursor. `point` is in CSS pixels.
 */
export async function importImageFiles(paths: string[], point?: { x: number; y: number }) {
  const doc = activeDoc();
  if (!doc) return;
  const view = getActiveView();
  let at: number | undefined;
  if (view && point) {
    const target = document.elementFromPoint(point.x, point.y);
    if (target && view.dom.contains(target)) at = view.posAtCoords(point) ?? undefined;
  }
  try {
    insertLinks(doc.id, await api.importImages(doc.path, doc.id, paths), at);
  } catch (error) {
    notifyError(error);
  }
}

/** Insert > Image…. */
export async function chooseImages() {
  const picked = await open({
    multiple: true,
    filters: [{ name: i18n.t("fileTypes.images"), extensions: IMAGE_EXTENSIONS }],
  });
  if (picked) await importImageFiles(Array.isArray(picked) ? picked : [picked]);
}

/**
 * A never-saved note is about to be saved as `path`: its waiting images move
 * into the image folder, and links whose path changed are updated first.
 */
export async function adoptUnsavedImages(docId: string, path: string) {
  const renamed = await api.adoptUnsavedImages(docId, path);
  if (renamed.length === 0) return;
  const view = getActiveView();
  const shown = view && useDocs.getState().activeId === docId;
  const state = shown ? view.state : editorStates.get(docId);
  if (!state) return;
  const text = state.doc.toString();
  const changes: ChangeSpec[] = [];
  for (const [before, after] of renamed) {
    const old = `(${encodeLinkTarget(before, true)})`;
    for (let i = text.indexOf(old); i >= 0; i = text.indexOf(old, i + old.length)) {
      changes.push({ from: i, to: i + old.length, insert: `(${encodeLinkTarget(after, true)})` });
    }
  }
  if (changes.length === 0) return;
  if (shown) view.dispatch({ changes, userEvent: "input.paste" });
  else {
    const next = state.update({ changes }).state;
    editorStates.set(docId, next);
    notifyDocEdited(docId);
  }
}

/** A never-saved note was closed without saving: its waiting images are removed. */
export function discardUnsavedImages(docId: string) {
  api.discardUnsavedImages(docId).catch(() => {});
}
