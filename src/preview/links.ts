// What clicking a link in the preview does (O2): web links open in the default
// browser, links to other Markdown files open in MDNote, "#heading" scrolls.
// Other local files are only shown in File Explorer: a note must never be able
// to start a program with one click.

import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import i18n from "../i18n";
import { api } from "../ipc";
import { notifyError, notifyInfo } from "../state/notices";
import { requestOpen } from "../app/commands";

const EXTERNAL = /^(https?:|mailto:)/i;
const MARKDOWN = /\.(md|markdown)$/i;

/** Footnote ids get a "user-content-" prefix from the sanitizer. */
function findTarget(container: HTMLElement, id: string): HTMLElement | null {
  const decoded = decodeURIComponent(id);
  for (const candidate of [decoded, `user-content-${decoded}`]) {
    const element = container.querySelector<HTMLElement>(`[id="${CSS.escape(candidate)}"]`);
    if (element) return element;
  }
  return null;
}

export async function followLink(href: string, document: string | null, container: HTMLElement) {
  if (href.startsWith("#")) {
    findTarget(container, href.slice(1))?.scrollIntoView({ block: "start" });
    return;
  }
  if (EXTERNAL.test(href)) {
    await openUrl(href).catch(notifyError);
    return;
  }
  const path = await api.resolveLink(document, href).catch(() => null);
  if (path && MARKDOWN.test(path)) {
    await requestOpen([path]);
  } else if (path) {
    await revealItemInDir(path).catch(notifyError);
  } else {
    notifyInfo(i18n.t("preview.linkNotFound", { target: decodeURIComponent(href) }));
  }
}
