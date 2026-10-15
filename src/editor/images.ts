// Image links for pasted and dropped images (O15). Pure helpers; saving the
// files happens in app/images.ts.

import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { encodeLinkTarget } from "./edits";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const IMAGE_FILE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join("|")})$`, "i");
export const isImagePath = (path: string) => IMAGE_FILE.test(path);

const EXTENSION_OF_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** `image-20261015-143012.png`, in local time. */
export function pastedImageName(type: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${date}-${time}.${EXTENSION_OF_TYPE[type] ?? "png"}`;
}

/** `![](assets/a%20b.png)` for each image path relative to the note. */
export function imageMarkdown(links: string[]): string {
  return links.map((link) => `![](${encodeLinkTarget(link, true)})`).join("\n");
}

/**
 * Inserts image links at `at`, or in place of the selection. On an empty line
 * they become a paragraph of their own, with blank lines around them.
 */
export function insertImageLinks(
  state: EditorState,
  links: string[],
  at?: number,
): TransactionSpec {
  const range = state.selection.main;
  const from = at ?? range.from;
  const to = at ?? range.to;
  let text = imageMarkdown(links);
  const line = state.doc.lineAt(from);
  if (from === to && !line.text.trim()) {
    const before = line.number > 1 && state.doc.line(line.number - 1).text.trim();
    const after = line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim();
    text = `${before ? "\n" : ""}${text}${after ? "\n" : ""}`;
    return {
      changes: { from: line.from, to: line.to, insert: text },
      selection: EditorSelection.cursor(line.from + text.length - (after ? 1 : 0)),
    };
  }
  return {
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
  };
}
