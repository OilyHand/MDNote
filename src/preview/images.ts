// Image addresses for the preview. Relative paths are resolved by Rust, which
// also allows each image file for the asset protocol (preview.rs).

import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../ipc";

/** "document path|source" → address the page can load, or null if missing. */
export const useImageUrls = create<{ urls: Map<string, string | null> }>(() => ({
  urls: new Map(),
}));

const WEB = /^(https?:|data:)/i;
const keyOf = (document: string | null, src: string) => `${document ?? ""}|${src}`;

/** Looks up the image sources not resolved yet for this document. */
export async function resolveImages(document: string | null, sources: string[]) {
  const { urls } = useImageUrls.getState();
  const missing = sources.filter((src) => !WEB.test(src) && !urls.has(keyOf(document, src)));
  if (missing.length === 0) return;
  let paths: (string | null)[];
  try {
    paths = await api.resolveImages(document, missing);
  } catch {
    paths = missing.map(() => null);
  }
  useImageUrls.setState(({ urls: current }) => {
    const next = new Map(current);
    missing.forEach((src, i) => {
      const path = paths[i];
      next.set(keyOf(document, src), path ? convertFileSrc(path) : null);
    });
    return { urls: next };
  });
}

/** The address to load for `src` in this document. */
export function imageUrl(document: string | null, src: string): string | undefined {
  if (WEB.test(src)) return src;
  return useImageUrls.getState().urls.get(keyOf(document, src)) ?? undefined;
}

export function useImageUrl(document: string | null, src: string): string | undefined {
  return useImageUrls((s) =>
    WEB.test(src) ? src : (s.urls.get(keyOf(document, src)) ?? undefined),
  );
}
