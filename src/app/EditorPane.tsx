// One CodeMirror view per window. Switching tabs swaps the document's state in
// and out, which keeps each tab's text, selection and Undo history.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorView } from "@codemirror/view";
import {
  applyEditorOptions,
  createEditorState,
  setChangeListener,
  setCursorListener,
  setEditorCommandRunner,
  setEditorOptions,
  setImagePasteHandler,
} from "../editor/setup";
import { setActiveView, setShownDocId, takeFocusOnShow } from "../editor/view";
import { tableAt } from "../editor/table";
import { nodeAround } from "../editor/edits";
import {
  editorStates,
  notifyDocEdited,
  refreshDirty,
  scrollTops,
  useDocs,
} from "../state/documents";
import { usePrefs } from "../state/prefs";
import { setReadingLine, updateCursor } from "../state/status";
import { editorTopLine } from "../preview/scrollSync";
import { scheduleSessionReport } from "./session";
import { runEditorCommand } from "./editorCommands";
import { pasteImages } from "./images";
import { ContextMenu, SEPARATOR, type MenuItem } from "./Menu";
import { tableItems, useCommandItem } from "./MenuBar";

/** The cursor's line while it is on screen, otherwise the top visible line (O13). */
function readingLine(view: EditorView): number {
  const top = Math.floor(editorTopLine(view));
  const bottom = view.state.doc.lineAt(
    view.lineBlockAtHeight(view.scrollDOM.scrollTop + view.scrollDOM.clientHeight).from,
  ).number;
  const cursor = view.state.doc.lineAt(view.state.selection.main.head).number;
  return cursor >= top && cursor <= bottom ? cursor : top;
}

/** Used when Preferences leave the editor font empty. */
const DEFAULT_EDITOR_FONT = '"Cascadia Mono", Consolas';

setEditorCommandRunner(runEditorCommand);
setImagePasteHandler((files) => void pasteImages(files));

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
  const { t } = useTranslation();

  // Create the view once.
  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current!, state: createEditorState("") });
    viewRef.current = view;
    setActiveView(view);
    setChangeListener((state) => {
      const id = shownId.current;
      if (!id || !editorStates.has(id)) return;
      editorStates.set(id, state);
      refreshDirty(id, state);
      notifyDocEdited(id);
    });
    setCursorListener((state) => {
      if (shownId.current) updateCursor(shownId.current, state);
    });
    const onScroll = () => {
      if (shownId.current) {
        scrollTops.set(shownId.current, view.scrollDOM.scrollTop);
        scheduleSessionReport();
        setReadingLine(shownId.current, readingLine(view));
      }
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      const id = shownId.current;
      if (id && editorStates.has(id)) editorStates.set(id, view.state);
      setChangeListener(() => {});
      setCursorListener(() => {});
      setActiveView(null);
      setShownDocId(null);
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
    setShownDocId(activeId);
    applyEditorOptions(view);
    updateCursor(activeId, view.state);
    const top = scrollTops.get(activeId) ?? 0;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = top;
    });
    if (takeFocusOnShow()) view.focus();
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
    const head = view.state.selection.main.head;
    const inTable = tableAt(view.state, head) !== null;
    const inLink = Boolean(
      nodeAround(view.state, head, "Link") ?? nodeAround(view.state, head, "Autolink"),
    );
    const items: MenuItem[] = [
      item("edit.cut"),
      item("edit.copy"),
      item("edit.paste"),
      SEPARATOR,
      item("edit.selectAll"),
      ...(inLink
        ? [
            SEPARATOR,
            item("insert.link", { label: t("linkDialog.edit") }),
            item("format.removeLink"),
          ]
        : []),
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
