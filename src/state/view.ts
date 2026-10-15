// How the window shows documents: split view, source only or preview only, the
// divider position and the preview zoom (O2). Remembered between sessions.

import { create } from "zustand";

export type ViewMode = "split" | "source" | "preview";

export interface ViewState {
  mode: ViewMode;
  /** Share of the width given to the source editor in split view. */
  split: number;
  /** Preview zoom, 0.5–2. Ignored while `fitWidth` is on. */
  zoom: number;
  fitWidth: boolean;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const STORAGE_KEY = "mdnote.view";

/** An A4 page is wider than half a typical window, so the page starts fitted to the pane. */
const DEFAULTS: ViewState = { mode: "split", split: 0.5, zoom: 1, fitWidth: true };

function load(): ViewState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ViewState>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

export const useView = create<ViewState>(() => load());

useView.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Remembering the view is a convenience; MDNote works without it.
  }
});

export const clampZoom = (zoom: number) =>
  Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;

export function setViewMode(mode: ViewMode) {
  useView.setState({ mode });
}

export function zoomBy(step: number) {
  useView.setState(({ zoom }) => ({ zoom: clampZoom(zoom + step), fitWidth: false }));
}

export function setZoom(zoom: number) {
  useView.setState({ zoom: clampZoom(zoom), fitWidth: false });
}

export function fitPageWidth() {
  useView.setState({ fitWidth: true });
}
