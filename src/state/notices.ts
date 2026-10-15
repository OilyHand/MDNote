// Non-blocking messages shown in the corner of the window.
// Errors from Rust always end up here, so no failure is silent.

import { create } from "zustand";
import { error as logError } from "@tauri-apps/plugin-log";
import i18n from "../i18n";
import { toAppError } from "../ipc";

export interface Notice {
  id: number;
  kind: "info" | "error";
  message: string;
}

interface NoticeStore {
  notices: Notice[];
  show(kind: Notice["kind"], message: string): void;
  dismiss(id: number): void;
}

let nextId = 1;
const INFO_TIMEOUT_MS = 8000;

export const useNotices = create<NoticeStore>((set, get) => ({
  notices: [],
  show(kind, message) {
    const id = nextId++;
    set({ notices: [...get().notices, { id, kind, message }] });
    if (kind === "info") setTimeout(() => get().dismiss(id), INFO_TIMEOUT_MS);
  },
  dismiss(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) });
  },
}));

export function notifyInfo(message: string) {
  useNotices.getState().show("info", message);
}

/** Shows a translated error and writes it to the log file. */
export function notifyError(error: unknown) {
  const appError = toAppError(error);
  const message = i18n.t(`errors.${appError.code}`, { detail: appError.detail });
  useNotices.getState().show("error", message);
  void logError(`${appError.code}: ${appError.detail}`).catch(() => {});
}
