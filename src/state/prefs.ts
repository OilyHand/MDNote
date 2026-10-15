// App-wide preferences (O12). Rust owns the file; every window keeps a copy and
// is told about changes through the "preferences-changed" event.

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, type Preferences, type PreferencesView } from "../ipc";
import { resolveLanguage, setLanguage, type Language } from "../i18n";
import { notifyError } from "./notices";

interface PrefsStore {
  preferences: Preferences;
  systemLanguage: Language;
  update(changes: Partial<Preferences>): Promise<void>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "system",
  restoreSession: true,
  recentFilesLimit: 10,
  theme: "system",
  editorFontFamily: "",
  editorFontSize: 14,
  editorWordWrap: true,
  editorLineNumbers: false,
  editorListContinuation: true,
  editorCloseBrackets: true,
  editorWrapSelection: true,
  editorRenumberLists: true,
  editorFormatTables: true,
  imageFolder: "assets",
};

export const usePrefs = create<PrefsStore>((_set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  systemLanguage: "en",
  async update(changes) {
    try {
      await api.setPreferences({ ...get().preferences, ...changes });
    } catch (error) {
      notifyError(error);
    }
  },
}));

export function currentLanguage(): Language {
  const { preferences, systemLanguage } = usePrefs.getState();
  return resolveLanguage(preferences.language, systemLanguage);
}

function applyTheme(theme: Preferences["theme"]) {
  // "system" leaves the attribute off, so the CSS follows prefers-color-scheme.
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function apply(view: PreferencesView) {
  usePrefs.setState({ preferences: view.preferences, systemLanguage: view.systemLanguage });
  applyTheme(view.preferences.theme);
  void setLanguage(resolveLanguage(view.preferences.language, view.systemLanguage));
}

/** Loads preferences and follows changes made in any window. */
export async function initPrefs(): Promise<void> {
  const view = await api.getPreferences();
  usePrefs.setState({ preferences: view.preferences, systemLanguage: view.systemLanguage });
  applyTheme(view.preferences.theme);
  await listen<PreferencesView>("preferences-changed", ({ payload }) => apply(payload));
}
