import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

/**
 * The render worker has no DOM, but Vite resolves packages with the "browser"
 * condition there too. decode-named-character-reference's browser build calls
 * `document.createElement` when it loads, which killed the worker (the preview
 * stayed blank). Use its DOM-free build, which it also ships for workers.
 */
function domFreeInWorkers(): Plugin {
  return {
    name: "mdnote:dom-free-in-workers",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source !== "decode-named-character-reference") return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && { ...resolved, id: resolved.id.replace(/index\.dom\.js$/, "index.js") };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  worker: {
    // ES module workers can load code on demand (Shiki loads each language when used).
    format: "es",
    plugins: () => [domFreeInWorkers()],
  },

  // Tauri expects a fixed port and wants Rust errors to stay visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/spikes/**"],
    },
  },

  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
