// One CodeMirror view per window. Switching tabs swaps the document's state in
// and out, which keeps each tab's text, selection and Undo history.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorView } from "@codemirror/view";
import {
  applyEditorOptions,
  createEditorState,
  setChangeListener,
  setEditorCommandRunner,
  setEditorOptions,
} from "../editor/setup";
import { setActiveView } from "../editor/view";
import { tableAt } from "../editor/table";
import {
  editorStates,
  notifyDocEdited,
  refreshDirty,
  scrollTops,
  useDocs,
} from "../state/documents";
import { usePrefs } from "../state/prefs";
import { scheduleSessionReport } from "./session";
import { runEditorCommand } from "./editorCommands";
import { ContextMenu, SEPARATOR, type MenuItem } from "./Menu";
import { tableItems, useCommandItem } from "./MenuBar";

/** Used when Preferences leave the editor font empty. */
const DEFAULT_EDITOR_FONT = '"Cascadia Mono", Consolas';

setEditorCommandRunner(runEditorCommand);

function useEditorOptions(view: React.RefObject<EditorView | null>) {
  const { i18n } = useTranslation();
  const p = usePrefs((s) => s.preferences);
  useEffect(() => {
    setEditorOptions({
      wordWrap: p.editorWordWrap,
      lineNumbers: p.editorLineNumbers,
      listContinuation: p.editorListContinuation,
      closeBrackets: p.editorCloseBrackets,
      wrapSelection: p.editorWrapSelection,
      renumberLists: p.editorRenumberLists,
      formatTables: p.editorFormatTables,
      language: i18n.language,
    });
    if (view.current) applyEditorOptions(view.current);
  }, [
    view,
    p.editorWordWrap,
    p.editorLineNumbers,
    p.editorListContinuation,
    p.editorCloseBrackets,
    p.editorWrapSelection,
    p.editorRenumberLists,
    p.editorFormatTables,
    i18n.language,
  ]);
}

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownId = useRef<string | null>(null);
  const activeId = useDocs((s) => s.activeId);
  const fontFamily = usePrefs((s) => s.preferences.editorFontFamily);
  const fontSize = usePrefs((s) => s.preferences.editorFontSize);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const item = useCommandItem();

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
  useEditorOptions(viewRef);

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

  /** Right-click: the clipboard commands, plus the table commands inside a table (O16). */
  const onContextMenu = (event: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view || !view.contentDOM.contains(event.target as Node)) return;
    event.preventDefault();
    // As in Word, a right-click outside the selection moves the cursor there.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = view.state.selection.main;
    if (pos !== null && (pos < selection.from || pos > selection.to)) {
      view.dispatch({ selection: { anchor: pos } });
    }
    const inTable = tableAt(view.state, view.state.selection.main.head) !== null;
    const items: MenuItem[] = [
      item("edit.cut"),
      item("edit.copy"),
      item("edit.paste"),
      SEPARATOR,
      item("edit.selectAll"),
      ...(inTable ? [SEPARATOR, ...tableItems(item)] : []),
    ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const style = {
    "--editor-font-family": `${fontFamily ? `"${fontFamily}", ` : ""}${DEFAULT_EDITOR_FONT}, "Malgun Gothic", monospace`,
    "--editor-font-size": `${fontSize}px`,
  } as React.CSSProperties;

  return (
    <>
      <div className="editor-pane" ref={hostRef} style={style} onContextMenu={onContextMenu} />
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => {
            setMenu(null);
            viewRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
