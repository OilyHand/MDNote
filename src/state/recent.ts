// The recent files list, kept by Rust and shared by every window.

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api } from "../ipc";

export const useRecent = create<{ files: string[] }>(() => ({ files: [] }));

export async function initRecent(): Promise<void> {
  useRecent.setState({ files: await api.getRecentFiles() });
  await listen<string[]>("recent-files-changed", ({ payload }) =>
    useRecent.setState({ files: payload }),
  );
}
