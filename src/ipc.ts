// Typed wrappers around the Rust commands in src-tauri/src.

import { invoke } from "@tauri-apps/api/core";
import type { Language, LanguagePref } from "./i18n";

export type TextEncoding =
  | { kind: "utf8" }
  | { kind: "utf8Bom" }
  | { kind: "utf16Le" }
  | { kind: "utf16Be" }
  | { kind: "ansi"; codepage: number };

export type LineEnding = "lf" | "crlf";

export interface FileStamp {
  modifiedMs: number;
  size: number;
}

export interface LoadedFile {
  path: string;
  /** Text with "\n" line breaks only. */
  text: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  stamp: FileStamp;
  ansiFallback: boolean;
  mixedLineEndings: boolean;
}

export type ThemePref = "system" | "light" | "dark";

export interface Preferences {
  language: LanguagePref;
  restoreSession: boolean;
  recentFilesLimit: number;
  theme: ThemePref;
  /** Source editor font family; empty means the built-in default. */
  editorFontFamily: string;
  /** Source editor font size in CSS pixels (8–40). */
  editorFontSize: number;
  editorWordWrap: boolean;
  editorLineNumbers: boolean;
  /** Fields from newer MDNote versions; passed back unchanged. */
  [unknown: string]: unknown;
}

export interface PreferencesView {
  preferences: Preferences;
  systemLanguage: Language;
}

export interface TabSession {
  path: string;
  scrollTop: number;
  cursor: number;
}

export interface Startup {
  tabs: TabSession[];
  active: number;
  paths: string[];
}

export type ErrorCode = "notFound" | "accessDenied" | "readOnly" | "unmappable" | "io" | "internal";

/** The error shape every Rust command rejects with. */
export interface AppError {
  code: ErrorCode;
  detail: string;
}

/** Turns anything a command rejects with into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error && typeof error === "object" && "code" in error && "detail" in error) {
    return error as AppError;
  }
  return { code: "internal", detail: String(error) };
}

export const api = {
  /** `remember: false` reads without adding the file to Recent Files. */
  readDocument: (path: string, remember = true) =>
    invoke<LoadedFile>("read_document", { path, remember }),
  writeDocument: (path: string, text: string, encoding: TextEncoding, lineEnding: LineEnding) =>
    invoke<FileStamp>("write_document", { path, text, encoding, lineEnding }),
  defaultLineEnding: () => invoke<LineEnding>("default_line_ending"),

  getPreferences: () => invoke<PreferencesView>("get_preferences"),
  setPreferences: (preferences: Preferences) => invoke<void>("set_preferences", { preferences }),

  getRecentFiles: () => invoke<string[]>("get_recent_files"),
  removeRecentFile: (path: string) => invoke<void>("remove_recent_file", { path }),
  clearRecentFiles: () => invoke<void>("clear_recent_files"),

  watchDocument: (path: string, stamp: FileStamp | null) =>
    invoke<void>("watch_document", { path, stamp }),
  unwatchDocument: (path: string) => invoke<void>("unwatch_document", { path }),

  takeStartup: () => invoke<Startup>("take_startup"),
  reportTabs: (tabs: TabSession[], active: number) => invoke<void>("report_tabs", { tabs, active }),
  openPaths: (paths: string[]) => invoke<void>("open_paths", { paths }),

  openPreferences: () => invoke<void>("open_preferences"),
  openDefaultAppsSettings: () => invoke<void>("open_default_apps_settings"),

  /** For each source: the image file's path (allowed for the page), or null. */
  resolveImages: (document: string | null, sources: string[]) =>
    invoke<(string | null)[]>("resolve_images", { document, sources }),
  resolveLink: (document: string | null, target: string) =>
    invoke<string | null>("resolve_link", { document, target }),
  listFonts: (refresh = false) => invoke<FontFamily[]>("list_fonts", { refresh }),
};

export interface FontFamily {
  /** en-us name, as stored in settings. */
  name: string;
  nameKo: string | null;
  monospaced: boolean;
  hasHangul: boolean;
}
