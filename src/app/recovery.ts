// Crash recovery (O1), the window's side. While a document has unsaved
// changes, a copy is written shortly after typing pauses; it is removed when
// the document is saved or closed without saving (recovery.rs keeps them).
// MDNote never writes to the user's own files on its own.

import i18n from "../i18n";
import { api, type RecoveryCopy } from "../ipc";
import { editorStates, getDoc, onDocEdited, useDocs, type Doc } from "../state/documents";
import { ask } from "../state/dialog";
import { baseName } from "../documents/naming";
import { restoreRecoveryCopy } from "./commands";

const DELAY_MS = 1000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function write(id: string) {
  timers.delete(id);
  const doc = getDoc(id);
  const state = editorStates.get(id);
  if (!doc || !state) return;
  if (!doc.dirty) {
    removeRecovery(id);
    return;
  }
  api
    .writeRecovery({
      docId: id,
      path: doc.path,
      untitled: doc.untitled,
      encoding: doc.encoding,
      lineEnding: doc.lineEnding,
      text: state.doc.toString(),
      savedMs: Date.now(),
    })
    .catch((error) => console.error("could not write a recovery copy", error));
}

function schedule(id: string) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => write(id), DELAY_MS),
  );
}

/** The document was saved, or closed without saving: its copy goes. */
export function removeRecovery(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  api.removeRecovery(id).catch(() => {});
}

/** The document moves to another window, which keeps its copy up to date from now on. */
export function handOverRecovery(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** Keeps recovery copies in step with this window's documents. */
export function startRecovery() {
  onDocEdited((id) => {
    if (getDoc(id)?.dirty) schedule(id);
  });
  // Unsaved changes that are not typing: encoding or line endings changed,
  // the file deleted by another program, a tab arriving from another window.
  useDocs.subscribe((now, before) => {
    if (now.docs === before.docs) return;
    const previous = new Map(before.docs.map((d) => [d.id, d]));
    for (const doc of now.docs) {
      const old = previous.get(doc.id);
      if (doc === old) continue;
      if (doc.dirty) schedule(doc.id);
      else if (old?.dirty) removeRecovery(doc.id);
    }
  });
}

function label(copy: RecoveryCopy) {
  return copy.path ? baseName(copy.path) : i18n.t("app.untitled", { number: copy.untitled ?? 1 });
}

/** After a crash: offers to bring back the unsaved changes (main window only). */
export async function offerRecovery() {
  const copies = await api.takeRecovery();
  if (copies.length === 0) return;
  const t = i18n.t.bind(i18n);
  const choice = await ask({
    title: t("dialog.recovery.title"),
    message: t("dialog.recovery.message", {
      count: copies.length,
      files: copies.map(label).join(", "),
    }),
    buttons: [
      { id: "restore", label: t("dialog.recovery.restore"), primary: true },
      { id: "discard", label: t("dialog.recovery.discard") },
    ],
    // Esc never throws work away.
    cancelId: "restore",
  });
  for (const copy of copies) {
    if (choice === "restore") {
      const doc: Doc | undefined = await restoreRecoveryCopy(copy);
      // A file that was reopened by session restore has a new id; the old copy goes.
      if (doc?.id !== copy.docId) api.removeRecovery(copy.docId).catch(() => {});
    } else {
      api.removeRecovery(copy.docId).catch(() => {});
      if (!copy.path) api.discardUnsavedImages(copy.docId).catch(() => {});
    }
  }
}
