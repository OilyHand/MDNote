// One CodeMirror view per window. Switching tabs swaps the document's state in
// and out, which keeps each tab's text, selection and Undo history.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { createEditorState, setChangeListener } from "../editor/setup";
import { setActiveView } from "../editor/view";
import { editorStates, refreshDirty, scrollTops, useDocs } from "../state/documents";
import { scheduleSessionReport } from "./session";

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownId = useRef<string | null>(null);
  const activeId = useDocs((s) => s.activeId);

  // Create the view once.
  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current!, state: createEditorState("") });
    viewRef.current = view;
    setActiveView(view);
    setChangeListener((state) => {
      const id = shownId.current;
      if (!id || !editorStates.has(id)) return;
      editorStates.set(id, state);
      refreshDirty(id, state.doc);
    });
    const onScroll = () => {
      if (shownId.current) {
        scrollTops.set(shownId.current, view.scrollDOM.scrollTop);
        scheduleSessionReport();
      }
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      const id = shownId.current;
      if (id && editorStates.has(id)) editorStates.set(id, view.state);
      setChangeListener(() => {});
      setActiveView(null);
      view.destroy();
      viewRef.current = null;
      shownId.current = null;
    };
  }, []);

  // Show the active document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeId || shownId.current === activeId) return;
    const previous = shownId.current;
    if (previous && editorStates.has(previous)) editorStates.set(previous, view.state);
    const state = editorStates.get(activeId);
    if (!state) return;
    shownId.current = activeId;
    view.setState(state);
    const top = scrollTops.get(activeId) ?? 0;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = top;
    });
    view.focus();
  }, [activeId]);

  return <div className="editor-pane" ref={hostRef} />;
}
