// One CodeMirror view per window. Switching tabs swaps the document's state in
// and out, which keeps each tab's text, selection and Undo history.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import {
  applyEditorOptions,
  createEditorState,
  setChangeListener,
  setEditorOptions,
} from "../editor/setup";
import { setActiveView } from "../editor/view";
import {
  editorStates,
  notifyDocEdited,
  refreshDirty,
  scrollTops,
  useDocs,
} from "../state/documents";
import { usePrefs } from "../state/prefs";
import { scheduleSessionReport } from "./session";

/** Used when Preferences leave the editor font empty. */
const DEFAULT_EDITOR_FONT = '"Cascadia Mono", Consolas';

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownId = useRef<string | null>(null);
  const activeId = useDocs((s) => s.activeId);
  const fontFamily = usePrefs((s) => s.preferences.editorFontFamily);
  const fontSize = usePrefs((s) => s.preferences.editorFontSize);
  const wordWrap = usePrefs((s) => s.preferences.editorWordWrap);
  const lineNumbers = usePrefs((s) => s.preferences.editorLineNumbers);

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
      notifyDocEdited(id);
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

  // Editor options from Preferences apply to the visible document right away,
  // and to other tabs when they are shown.
  useEffect(() => {
    setEditorOptions({ wordWrap, lineNumbers });
    if (viewRef.current) applyEditorOptions(viewRef.current);
  }, [wordWrap, lineNumbers]);

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
    applyEditorOptions(view);
    const top = scrollTops.get(activeId) ?? 0;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = top;
    });
    view.focus();
  }, [activeId]);

  const style = {
    "--editor-font-family": `${fontFamily ? `"${fontFamily}", ` : ""}${DEFAULT_EDITOR_FONT}, "Malgun Gothic", monospace`,
    "--editor-font-size": `${fontSize}px`,
  } as React.CSSProperties;

  return <div className="editor-pane" ref={hostRef} style={style} />;
}
