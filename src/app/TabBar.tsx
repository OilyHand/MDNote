// Tabs: click to switch, middle-click or × to close, drag sideways to reorder,
// drag out of the tab bar to move the tab to another window (O1), right-click
// for the tab's menu. (Tauri's file drop handling disables HTML drag-and-drop
// on Windows, so dragging uses pointer events.)

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { activate, displayName, moveDoc, useDocs, type Doc } from "../state/documents";
import { notifyError } from "../state/notices";
import { closeDocument, newDocument } from "./commands";
import { ContextMenu, SEPARATOR, type MenuItem } from "./Menu";
import { shortcutLabel } from "../shortcuts/registry";
import { moveToNewWindow, startTabDrag, useTabDrag } from "./tabWindows";

const DRAG_THRESHOLD_PX = 5;
/** How far outside the tab bar the pointer may go before the tab tears off. */
const TEAR_OFF_PX = 30;

export function TabBar() {
  const { t } = useTranslation();
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const tornOff = useTabDrag((s) => s.docId);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** The gap (0..n) closest to x, among the tab elements. */
  const indexAt = (clientX: number) => {
    const tabs = [...(barRef.current?.querySelectorAll<HTMLElement>(".tab") ?? [])];
    const index = tabs.findIndex((el) => {
      const rect = el.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2;
    });
    return index < 0 ? tabs.length : index;
  };

  const onPointerDown = (event: React.PointerEvent, doc: Doc) => {
    if (event.button === 1) {
      event.preventDefault();
      void closeDocument(doc.id);
      return;
    }
    if (event.button !== 0) return;
    activate(doc.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let moved = false;
    let detached = false;

    const onMove = (e: PointerEvent) => {
      if (detached) return;
      const distance = Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY));
      if (!moved && distance < DRAG_THRESHOLD_PX) return;
      moved = true;
      const bar = barRef.current!.getBoundingClientRect();
      const outside =
        e.clientY < bar.top - TEAR_OFF_PX ||
        e.clientY > bar.bottom + TEAR_OFF_PX ||
        e.clientX < 0 ||
        e.clientX > window.innerWidth;
      if (outside) {
        // From here on Rust follows the mouse, also outside this window.
        detached = true;
        setDragging(null);
        setDropIndex(null);
        void startTabDrag(doc.id, bar);
        return;
      }
      setDragging(doc.id);
      setDropIndex(indexAt(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (moved && !detached) {
        const from = useDocs.getState().docs.findIndex((d) => d.id === doc.id);
        const to = indexAt(e.clientX);
        moveDoc(doc.id, to > from ? to - 1 : to);
      }
      setDragging(null);
      setDropIndex(null);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const onContextMenu = (event: React.MouseEvent, doc: Doc) => {
    event.preventDefault();
    activate(doc.id);
    const others = docs.filter((d) => d.id !== doc.id);
    const items: MenuItem[] = [
      {
        label: t("commands.file.closeTab"),
        shortcut: shortcutLabel("file.closeTab"),
        action: () => void closeDocument(doc.id),
      },
      {
        label: t("tabs.closeOthers"),
        disabled: others.length === 0,
        action: () => void closeAll(others),
      },
      SEPARATOR,
      {
        label: t("commands.file.moveToNewWindow"),
        disabled: docs.length < 2,
        action: () => void moveToNewWindow(doc.id),
      },
      SEPARATOR,
      {
        label: t("tabs.copyPath"),
        disabled: !doc.path,
        action: () => doc.path && void navigator.clipboard.writeText(doc.path).catch(notifyError),
      },
      {
        label: t("tabs.reveal"),
        disabled: !doc.path,
        action: () => doc.path && void revealItemInDir(doc.path).catch(notifyError),
      },
    ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  return (
    <div className="tabbar" role="tablist" ref={barRef}>
      {docs.map((doc, index) => (
        <div
          key={doc.id}
          role="tab"
          aria-selected={doc.id === activeId}
          title={doc.path ?? t("tabs.notSaved")}
          className={[
            "tab",
            doc.id === activeId ? "active" : "",
            doc.dirty ? "dirty" : "",
            doc.id === dragging || doc.id === tornOff ? "dragging" : "",
            dropIndex === index && dragging ? "drop-before" : "",
            dropIndex === docs.length && index === docs.length - 1 && dragging ? "drop-after" : "",
          ].join(" ")}
          onPointerDown={(e) => onPointerDown(e, doc)}
          onContextMenu={(e) => onContextMenu(e, doc)}
        >
          <span className="tab-name">{displayName(doc)}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={doc.dirty ? `${t("tabs.unsaved")}, ${t("tabs.close")}` : t("tabs.close")}
            title={`${t("tabs.close")} (${shortcutLabel("file.closeTab")})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void closeDocument(doc.id)}
          >
            <span className="tab-dirty-dot" aria-hidden>
              ●
            </span>
            <span className="tab-close-x" aria-hidden>
              ×
            </span>
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tab-new"
        title={`${t("tabs.newTab")} (${shortcutLabel("file.new")})`}
        aria-label={t("tabs.newTab")}
        onClick={newDocument}
      >
        +
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  );
}

/** Closes the tabs one by one, asking about unsaved changes; stops if the user cancels. */
async function closeAll(docs: Doc[]) {
  for (const doc of docs) {
    if (!(await closeDocument(doc.id))) return;
  }
}
