// The status bar (O18): word and character counts of the rendered text (also
// for the selection), the cursor position, the encoding and line endings (click
// to change them for the next save), and the zoom (click for 100%).
// Right-click chooses which items are shown.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type LineEnding, type StatusBarItems, type TextEncoding } from "../ipc";
import { encodingLabel } from "../documents/naming";
import { getActiveView } from "../editor/view";
import { requestCounts, type Counts } from "../render/client";
import { markUnsaved, onDocEdited, updateDoc, useDocs, type Doc } from "../state/documents";
import { usePrefs } from "../state/prefs";
import { useCursor, useShownZoom } from "../state/status";
import { setZoom } from "../state/view";
import { ContextMenu, type MenuItem } from "./Menu";

/** Counts follow typing after a short pause, so typing never waits for them. */
const COUNT_DELAY_MS = 300;

/** Counts for the active document, refreshed after edits and selection changes. */
function useCounts(docId: string | null): Counts | null {
  const [counts, setCounts] = useState<{ docId: string; counts: Counts } | null>(null);
  // The selection's position matters only while text is selected.
  const selection = useCursor((s) => (s.selected ? `${s.line}:${s.column}` : ""));

  useEffect(() => {
    if (!docId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = true;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = getActiveView()?.state;
        if (!state) return;
        const selection = state.selection.ranges.some((r) => !r.empty)
          ? state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join("\n\n")
          : null;
        void requestCounts(docId, state.doc.toString(), selection).then((result) => {
          if (current && result) setCounts({ docId, counts: result });
        });
      }, COUNT_DELAY_MS);
    };
    schedule();
    const off = onDocEdited((id) => id === docId && schedule());
    return () => {
      current = false;
      clearTimeout(timer);
      off();
    };
  }, [docId, selection]);

  return counts?.docId === docId ? counts.counts : null;
}

const ENCODINGS: TextEncoding["kind"][] = ["utf8", "utf8Bom", "utf16Le", "utf16Be", "ansi"];

function useSystemCodePage() {
  const [codepage, setCodepage] = useState<number | null>(null);
  useEffect(() => {
    api
      .systemCodePage()
      .then(setCodepage)
      .catch(() => setCodepage(null));
  }, []);
  return codepage;
}

/** The change applies on the next save, so the document now counts as changed. */
function changeEncoding(doc: Doc, encoding: TextEncoding) {
  if (JSON.stringify(encoding) === JSON.stringify(doc.encoding)) return;
  updateDoc(doc.id, { encoding });
  markUnsaved(doc.id);
}

function changeLineEnding(doc: Doc, lineEnding: LineEnding) {
  if (lineEnding === doc.lineEnding) return;
  updateDoc(doc.id, { lineEnding });
  markUnsaved(doc.id);
}

type ItemName = keyof StatusBarItems;
const ITEM_NAMES: ItemName[] = [
  "words",
  "characters",
  "charactersNoSpaces",
  "cursor",
  "encoding",
  "lineEnding",
  "zoom",
];

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const visible = usePrefs((s) => s.preferences.statusBar);
  const items = usePrefs((s) => s.preferences.statusBarItems);
  const update = usePrefs((s) => s.update);
  const doc = useDocs((s) => s.docs.find((d) => d.id === s.activeId));
  const cursor = useCursor();
  const counts = useCounts(doc?.id ?? null);
  const zoom = useShownZoom((s) => s.zoom);
  const codepage = useSystemCodePage();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  if (!visible) return null;
  const number = (n: number) => n.toLocaleString(i18n.language);
  const count = (key: string, name: keyof Counts["total"]) => {
    if (!counts) return "";
    const total = counts.total[name];
    const selection = counts.selection?.[name];
    return selection === undefined
      ? t(`status.${key}`, { count: total, value: number(total) })
      : t(`status.${key}Selected`, {
          count: total,
          value: number(total),
          selected: number(selection),
        });
  };

  const openAt = (event: React.MouseEvent, menuItems: MenuItem[]) => {
    event.preventDefault();
    // The menu is kept inside the window, so near the bottom it opens upwards.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.top, items: menuItems });
  };

  const encodingItems = (current: Doc): MenuItem[] =>
    ENCODINGS.flatMap((kind): MenuItem[] => {
      const encoding: TextEncoding =
        kind === "ansi"
          ? {
              kind,
              codepage:
                current.encoding.kind === "ansi" ? current.encoding.codepage : (codepage ?? 1252),
            }
          : { kind };
      if (kind === "ansi" && codepage === null && current.encoding.kind !== "ansi") return [];
      return [
        {
          label: encodingLabel(encoding),
          checked: current.encoding.kind === kind,
          action: () => changeEncoding(current, encoding),
        },
      ];
    });

  const lineEndingItems = (current: Doc): MenuItem[] =>
    (["crlf", "lf"] as LineEnding[]).map((lineEnding) => ({
      label: t(`lineEnding.${lineEnding}`),
      checked: current.lineEnding === lineEnding,
      action: () => changeLineEnding(current, lineEnding),
    }));

  const chooseItems = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: ITEM_NAMES.map((name) => ({
        label: t(`status.items.${name}`),
        checked: items[name],
        action: () => void update({ statusBarItems: { ...items, [name]: !items[name] } }),
      })),
    });
  };

  const show = (name: ItemName) => items[name] && doc;
  return (
    <footer className="statusbar" onContextMenu={chooseItems}>
      {show("words") ? <span className="status-item">{count("words", "words")}</span> : null}
      {show("characters") ? (
        <span className="status-item">{count("characters", "characters")}</span>
      ) : null}
      {show("charactersNoSpaces") ? (
        <span className="status-item">{count("charactersNoSpaces", "charactersNoSpaces")}</span>
      ) : null}
      <span className="status-spacer" />
      {show("cursor") && cursor.docId === doc?.id ? (
        <span className="status-item">
          {t("status.cursor", { line: number(cursor.line), column: number(cursor.column) })}
        </span>
      ) : null}
      {show("encoding") && doc ? (
        <button
          type="button"
          className="status-item status-button"
          title={t("status.changeEncoding")}
          onClick={(e) => openAt(e, encodingItems(doc))}
        >
          {encodingLabel(doc.encoding)}
        </button>
      ) : null}
      {show("lineEnding") && doc ? (
        <button
          type="button"
          className="status-item status-button"
          title={t("status.changeLineEnding")}
          onClick={(e) => openAt(e, lineEndingItems(doc))}
        >
          {doc.lineEnding.toUpperCase()}
        </button>
      ) : null}
      {items.zoom && zoom !== null ? (
        <button
          type="button"
          className="status-item status-button"
          title={t("status.resetZoom")}
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </footer>
  );
}
