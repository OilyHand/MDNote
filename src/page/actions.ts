// The Layout menu (O9): Page Setup, and Word's quick choices of paper size,
// orientation and margins. Each change is one Undo step.

import type { Orientation, PageSetup, PaperSize } from "../mdmeta/schema";
import { activeDoc } from "../state/documents";
import { showPageSetup } from "../state/modal";
import { changeMeta, currentMeta, documentDefaults } from "../styles/look";
import { pageChange } from "./PageSetupDialog";
import { MARGIN_PRESETS, marginsFit, type MarginPreset } from "./page";

/** The active document's page as it is now. */
export function activePage(): PageSetup | null {
  const doc = activeDoc();
  return doc ? (currentMeta(doc.id).page ?? documentDefaults().page) : null;
}

function changePage(update: (page: PageSetup) => PageSetup) {
  const doc = activeDoc();
  const page = activePage();
  if (!doc || !page) return;
  const next = update(page);
  // A choice that leaves no room for text (Wide margins on A5 landscape…) keeps the margins.
  changeMeta(doc.id, pageChange(marginsFit(next) ? next : { ...next, margins: page.margins }));
}

export function setPaperSize(size: Exclude<PaperSize, "custom">) {
  changePage((page) => ({ size, orientation: page.orientation, margins: page.margins }));
}

export function setOrientation(orientation: Orientation) {
  changePage((page) => ({ ...page, orientation }));
}

export function setMarginPreset(preset: MarginPreset) {
  changePage((page) => ({ ...page, margins: { ...MARGIN_PRESETS[preset] } }));
}

export function openPageSetup() {
  const doc = activeDoc();
  if (doc) void showPageSetup(doc.id);
}
