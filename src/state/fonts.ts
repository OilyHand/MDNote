// The fonts installed on this PC (O3), read once per window. The font picker's
// Refresh asks Windows again, for fonts installed since.

import { create } from "zustand";
import { api, type FontFamily } from "../ipc";
import { fontIndex, type FontIndex } from "../styles/css";
import { notifyError } from "./notices";

interface FontsStore {
  fonts: FontFamily[] | null;
  index: FontIndex;
}

export const useFonts = create<FontsStore>(() => ({ fonts: null, index: null }));

let loading: Promise<void> | null = null;

function load(refresh: boolean): Promise<void> {
  return api
    .listFonts(refresh)
    .then((fonts) => useFonts.setState({ fonts, index: fontIndex(fonts) }))
    .catch(notifyError);
}

/** Loads the font list the first time it is needed. */
export function ensureFonts(): Promise<void> {
  loading ??= load(false);
  return loading;
}

export function refreshFonts(): Promise<void> {
  loading = load(true);
  return loading;
}
