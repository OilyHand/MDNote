// Modal questions such as "Save changes?". `ask()` returns the chosen button's id.

import { create } from "zustand";

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
}

export interface DialogRequest {
  title: string;
  message: string;
  buttons: DialogButton[];
  /** Chosen when the user presses Esc. */
  cancelId: string;
  resolve(id: string): void;
}

export const useDialog = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }));

export function ask(request: Omit<DialogRequest, "resolve">): Promise<string> {
  return new Promise((resolve) => {
    const entry: DialogRequest = {
      ...request,
      resolve: (id) => {
        useDialog.setState(({ queue }) => ({ queue: queue.filter((d) => d !== entry) }));
        resolve(id);
      },
    };
    useDialog.setState(({ queue }) => ({ queue: [...queue, entry] }));
  });
}
