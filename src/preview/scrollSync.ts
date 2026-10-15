// Keeps the source editor and the preview at the same place in the document
// (O2, Phase 2.5). Rendered blocks carry their source line (`data-line`, and
// `data-rl` inside a block); positions between those anchors are interpolated,
// so tall images and equations don't make either side jump.

import type { EditorView } from "@codemirror/view";

export interface Anchor {
  line: number;
  top: number;
}

/**
 * Source line ↔ vertical position of every marked element in the preview.
 * `lineCount` is the document's number of lines; it anchors the end.
 */
export function buildAnchors(
  scroller: HTMLElement,
  page: HTMLElement,
  lineCount: number,
): Anchor[] {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const anchors: Anchor[] = [{ line: 1, top: 0 }];
  for (const block of page.querySelectorAll<HTMLElement>(".md-block")) {
    const line = Number(block.dataset.line);
    // Blocks use `display: contents`, so their first child carries the position.
    const first = block.firstElementChild;
    if (first) anchors.push({ line, top: first.getBoundingClientRect().top - origin });
    for (const inner of block.querySelectorAll<HTMLElement>("[data-rl]")) {
      anchors.push({
        line: line + Number(inner.dataset.rl),
        top: inner.getBoundingClientRect().top - origin,
      });
    }
  }
  anchors.push({ line: lineCount + 1, top: scroller.scrollHeight });
  anchors.sort((a, b) => a.line - b.line || a.top - b.top);
  // Keep positions increasing, so both directions of the mapping are well defined.
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].top < anchors[i - 1].top) anchors[i].top = anchors[i - 1].top;
  }
  return anchors;
}

function interpolate(
  anchors: Anchor[],
  value: number,
  from: keyof Anchor,
  to: keyof Anchor,
): number {
  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (anchors[mid][from] <= value) low = mid;
    else high = mid;
  }
  const a = anchors[low];
  const b = anchors[high];
  const span = b[from] - a[from];
  if (span <= 0 || !Number.isFinite(span)) return a[to];
  return a[to] + ((value - a[from]) / span) * (b[to] - a[to]);
}

export const lineToTop = (anchors: Anchor[], line: number) =>
  interpolate(anchors, line, "line", "top");
export const topToLine = (anchors: Anchor[], top: number) =>
  interpolate(anchors, top, "top", "line");

/** The (fractional) source line at the top of the editor. */
export function editorTopLine(view: EditorView): number {
  const height = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
  const block = view.lineBlockAtHeight(height);
  const line = view.state.doc.lineAt(block.from).number;
  const fraction = block.height > 0 ? (height - block.top) / block.height : 0;
  return line + Math.min(Math.max(fraction, 0), 0.999);
}

export function scrollEditorToLine(view: EditorView, line: number) {
  const doc = view.state.doc;
  const number = Math.min(Math.max(Math.floor(line), 1), doc.lines);
  const block = view.lineBlockAt(doc.line(number).from);
  view.scrollDOM.scrollTop = block.top + (line - number) * block.height + view.documentPadding.top;
}
