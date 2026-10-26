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

export interface StatusBarItems {
  words: boolean;
  characters: boolean;
  charactersNoSpaces: boolean;
  cursor: boolean;
  encoding: boolean;
  lineEnding: boolean;
  zoom: boolean;
}

export type UnitsPref = "system" | "cm" | "in";

/** Where pasted and dropped images are saved (O15). */
export type ImageFolder = "assets" | "noteName" | "noteFolder";

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
  /** Editor conveniences (O17). */
  editorListContinuation: boolean;
  editorCloseBrackets: boolean;
  editorWrapSelection: boolean;
  editorRenumberLists: boolean;
  /** Line source tables up when the cursor leaves them (O16). */
  editorFormatTables: boolean;
  imageFolder: ImageFolder;
  /** Show non-Markdown files in the folder sidebar (O14). */
  sidebarShowAllFiles: boolean;
  /** View > Status Bar, and the items it shows (O18). */
  statusBar: boolean;
  statusBarItems: StatusBarItems;
  /** Styles documents start with (O4): differences from the built-in styles, unchecked. */
  defaultStyles: Record<string, unknown>;
  /** The style set the default styles came from, for display (O19). */
  defaultStyleSet: string;
  /** Page setup for documents without their own (O9), unchecked; null: by Windows region. */
  defaultPage: unknown;
  units: UnitsPref;
  /** The font picker's recently used fonts, newest first (O3). */
  recentFonts: string[];
  /** Fields from newer MDNote versions; passed back unchanged. */
  [unknown: string]: unknown;
}

export interface PreferencesView {
  preferences: Preferences;
  systemLanguage: Language;
  /** What Windows' region settings stand for (O9). */
  systemUnits: "cm" | "in";
  systemPaper: "A4" | "Letter";
}

/** A copy of a document with unsaved changes, kept for crash recovery (O1). */
export interface RecoveryCopy {
  docId: string;
  path: string | null;
  untitled: number | null;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  text: string;
  /** The `.mdmeta` text (O7), when the formatting has changes too. */
  meta?: string | null;
  savedMs: number;
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
  /** The folder the sidebar showed last time (O14). */
  folder: string | null;
  /** Tabs moved to this window from another one (see app/tabWindows.ts). */
  transfers: unknown[];
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
  writeDocument: (
    path: string,
    text: string,
    encoding: TextEncoding,
    lineEnding: LineEnding,
    remember = true,
  ) => invoke<FileStamp>("write_document", { path, text, encoding, lineEnding, remember }),
  defaultLineEnding: () => invoke<LineEnding>("default_line_ending"),
  /** The text of the note's `.mdmeta` (O7), or null if it has none. */
  readMeta: (note: string) => invoke<string | null>("read_meta", { note }),
  /** Saves the note's `.mdmeta`; null removes it. `backup` keeps a broken one as .bak first. */
  writeMeta: (note: string, text: string | null, backup: boolean) =>
    invoke<void>("write_meta", { note, text, backup }),
  systemCodePage: () => invoke<number>("system_code_page"),

  getPreferences: () => invoke<PreferencesView>("get_preferences"),
  setPreferences: (preferences: Preferences) => invoke<void>("set_preferences", { preferences }),

  getRecentFiles: () => invoke<string[]>("get_recent_files"),
  removeRecentFile: (path: string) => invoke<void>("remove_recent_file", { path }),
  clearRecentFiles: () => invoke<void>("clear_recent_files"),

  watchDocument: (path: string, stamp: FileStamp | null) =>
    invoke<void>("watch_document", { path, stamp }),
  unwatchDocument: (path: string) => invoke<void>("unwatch_document", { path }),

  takeStartup: () => invoke<Startup>("take_startup"),
  reportTabs: (tabs: TabSession[], active: number, folder: string | null) =>
    invoke<void>("report_tabs", { tabs, active, folder }),
  openPaths: (paths: string[]) => invoke<void>("open_paths", { paths }),
  /** File > Exit: closes every window; the next start restores them all. */
  quitApp: () => invoke<void>("quit_app"),
  cancelQuit: () => invoke<void>("cancel_quit"),

  openPreferences: () => invoke<void>("open_preferences"),
  openDefaultAppsSettings: () => invoke<void>("open_default_apps_settings"),

  /** For each source: the image file's path (allowed for the page), or null. */
  resolveImages: (document: string | null, sources: string[]) =>
    invoke<(string | null)[]>("resolve_images", { document, sources }),
  resolveLink: (document: string | null, target: string) =>
    invoke<string | null>("resolve_link", { document, target }),
  listFonts: (refresh = false) => invoke<FontFamily[]>("list_fonts", { refresh }),

  // User style sets (O19): JSON text, checked by the window.
  listStyleSets: () => invoke<{ id: string; text: string }[]>("list_style_sets"),
  saveStyleSet: (id: string, text: string) => invoke<void>("save_style_set", { id, text }),
  deleteStyleSet: (id: string) => invoke<void>("delete_style_set", { id }),
  importStyleSet: (path: string) => invoke<string>("import_style_set", { path }),
  exportStyleSet: (path: string, text: string) => invoke<void>("export_style_set", { path, text }),

  // The folder sidebar (O14)
  listFolder: (path: string, showAll: boolean) =>
    invoke<FolderEntry[]>("list_folder", { path, showAll }),
  watchFolder: (path: string) => invoke<void>("watch_folder", { path }),
  unwatchFolder: () => invoke<void>("unwatch_folder"),
  /** Returns the new path; a note's .mdmeta and .assets go with it. */
  renameEntry: (path: string, name: string) => invoke<string>("rename_entry", { path, name }),
  moveEntry: (path: string, folder: string) => invoke<string>("move_entry", { path, folder }),
  createNote: (folder: string, name: string) => invoke<string>("create_note", { folder, name }),
  createFolder: (folder: string, name: string) => invoke<string>("create_folder", { folder, name }),
  /** To the Recycle Bin, a note with its .mdmeta and .assets. */
  deleteEntry: (path: string) => invoke<void>("delete_entry", { path }),
  existingFiles: (paths: string[]) => invoke<boolean[]>("existing_files", { paths }),

  /** Saves a pasted image for the note; returns its path relative to the note. */
  saveImage: (document: string | null, docId: string, name: string, bytes: Uint8Array) =>
    invoke<string>("save_image", bytes, {
      headers: {
        "x-document": encodeURIComponent(document ?? ""),
        "x-doc-id": encodeURIComponent(docId),
        "x-name": encodeURIComponent(name),
      },
    }),
  importImages: (document: string | null, docId: string, paths: string[]) =>
    invoke<string[]>("import_images", { document, docId, paths }),
  adoptUnsavedImages: (docId: string, document: string) =>
    invoke<[string, string][]>("adopt_unsaved_images", { docId, document }),
  discardUnsavedImages: (docId: string) => invoke<void>("discard_unsaved_images", { docId }),
  unsavedDocumentPath: (docId: string) => invoke<string>("unsaved_document_path", { docId }),

  writeRecovery: (copy: RecoveryCopy) => invoke<void>("write_recovery", { copy }),
  removeRecovery: (docId: string) => invoke<void>("remove_recovery", { docId }),
  takeRecovery: () => invoke<RecoveryCopy[]>("take_recovery"),
};

export interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
  isNote: boolean;
  modifiedMs: number;
}

export interface FontFamily {
  /** en-us name, as stored in settings. */
  name: string;
  nameKo: string | null;
  monospaced: boolean;
  hasHangul: boolean;
  /** Single line height as a multiple of the font size (Word's "Single"). */
  lineHeight: number;
}
