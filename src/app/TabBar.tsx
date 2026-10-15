// Tabs: click to switch, middle-click or × to close, drag sideways to reorder.
// (Tauri's file drop handling disables HTML drag-and-drop on Windows, so
// reordering uses pointer events. Tearing tabs off into windows comes in Phase 3.)

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activate, displayName, moveDoc, useDocs, type Doc } from "../state/documents";
import { closeDocument, newDocument } from "./commands";

const DRAG_THRESHOLD_PX = 5;

export function TabBar() {
  const { t } = useTranslation();
  const docs = useDocs((s) => s.docs);
  const activeId = useDocs((s) => s.activeId);
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

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
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let moved = false;

    const onMove = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      setDragging(doc.id);
      setDropIndex(indexAt(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (moved) {
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
            doc.id === dragging ? "dragging" : "",
            dropIndex === index && dragging ? "drop-before" : "",
            dropIndex === docs.length && index === docs.length - 1 && dragging ? "drop-after" : "",
          ].join(" ")}
          onPointerDown={(e) => onPointerDown(e, doc)}
        >
          <span className="tab-name">{displayName(doc)}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={doc.dirty ? `${t("tabs.unsaved")}, ${t("tabs.close")}` : t("tabs.close")}
            title={t("tabs.close")}
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
        title={t("tabs.newTab")}
        aria-label={t("tabs.newTab")}
        onClick={newDocument}
      >
        +
      </button>
    </div>
  );
}
