import { createRoot } from "react-dom/client";
import { initI18n, resolveLanguage } from "./i18n";
import { initPrefs, usePrefs } from "./state/prefs";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/markdown.css";

const params = new URLSearchParams(location.search);
const isPreferencesWindow = params.get("window") === "preferences";

/** The small label that follows the mouse while a tab is dragged to another window. */
function showTabGhost() {
  const label = document.createElement("div");
  label.className = "tab-ghost";
  label.textContent = params.get("title") ?? "";
  document.body.replaceChildren(label);
  // Rust updates the title for the next drag (tabs.rs).
  (window as unknown as { setGhostTitle(title: string): void }).setGhostTitle = (title) => {
    label.textContent = title;
  };
}

async function boot() {
  if (params.get("window") === "ghost") return showTabGhost();
  await initPrefs();
  const { preferences, systemLanguage } = usePrefs.getState();
  await initI18n(resolveLanguage(preferences.language, systemLanguage));
  const root = createRoot(document.getElementById("root")!);

  if (isPreferencesWindow) {
    const { PreferencesApp } = await import("./preferences/PreferencesApp");
    root.render(<PreferencesApp />);
  } else {
    const [{ App }, { initRecent }, { initCommands }] = await Promise.all([
      import("./app/App"),
      import("./state/recent"),
      import("./app/commands"),
    ]);
    await Promise.all([initRecent(), initCommands()]);
    root.render(<App />);
  }
}

boot().catch((error) => {
  // Translations may not be loaded yet, so this one message is not translated.
  document.body.textContent = `MDNote could not start: ${String(error)}`;
});
