# MDNote

A Word-inspired, lightweight Markdown editor for Windows, built with Tauri 2 and React. Features split-view editing, pixel-level layout control via non-intrusive `.mdmeta` metadata, and native DOCX/PDF export.

- What MDNote does: [Objectives.md](Objectives.md)
- How and in what order it is built: [ImplementationPlan.md](ImplementationPlan.md)

> **Status:** Phase 5 (styles and page). MDNote edits Markdown with Word-style shortcuts, renders it beside the source with per-section styles, style sets and page setup kept in a `.mdmeta` file, pastes images, keeps recovery copies, moves tabs between windows, and browses a folder of notes with an outline of the current one, in English and Korean. Table and image resizing arrive in Phase 6.

## Development

### Prerequisites (Windows 10/11)

- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
- Rust (stable, `x86_64-pc-windows-msvc`) via `rustup`
- Node.js LTS and pnpm (`npm install -g pnpm --allow-scripts=pnpm`; npm 12 blocks pnpm's install script otherwise)
- WebView2 Runtime (included in Windows 11)

### Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm tauri dev` | Run the app with hot reload |
| `pnpm tauri build` | Build the release app and the NSIS installer (`src-tauri/target/release/bundle/nsis/`) |
| `pnpm check` | Type check, lint, formatting check, and frontend tests |
| `cargo test` (in `src-tauri`) | Rust tests, including byte-exact encoding round-trips |

Debug builds started with `MDNOTE_CONFIG_DIR` set are isolated test runs. They keep settings, the session and WebView2's data in that folder instead of `%APPDATA%\io.github.oilyhand.mdnote`, and they never hand files to an installed MDNote that is running.

### Driving the app

`scripts/devtools.mjs` scripts a debug build through WebView2's DevTools port: key presses, IME composition, clicks, screenshots and the editor's state. Build first with `pnpm tauri build --debug --no-bundle`, then:

```
node scripts/devtools.mjs launch notes\test.md    isolated run, settings in %TEMP%\mdnote-devtools
node scripts/devtools.mjs wait                    until the editor is ready
node scripts/devtools.mjs key Ctrl+B
node scripts/devtools.mjs compose 가              a Korean syllable, still being composed
node scripts/devtools.mjs eval "V.state.doc.toString()"
node scripts/devtools.mjs shot screen.png
```

The comment at the top of the script lists every command.

### Layout

```
src/              React + TypeScript: window UI, editor, sidebar, translations (src/i18n/locales)
src-tauri/src/    Rust: file reading and safe saving, settings, session, file watching
tests/fixtures/   Byte-exact sample files (Git never converts them)
scripts/          Developer tools (driving the app for tests)
docs/testing/     Hands-on test checklists
```

## License

[MIT](LICENSE) © 2026 OilyHand
