// The sidebar (O13, O14): Files and Outline tabs, on the left of the window.
// View > Sidebar shows or hides it; drag its edge to change the width
// (double-click for the default). Both are remembered.

import { useTranslation } from "react-i18next";
import { SIDEBAR_MAX, SIDEBAR_MIN, useView, type SidebarTab } from "../state/view";
import { FolderTree } from "./FolderTree";
import { Outline } from "./Outline";

const DEFAULT_WIDTH = 240;

function SidebarEdge() {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = useView.getState().sidebarWidth;
    const onMove = (e: PointerEvent) => {
      const width = startWidth + e.clientX - startX;
      useView.setState({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)) });
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };
  return (
    <div
      className="divider sidebar-edge"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useView.setState({ sidebarWidth: DEFAULT_WIDTH })}
    />
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const visible = useView((s) => s.sidebar);
  const width = useView((s) => s.sidebarWidth);
  const tab = useView((s) => s.sidebarTab);
  if (!visible) return null;

  const tabButton = (id: SidebarTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`sidebar-tab${tab === id ? " active" : ""}`}
      onClick={() => useView.setState({ sidebarTab: id })}
    >
      {label}
    </button>
  );

  return (
    <>
      <aside className="sidebar" style={{ width }}>
        <div className="sidebar-tabs" role="tablist">
          {tabButton("files", t("sidebar.files"))}
          {tabButton("outline", t("sidebar.outline"))}
        </div>
        <div className="sidebar-body" role="tabpanel">
          {tab === "files" ? <FolderTree /> : <Outline />}
        </div>
      </aside>
      <SidebarEdge />
    </>
  );
}
