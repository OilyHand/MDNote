// Dialogs with their own content (the shortcut list, Insert Link, the table
// picker). Questions with buttons only use `ask()` in dialog.ts instead.

import { create } from "zustand";

export interface LinkFields {
  text: string;
  url: string;
}

export type Modal =
  | { kind: "shortcuts" }
  | { kind: "link"; initial: LinkFields; resolve(result: LinkFields | null): void }
  | { kind: "table"; resolve(size: { rows: number; columns: number } | null): void };

export const useModal = create<{ modal: Modal | null }>(() => ({ modal: null }));

export const isModalOpen = () => useModal.getState().modal !== null;

export function closeModal() {
  useModal.setState({ modal: null });
}

export function showShortcuts() {
  useModal.setState({ modal: { kind: "shortcuts" } });
}

export function askLink(initial: LinkFields): Promise<LinkFields | null> {
  return new Promise((resolve) => {
    useModal.setState({
      modal: {
        kind: "link",
        initial,
        resolve: (result) => {
          closeModal();
          resolve(result);
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
