// Open documents (tabs) in this window.
//
// The reactive store holds what the UI shows. Each document's CodeMirror state
// (text, formatting, selection and Undo history) lives in `editorStates`,
// outside React, because it changes on every keystroke. The formatting is also
// published in `useDocMetas`, for the views that show it.

import { create } from "zustand";
import { Text, type EditorState, type TransactionSpec } from "@codemirror/state";
import i18n from "../i18n";
import type { FileStamp, LineEnding, TextEncoding } from "../ipc";
import { baseName, samePath } from "../documents/naming";
import { forgetPreview } from "../render/client";
import { viewShowing } from "../editor/view";
import { metaOf } from "../mdmeta/field";
import { metaKey, type DocMeta } from "../mdmeta/schema";

export type DiskStatus = "ok" | "changed" | "removed";

export interface Doc {
  id: string;
  /** null until the document is saved for the first time. */
  path: string | null;
  /** The N in "Untitled-N" for documents without a path. */
  untitled: number | null;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  /** The version on disk that this document matches, for change detection. */
  stamp: FileStamp | null;
  dirty: boolean;
  disk: DiskStatus;
  /** Its `.mdmeta` could not be read: kept as `.mdmeta.bak` before it is replaced (O7). */
  metaBroken?: boolean;
}

interface DocsStore {
  docs: Doc[];
  activeId: string | null;
}

export const useDocs = create<DocsStore>(() => ({ docs: [], activeId: null }));

export const editorStates = new Map<string, EditorState>();
/** The text as last read or saved; null means "never equal" (forces the dirty marker). */
const savedTexts = new Map<string, Text | null>();
/** The `.mdmeta` text as last read or saved (null: no file). */
const savedMetas = new Map<string, string | null>();
export const scrollTops = new Map<string, number>();

/** Each document's formatting (O7), for the rendered view and the style tools. */
export const useDocMetas = create<Record<string, DocMeta>>(() => ({}));

function publishMeta(id: string, state: EditorState) {
  const meta = metaOf(state);
  if (useDocMetas.getState()[id] !== meta) useDocMetas.setState({ [id]: meta });
}

export function getDoc(id: string): Doc | undefined {
  return useDocs.getState().docs.find((d) => d.id === id);
}

export function activeDoc(): Doc | undefined {
  const { activeId } = useDocs.getState();
  return activeId ? getDoc(activeId) : undefined;
}

export function findByPath(path: string): Doc | undefined {
  return useDocs.getState().docs.find((d) => d.path !== null && samePath(d.path, path));
}

export function updateDoc(id: string, changes: Partial<Doc>) {
  useDocs.setState(({ docs }) => ({
    docs: docs.map((d) => (d.id === id ? { ...d, ...changes } : d)),
  }));
}

/** What is on disk, for a document arriving from another window. */
export interface SavedVersion {
  /** null: unsaved until saved. */
  text: string | null;
  meta: string | null;
}

/**
 * Adds a tab. `saved` is what is on disk, for a document arriving from another
 * window; by default it is the document's own text and formatting, unless it
 * is marked as changed.
 */
export function addDoc(doc: Doc, state: EditorState, index?: number, saved?: SavedVersion) {
  editorStates.set(doc.id, state);
  if (saved) {
    savedTexts.set(doc.id, saved.text === null ? null : Text.of(saved.text.split("\n")));
    savedMetas.set(doc.id, saved.meta);
  } else {
    savedTexts.set(doc.id, doc.dirty ? null : state.doc);
    savedMetas.set(doc.id, metaKey(metaOf(state)));
  }
  publishMeta(doc.id, state);
  useDocs.setState(({ docs }) => {
    const next = [...docs];
    next.splice(index ?? next.length, 0, doc);
    return { docs: next, activeId: doc.id };
  });
}

const editListeners = new Set<(id: string) => void>();

/** Runs `listener` after every edit to a document shown in the editor. */
export function onDocEdited(listener: (id: string) => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

export function notifyDocEdited(id: string) {
  editListeners.forEach((listener) => listener(id));
}

export function removeDoc(id: string) {
  forgetPreview(id);
  editorStates.delete(id);
  savedTexts.delete(id);
  savedMetas.delete(id);
  scrollTops.delete(id);
  useDocMetas.setState((metas) => {
    const rest = { ...metas };
    delete rest[id];
    return rest;
  }, true);
  useDocs.setState(({ docs, activeId }) => {
    const index = docs.findIndex((d) => d.id === id);
    const next = docs.filter((d) => d.id !== id);
    const neighbour = next[Math.min(index, next.length - 1)];
    return { docs: next, activeId: activeId === id ? (neighbour?.id ?? null) : activeId };
  });
}

export function activate(id: string) {
  if (getDoc(id)) useDocs.setState({ activeId: id });
}

export function moveDoc(id: string, toIndex: number) {
  useDocs.setState(({ docs }) => {
    const from = docs.findIndex((d) => d.id === id);
    if (from < 0) return {};
    const next = [...docs];
    const [doc] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, doc);
    return { docs: next };
  });
}

/** Records the text that is now on disk. */
export function markTextSaved(id: string, text: Text) {
  savedTexts.set(id, text);
}

/** Records the `.mdmeta` text that is now on disk (null: none). */
export function markMetaSaved(id: string, meta: string | null) {
  savedMetas.set(id, meta);
}

/** The `.mdmeta` text last read or saved. */
export function savedMetaOf(id: string): string | null {
  return savedMetas.get(id) ?? null;
}

/** Keeps the document marked as changed until it is saved (e.g. after "Keep My Version"). */
export function markUnsaved(id: string) {
  savedTexts.set(id, null);
  updateDoc(id, { dirty: true });
}

/** The text last read or saved, for moving the document to another window. */
export function savedTextOf(id: string): string | null {
  return savedTexts.get(id)?.toString() ?? null;
}

/** Whether `text` is exactly the text last read or saved. */
export function isSavedText(id: string, text: string): boolean {
  const saved = savedTexts.get(id);
  return saved !== undefined && saved !== null && saved.toString() === text;
}

/** Called after every edit to keep the dirty marker, and the published formatting, in sync. */
export function refreshDirty(id: string, state: EditorState) {
  const saved = savedTexts.get(id);
  const dirty = !saved || !saved.eq(state.doc) || savedMetas.get(id) !== metaKey(metaOf(state));
  if (getDoc(id)?.dirty !== dirty) updateDoc(id, { dirty });
  publishMeta(id, state);
}

/**
 * Changes a document's text from outside the editor (reload, images, recovery).
 * If the editor shows it, the change goes through the view like typing would;
 * otherwise it goes to the stored state, which the editor picks up when shown.
 */
export function changeDoc(id: string, change: (state: EditorState) => TransactionSpec) {
  const view = viewShowing(id);
  const state = view?.state ?? editorStates.get(id);
  if (!state) return;
  const spec = change(state);
  if (view) {
    view.dispatch(spec);
    return;
  }
  const next = state.update(spec).state;
  editorStates.set(id, next);
  refreshDirty(id, next);
  notifyDocEdited(id);
}

/** The name shown on the tab and in the title bar. */
export function displayName(doc: Doc): string {
  return doc.path ? baseName(doc.path) : i18n.t("app.untitled", { number: doc.untitled ?? 1 });
}
