// Which section type (O4) a place in the document belongs to: the cursor's in
// the source editor (for Ctrl+] / Ctrl+[ and Modify Style), or an element of
// the rendered view (for its right-click menu).

import type { EditorState } from "@codemirror/state";
import { treeUpTo } from "../editor/edits";
import type { StyleKey } from "../mdmeta/schema";

const HEADING = /^(?:ATXHeading|SetextHeading)(\d)$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/;

/** The section type at `pos` in the Markdown source. */
export function styleKeyAt(state: EditorState, pos: number): StyleKey {
  const tree = treeUpTo(state, pos);
  for (
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    const heading = HEADING.exec(node.name);
    if (heading) return `heading${heading[1]}` as StyleKey;
    switch (node.name) {
      case "InlineCode":
        return "inlineCode";
      case "InlineMath":
      case "MathBlock":
        return "equation";
      case "FencedCode":
      case "CodeBlock":
        return "codeBlock";
      case "TableHeader":
        return "tableHeader";
      case "Table":
        return "tableCell";
      case "ListItem":
        return "list";
      case "Blockquote":
        return "blockquote";
    }
  }
  return FOOTNOTE_DEFINITION.test(state.doc.lineAt(pos).text) ? "footnote" : "body";
}

/** The section type of an element in the rendered view (innermost first). */
export function styleKeyOfElement(element: Element): StyleKey {
  for (
    let el: Element | null = element;
    el && !el.classList.contains("page");
    el = el.parentElement
  ) {
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains("katex") || el.classList.contains("math-display")) return "equation";
    if (el.classList.contains("footnotes")) return "footnote";
    if (/^h[1-6]$/.test(tag)) return `heading${tag[1]}` as StyleKey;
    switch (tag) {
      case "code":
        return el.parentElement?.tagName === "PRE" ? "codeBlock" : "inlineCode";
      case "pre":
        return "codeBlock";
      case "a":
        return "link";
      case "th":
        return "tableHeader";
      case "td":
        return "tableCell";
      case "li":
        return "list";
      case "blockquote":
        return "blockquote";
    }
  }
  return "body";
}
