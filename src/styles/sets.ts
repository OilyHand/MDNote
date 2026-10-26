// Style sets (O19): named collections of every section style. MDNote ships
// three; the user can save their own, rename and delete them, and share them
// as files. Applying a set copies all its styles into the document, so the
// document looks the same on a PC that does not have the set.

import { create } from "zustand";
import { open, save } from "@tauri-apps/plugin-dialog";
import i18n from "../i18n";
import { api } from "../ipc";
import { orderedStyles, parseStyleMap, type StyleMap } from "../mdmeta/schema";
import { ask } from "../state/dialog";
import { notifyError, notifyInfo } from "../state/notices";
import { askText } from "../state/modal";
import { changeMeta, currentMeta, documentDefaults } from "./look";
import { documentOwnStyles, ownStyles, withoutStyles } from "./model";

export interface StyleSet {
  /** "builtin:<name>" or the user set's file id. */
  id: string;
  builtIn: boolean;
  name: string;
  /** Changes from the built-in styles. */
  styles: StyleMap;
}

const t = i18n.t.bind(i18n);

const BLUE_DARK = "#1f3864";
const BLUE = "#2f5496";

/** The built-in sets, checked with English and Korean text (Korean in Malgun Gothic). */
const BUILT_IN_SETS: { id: string; styles: StyleMap }[] = [
  { id: "default", styles: {} },
  {
    id: "report",
    styles: {
      body: {
        fontFamily: "Cambria",
        fontSize: 11,
        spaceAfter: 8,
        alignment: "justify",
      },
      heading1: {
        fontFamily: "Segoe UI",
        fontSize: 18,
        color: BLUE_DARK,
        spaceBefore: 24,
        spaceAfter: 12,
        alignment: "left",
      },
      heading2: {
        fontFamily: "Segoe UI",
        fontSize: 14,
        color: BLUE,
        spaceBefore: 18,
        spaceAfter: 6,
        alignment: "left",
      },
      heading3: {
        fontFamily: "Segoe UI",
        fontSize: 12,
        color: BLUE,
        spaceBefore: 12,
        spaceAfter: 4,
        alignment: "left",
      },
      heading4: {
        fontFamily: "Segoe UI",
        fontSize: 11,
        italic: true,
        color: BLUE,
        alignment: "left",
      },
      heading5: { fontFamily: "Segoe UI", fontSize: 11, alignment: "left" },
      heading6: { fontFamily: "Segoe UI", fontSize: 10.5, italic: true, alignment: "left" },
      blockquote: { italic: true, color: "#404040" },
      inlineCode: { fontSize: 10 },
      codeBlock: {
        fontSize: 9.5,
        lineSpacing: { rule: "multiple", value: 1.15 },
        codeTheme: "vscode",
      },
      tableHeader: { fontFamily: "Segoe UI", fontSize: 10.5 },
      tableCell: { fontSize: 10.5 },
      link: { color: BLUE },
      footnote: { fontSize: 9 },
    },
  },
  {
    id: "compact",
    styles: {
      body: { fontSize: 10.5, lineSpacing: { rule: "multiple", value: 1 }, spaceAfter: 4 },
      heading1: { fontSize: 16, spaceBefore: 12, spaceAfter: 4 },
      heading2: { fontSize: 13, spaceBefore: 10, spaceAfter: 3 },
      heading3: { fontSize: 11.5, spaceBefore: 8, spaceAfter: 2 },
      heading4: { fontSize: 10.5, spaceBefore: 6, spaceAfter: 2 },
      heading5: { fontSize: 10.5, spaceBefore: 6, spaceAfter: 2 },
      heading6: { fontSize: 10, spaceBefore: 6, spaceAfter: 2 },
      blockquote: { spaceAfter: 4 },
      list: { spaceAfter: 4 },
      inlineCode: { fontSize: 9.5 },
      codeBlock: { fontSize: 9.5, lineSpacing: { rule: "multiple", value: 1.1 }, spaceAfter: 4 },
      equation: { spaceBefore: 2, spaceAfter: 4 },
      tableHeader: { fontSize: 10 },
      tableCell: { fontSize: 10 },
      footnote: { fontSize: 9, spaceBefore: 12 },
    },
  },
];

export function builtInSets(): StyleSet[] {
  return BUILT_IN_SETS.map(({ id, styles }) => ({
    id: `builtin:${id}`,
    builtIn: true,
    name: t(`styleSets.builtIn.${id}`),
    styles,
  }));
}

// ---------------------------------------------------------------------------
// Files: { "mdnoteStyleSet": 1, "name": "…", "styles": { … } }
// ---------------------------------------------------------------------------

const FILE_KIND = "mdnoteStyleSet";

export function setFileText(name: string, styles: StyleMap): string {
  return `${JSON.stringify({ [FILE_KIND]: 1, name, styles: orderedStyles(styles) }, null, 2)}\n`;
}

/** A style set file's name and styles, or null if it is not one. */
export function parseSetFile(text: string): { name: string; styles: StyleMap } | null {
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>;
    if (typeof json !== "object" || json === null || typeof json[FILE_KIND] !== "number") {
      return null;
    }
    const name = typeof json.name === "string" && json.name.trim() ? json.name.trim() : null;
    return name ? { name, styles: parseStyleMap(json.styles) } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// User sets
// ---------------------------------------------------------------------------

export const useStyleSets = create<{ user: StyleSet[] }>(() => ({ user: [] }));

export async function loadStyleSets() {
  try {
    const stored = await api.listStyleSets();
    const user = stored.flatMap(({ id, text }) => {
      const set = parseSetFile(text);
      return set ? [{ id, builtIn: false, ...set }] : [];
    });
    user.sort((a, b) => a.name.localeCompare(b.name));
    useStyleSets.setState({ user });
  } catch (error) {
    notifyError(error);
  }
}

/** Built-in sets first, then the user's, by name. */
export function allSets(user: StyleSet[]): StyleSet[] {
  return [...builtInSets(), ...user];
}

const userSetNamed = (name: string) =>
  useStyleSets.getState().user.find((s) => s.name.toLowerCase() === name.toLowerCase());

async function store(id: string, name: string, styles: StyleMap) {
  await api.saveStyleSet(id, setFileText(name, styles));
  await loadStyleSets();
}

/** The copy of a set's styles that goes into a document (every style, complete). */
export function setCopy(set: StyleSet): StyleMap {
  return ownStyles([set.styles]);
}

/** Applies a set (O19): its styles replace the document's own, as one Undo step. */
export function applySet(docId: string, set: StyleSet) {
  changeMeta(docId, (meta) => ({
    ...withoutStyles(meta),
    styleSet: { name: set.name, styles: setCopy(set) },
  }));
}

/** Design > Save as New Style Set: the document's styles become a user set. */
export async function saveCurrentAsSet(docId: string) {
  const meta = currentMeta(docId);
  const name = await askText({
    title: t("styleSets.saveTitle"),
    label: t("styleSets.name"),
    initial: "",
    ok: t("styleSets.save"),
  });
  if (!name) return;
  const existing = userSetNamed(name);
  if (existing) {
    const choice = await ask({
      title: t("styleSets.replaceTitle"),
      message: t("styleSets.replaceMessage", { name }),
      buttons: [
        { id: "replace", label: t("styleSets.replace"), primary: true },
        { id: "cancel", label: t("styleSets.cancel") },
      ],
      cancelId: "cancel",
    });
    if (choice !== "replace") return;
  }
  const own = documentOwnStyles(meta, documentDefaults().styles);
  try {
    await store(existing?.id ?? crypto.randomUUID(), name, own);
    notifyInfo(t("styleSets.saved", { name }));
  } catch (error) {
    notifyError(error);
  }
}

export async function renameSet(set: StyleSet) {
  const name = await askText({
    title: t("styleSets.renameTitle"),
    label: t("styleSets.name"),
    initial: set.name,
    ok: t("styleSets.rename"),
  });
  if (!name || name === set.name) return;
  const other = userSetNamed(name);
  if (other && other.id !== set.id) {
    notifyInfo(t("styleSets.nameTaken", { name }));
    return;
  }
  await store(set.id, name, set.styles).catch(notifyError);
}

export async function deleteSet(set: StyleSet) {
  const choice = await ask({
    title: t("styleSets.deleteTitle"),
    message: t("styleSets.deleteMessage", { name: set.name }),
    buttons: [
      { id: "delete", label: t("styleSets.delete"), primary: true },
      { id: "cancel", label: t("styleSets.cancel") },
    ],
    cancelId: "cancel",
  });
  if (choice !== "delete") return;
  try {
    await api.deleteStyleSet(set.id);
    await loadStyleSets();
  } catch (error) {
    notifyError(error);
  }
}

const fileFilters = () => [{ name: t("styleSets.fileType"), extensions: ["json"] }];

/** Saves a set as a file to share or to take to another PC. */
export async function exportSet(set: StyleSet) {
  const path = await save({ defaultPath: `${set.name}.json`, filters: fileFilters() });
  if (!path) return;
  await api.exportStyleSet(path, setFileText(set.name, setCopy(set))).catch(notifyError);
}

/** Adds the sets in chosen files as user sets. */
export async function importSets() {
  const picked = await open({ multiple: true, filters: fileFilters() });
  if (!picked) return;
  for (const path of Array.isArray(picked) ? picked : [picked]) {
    try {
      const set = parseSetFile(await api.importStyleSet(path));
      if (!set) {
        notifyInfo(t("styleSets.notASet", { path }));
        continue;
      }
      let name = set.name;
      for (let n = 2; userSetNamed(name); n++) name = `${set.name} (${n})`;
      await store(crypto.randomUUID(), name, set.styles);
      notifyInfo(t("styleSets.imported", { name }));
    } catch (error) {
      notifyError(error);
    }
  }
}
