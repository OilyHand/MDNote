// Counts (O18) and headings (O13) of the active document, from the render
// worker. Refreshed shortly after edits and selection changes, so typing never
// waits for them. The status bar and the Outline read them from here.

import { useEffect } from "react";
import { create } from "zustand";
import { viewShowing } from "../editor/view";
import { requestSummary, type Summary } from "../render/client";
import { editorStates, onDocEdited, useDocs } from "./documents";
import { useCursor } from "./status";

const DELAY_MS = 300;

export const useSummary = create<{ docId: string | null; summary: Summary | null }>(() => ({
  docId: null,
  summary: null,
}));

/** The active document's summary, or null until it has been worked out. */
export function useActiveSummary(): Summary | null {
  const docId = useDocs((s) => s.activeId);
  return useSummary((s) => (s.docId === docId ? s.summary : null));
}

/** Keeps the summary of the active document up to date. Mounted once per window. */
export function useSummaryUpdates() {
  const docId = useDocs((s) => s.activeId);
  // The selection's position matters only while text is selected.
  const selection = useCursor((s) => (s.selected ? `${s.line}:${s.column}` : ""));

  useEffect(() => {
    if (!docId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = true;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = viewShowing(docId)?.state ?? editorStates.get(docId);
        if (!state) return;
        const selected = state.selection.ranges.some((r) => !r.empty)
          ? state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join("\n\n")
          : null;
        void requestSummary(docId, state.doc.toString(), selected).then((summary) => {
          if (current && summary) useSummary.setState({ docId, summary });
        });
      }, DELAY_MS);
    };
    schedule();
    const off = onDocEdited((id) => id === docId && schedule());
    return () => {
      current = false;
      clearTimeout(timer);
      off();
    };
  }, [docId, selection]);
}
