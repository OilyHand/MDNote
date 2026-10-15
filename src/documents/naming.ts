// Names and labels for documents.

import type { TextEncoding } from "../ipc";

/** The file name part of a Windows or Unix path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Windows paths are case-insensitive and accept both slash directions. */
export function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

/** The lowest "Untitled-N" number not in use, as Notepad++ and VS Code do. */
export function nextUntitledNumber(used: Iterable<number>): number {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

/** A short, human-readable encoding name, e.g. for dialogs and the status bar. */
export function encodingLabel(encoding: TextEncoding): string {
  switch (encoding.kind) {
    case "utf8":
      return "UTF-8";
    case "utf8Bom":
      return "UTF-8 BOM";
    case "utf16Le":
      return "UTF-16 LE";
    case "utf16Be":
      return "UTF-16 BE";
    case "ansi":
      return `Windows-${encoding.codepage}`;
  }
}
