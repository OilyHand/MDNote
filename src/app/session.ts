// Tells Rust which documents this window shows, so it can route files opened from
// Explorer and restore the session next time (O1).

import { api, type TabSession } from "../ipc";
import { editorStates, scrollTops, useDocs } from "../state/documents";

const DELAY_MS = 400;
let timer: ReturnType<typeof setTimeout> | undefined;

function currentTabs(): { tabs: TabSession[]; active: number } {
  const { docs, activeId } = useDocs.getState();
  // Documents that were never saved have no file to reopen.
  const saved = docs.filter((d) => d.path !== null);
  const tabs = saved.map((d) => ({
    path: d.path!,
    scrollTop: scrollTops.get(d.id) ?? 0,
    cursor: editorStates.get(d.id)?.selection.main.head ?? 0,
  }));
  return {
    tabs,
    active: Math.max(
      0,
      saved.findIndex((d) => d.id === activeId),
    ),
  };
}

export async function flushSession() {
  clearTimeout(timer);
  const { tabs, active } = currentTabs();
  await api.reportTabs(tabs, active).catch(() => {});
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void flushSession(), DELAY_MS);
}

export function startSessionReporting() {
  useDocs.subscribe((now, before) => {
    if (now.docs !== before.docs || now.activeId !== before.activeId) schedule();
  });
}

/** Scroll positions change without touching the store; report them occasionally too. */
export function scheduleSessionReport() {
  schedule();
}
