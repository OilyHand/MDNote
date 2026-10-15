# MDNote

A Word-inspired, lightweight Markdown editor for Windows, built with Tauri 2 and React. Features split-view editing, pixel-level layout control via non-intrusive `.mdn` metadata, and native DOCX/PDF export.

- What MDNote does: [Objectives.md](Objectives.md)
- How and in what order it is built: [ImplementationPlan.md](ImplementationPlan.md)

> **Status:** Phase 1 (foundation). MDNote opens, edits and saves `.md` files in tabs, in English and Korean. Markdown rendering arrives in Phase 2.

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

Debug builds read settings from `MDNOTE_CONFIG_DIR` when it is set, so tests don't touch your real settings in `%APPDATA%\io.github.oilyhand.mdnote`.

### Layout

```
src/              React + TypeScript: window UI, editor, translations (src/i18n/locales)
src-tauri/src/    Rust: file reading and safe saving, settings, session, file watching
tests/fixtures/   Byte-exact sample files (Git never converts them)
docs/testing/     Hands-on test checklists
```

## License

[MIT](LICENSE) © 2026 OilyHand
