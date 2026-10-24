// What the status bar shows about the editor and the preview (O18). Updated as
// the cursor moves, outside React's render path.

import { create } from "zustand";
import type { EditorState } from "@codemirror/state";

export interface CursorInfo {
  docId: string | null;
  line: number;
  /** 1-based, counting characters as the reader sees them (a Korean syllable is one). */
  column: number;
  /** Text is selected; the counts then cover the selection too. */
  selected: boolean;
}

export const useCursor = create<CursorInfo>(() => ({
  docId: null,
  line: 1,
  column: 1,
  selected: false,
}));

/**
 * The source line being read or edited, for the Outline's highlight (O13): the
 * cursor's line after the cursor moves, the top visible line after scrolling.
 */
export const useReadingLine = create<{ docId: string | null; line: number }>(() => ({
  docId: null,
  line: 1,
}));

export function setReadingLine(docId: string, line: number) {
  const current = useReadingLine.getState();
  if (current.docId !== docId || current.line !== line) useReadingLine.setState({ docId, line });
}

export function updateCursor(docId: string, state: EditorState) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const column = [...line.text.slice(0, head - line.from)].length + 1;
  const selected = state.selection.ranges.some((r) => !r.empty);
  const current = useCursor.getState();
  if (
    current.docId === docId &&
    current.line === line.number &&
    current.column === column &&
    current.selected === selected
  ) {
    return;
  }
  useCursor.setState({ docId, line: line.number, column, selected });
  setReadingLine(docId, line.number);
}

/** The zoom the preview shows right now (Fit Page Width included); null while it is hidden. */
export const useShownZoom = create<{ zoom: number | null }>(() => ({ zoom: null }));
