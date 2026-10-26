// Dialogs with their own content (the shortcut list, Insert Link, the table
// picker, Modify Style, Page Setup, style sets). Questions with buttons only
// use `ask()` in dialog.ts instead.

import { create } from "zustand";
import type { StyleKey } from "../mdmeta/schema";

export interface LinkFields {
  text: string;
  url: string;
}

/** The link dialog's answer: the new link, "remove" (an existing link), or null (cancelled). */
export type LinkResult = LinkFields | "remove" | null;

export type Modal =
  | { kind: "shortcuts" }
  | {
      kind: "link";
      initial: LinkFields;
      /** Editing an existing link: the dialog offers to remove it. */
      existing: boolean;
      resolve(result: LinkResult): void;
    }
  | { kind: "table"; resolve(size: { rows: number; columns: number } | null): void }
  /** Modify Style (O4); the page shows the changes while it is open. */
  | { kind: "style"; docId: string; key: StyleKey; resolve(): void };

export const useModal = create<{ modal: Modal | null }>(() => ({ modal: null }));

export const isModalOpen = () => useModal.getState().modal !== null;

export function closeModal() {
  useModal.setState({ modal: null });
}

export function showShortcuts() {
  useModal.setState({ modal: { kind: "shortcuts" } });
}

export function askLink(initial: LinkFields, existing: boolean): Promise<LinkResult> {
  return new Promise((resolve) => {
    useModal.setState({
      modal: {
        kind: "link",
        initial,
        existing,
        resolve: (result) => {
          closeModal();
          resolve(result);
        },
      },
    });
  });
}

/** Opens Modify Style for one section type of a document. */
export function modifyStyleDialog(docId: string, key: StyleKey): Promise<void> {
  return new Promise((resolve) => {
    useModal.setState({
      modal: {
        kind: "style",
        docId,
        key,
        resolve: () => {
          closeModal();
          resolve();
        },
      },
    });
  });
}

export function askTableSize(): Promise<{ rows: number; columns: number } | null> {
  return new Promise((resolve) => {
    useModal.setState({
      modal: {
        kind: "table",
        resolve: (size) => {
          closeModal();
          resolve(size);
        },
      },
    });
  });
}
