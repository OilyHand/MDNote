// Reading a note's `.mdmeta` (O7). A file that is missing means the defaults;
// one that cannot be read means the defaults too, with a notice: the note can
// still be worked on, and the broken file is only replaced (after a .bak copy)
// once the formatting is changed and saved.

import i18n from "../i18n";
import { api, toAppError } from "../ipc";
import { baseName } from "../documents/naming";
import { notifyInfo } from "../state/notices";
import { EMPTY_META, parseMeta, type DocMeta } from "./schema";

export interface LoadedMeta {
  meta: DocMeta;
  /** The file is there but could not be used. */
  broken: boolean;
}

/** The formatting stored next to `notePath`, reporting problems unless `quiet`. */
export async function loadMeta(notePath: string, quiet = false): Promise<LoadedMeta> {
  const t = i18n.t.bind(i18n);
  const name = baseName(notePath);
  let text: string | null;
  try {
    text = await api.readMeta(notePath);
  } catch (error) {
    if (!quiet) notifyInfo(t("notices.metaBroken", { name, detail: toAppError(error).detail }));
    return { meta: EMPTY_META, broken: true };
  }
  if (text === null) return { meta: EMPTY_META, broken: false };
  const result = parseMeta(text);
  if (!result.ok) {
    if (!quiet) notifyInfo(t("notices.metaBroken", { name, detail: result.problem }));
    return { meta: EMPTY_META, broken: true };
  }
  if (result.newer && !quiet) notifyInfo(t("notices.metaNewer", { name }));
  return { meta: result.meta, broken: false };
}

/** The formatting in a recovery copy (the `.mdmeta` text it was saved with). */
export function recoveredMeta(text: string | null | undefined): DocMeta {
  if (!text) return EMPTY_META;
  const result = parseMeta(text);
  return result.ok ? result.meta : EMPTY_META;
}
