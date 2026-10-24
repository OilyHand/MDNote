// Links that a rename or move would break (O14). When a note moves to another
// folder, or is renamed together with its `<name>.assets` folder, its relative
// links to images and files are rewritten so they reach the same files again.
// Pure path arithmetic on Windows paths, testable without the app.

import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { encodeLinkTarget } from "../editor/edits";
import { markdownMath } from "../editor/math";
import { isWithin, pathKey } from "../state/folder";

const language = markdown({ base: markdownLanguage, extensions: [markdownMath] });

/** Path segments with "." and ".." resolved. */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out;
}

export const dirName = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

/** `path` without its extension: "C:\notes\a.md" → "C:\notes\a". */
export const withoutExtension = (path: string) => path.replace(/\.[^.\\/]*$/, "");

export function joinPath(dir: string, relative: string): string {
  const unc = dir.startsWith("\\\\") ? "\\\\" : "";
  return unc + segments(`${dir}\\${relative}`).join("\\");
}

/** The path of `to` relative to the folder `from` with forward slashes; null on another drive. */
export function relativePath(from: string, to: string): string | null {
  const a = segments(from);
  const b = segments(to);
  if (!a.length || !b.length || a[0].toLowerCase() !== b[0].toLowerCase()) return null;
  let common = 0;
  while (
    common < a.length &&
    common < b.length &&
    a[common].toLowerCase() === b[common].toLowerCase()
  ) {
    common++;
  }
  return [...Array<string>(a.length - common).fill(".."), ...b.slice(common)].join("/");
}

/** Web addresses, anchors, and absolute paths are left alone. */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]+:|#|[\\/]|[a-z]:)/i;

interface RelativeLink {
  /** Where the address is in the text. */
  from: number;
  to: number;
  /** The decoded relative path, and any "#…" or "?…" after it. */
  path: string;
  suffix: string;
}

/** The relative link and image addresses in a note (not those in code). */
export function relativeLinks(text: string): RelativeLink[] {
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, text.length, 5000) ?? syntaxTree(state);
  const links: RelativeLink[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Link" && node.name !== "Image") return;
      const url = node.node.getChild("URL");
      if (!url) return;
      let { from, to } = url;
      let raw = text.slice(from, to);
      if (raw.startsWith("<") && raw.endsWith(">")) {
        from++;
        to--;
        raw = raw.slice(1, -1);
      }
      if (!raw || NOT_RELATIVE.test(raw)) return;
      const cut = raw.search(/[#?]/);
      const target = cut < 0 ? raw : raw.slice(0, cut);
      if (!target) return;
      let path = target;
      try {
        path = decodeURIComponent(target);
      } catch {
        // a lone "%" stays as written
      }
      links.push({ from, to, path, suffix: cut < 0 ? "" : raw.slice(cut) });
    },
  });
  return links;
}

/** Where a file is after `moves` (folders that moved, with everything inside). */
export function movedPath(path: string, moves: [string, string][]): string {
  for (const [from, to] of moves) {
    if (isWithin(path, from)) return to + path.slice(from.replace(/[\\/]+$/, "").length);
  }
  return path;
}

export interface Relink {
  from: number;
  to: number;
  insert: string;
  /** The linked file, at its old place (to check that it exists). */
  target: string;
}

/**
 * The links of a note at `oldNote` that need new addresses once it is at
 * `newNote`. `moves` lists folders that move along (its `<name>.assets`).
 * Links that still reach their file are left as they are.
 */
export function relinks(
  text: string,
  oldNote: string,
  newNote: string,
  moves: [string, string][],
): Relink[] {
  const oldDir = dirName(oldNote);
  const newDir = dirName(newNote);
  const changes: Relink[] = [];
  for (const link of relativeLinks(text)) {
    const target = joinPath(oldDir, link.path);
    const now = movedPath(target, moves);
    if (pathKey(joinPath(newDir, link.path)) === pathKey(now)) continue;
    const relative = relativePath(newDir, now);
    if (relative === null) continue;
    changes.push({
      from: link.from,
      to: link.to,
      insert: encodeLinkTarget(relative, true) + link.suffix,
      target,
    });
  }
  return changes;
}

/** The note's image folder moves with it: `<old name>.assets` → `<new name>.assets`. */
export function companionMoves(oldNote: string, newNote: string): [string, string][] {
  return [[`${withoutExtension(oldNote)}.assets`, `${withoutExtension(newNote)}.assets`]];
}
