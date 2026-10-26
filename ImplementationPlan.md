# MDNote: Implementation Plan

> Status: draft, 2026-10-15

[Objectives.md](Objectives.md) defines **what** MDNote does (O1–O20). This plan describes **how** and **in what order** it gets built. When a decision changes, update the Decisions table in Objectives.md first, then this plan.

---

## 1. Overview

| Phase | Goal | Objectives | Relative effort | Milestone |
|---|---|---|---|---|
| 0. Setup and spikes | Install the toolchain, tidy the repo, and test the riskiest techniques with throwaway prototypes | — | S | — |
| 1. Foundation | An installable app that opens, edits as plain text, and saves `.md` files in tabs, in English and Korean | O1, O11, O12 | M | v0.1 |
| 2. Rendering | Split view with complete Markdown rendering | O2 | M | v0.2 |
| 3. Editing | Word-style shortcuts, editor conveniences, table tools, image paste, status bar, crash recovery, tab windows | O1, O8, O15–O18 | L | v0.3 |
| 4. Navigation | Sidebar with folder tree and outline | O13, O14 | M | v0.4 |
| 5. Styles and page | Fonts, styles, style sets, page setup, `.mdmeta` files | O3, O4, O7, O9, O19 | L | v0.5 |
| 6. Layout | Table and image resizing with the mouse | O5, O6, O7, O16 | M | v0.6 |
| 7. Output | PDF and Word export, copy as rich text | O10, O20 | L | v0.7 |
| 8. Release | Icons, signing, auto-update, translation review, installer tests | O1, O11 | M | v1.0 |

*Effort:* S = small, M = medium, L = large, relative to each other.

Each phase ends with a working, installable build, tagged with the milestone version.

---

## 2. Architecture

### 2.1 Project layout

```
MDNote/
├─ src/                      React + TypeScript (everything inside the window)
│  ├─ app/                   window shell: menu bar, tab bar, dialogs, status bar
│  ├─ editor/                CodeMirror setup, commands, keymaps (O8, O16, O17)
│  ├─ render/                Markdown pipeline, runs in a Web Worker (O2)
│  ├─ preview/               page view, scroll sync, table/image resizing (O5, O6)
│  ├─ styles/                style model, CSS variables, style sets (O4, O19)
│  ├─ mdmeta/                .mdmeta schema, load / merge / save, element matching (O7)
│  ├─ page/                  page setup, ruler, unit conversion (O9)
│  ├─ export/                DOCX builder, PDF request, rich-text copy (O10, O20)
│  ├─ sidebar/               folder tree and outline (O13, O14)
│  ├─ shortcuts/             one shortcut table that drives keys, menus, F1 (O8)
│  ├─ i18n/                  i18next setup; locales/en.json, locales/ko.json (O11)
│  └─ state/                 stores: documents, tabs, preferences, session
├─ src-tauri/                Rust (everything that touches Windows)
│  ├─ src/
│  │  ├─ files.rs            read/write with encoding + line endings, safe save
│  │  ├─ watch.rs            file and folder change notifications
│  │  ├─ windows.rs          window and tab registry, moving tabs between windows
│  │  ├─ session.rs          session restore and crash recovery
│  │  ├─ fonts.rs            DirectWrite font list
│  │  ├─ locale.rs           UI language, paper size, measurement units from Windows
│  │  ├─ shell.rs            Recycle Bin, Show in Explorer, Default Apps page
│  │  └─ pdf.rs              PDF export through WebView2
│  ├─ capabilities/          Tauri permission sets
│  └─ tauri.conf.json        identifier, publisher, installer, file association
├─ resources/stylesets/      built-in style sets (JSON)
├─ tests/
│  ├─ fixtures/              sample files kept byte-for-byte (CRLF, UTF-16, ANSI)
│  └─ e2e/                   end-to-end tests
└─ docs/                     user guide (EN/KO), manual test checklists
```

### 2.2 Key design choices

- **One document = text + metadata + file info.** The text lives in a CodeMirror state. The `.mdmeta` metadata lives in a field of that same state, and file info is kept alongside: path, encoding, line endings, and last-modified time. Because text edits and layout changes (style changes, table and image resizes) are transactions in the same state, **one Undo history covers both**, so Ctrl+Z undoes a table resize just like a typed word.
- **Rendering runs in a Web Worker.** Markdown is parsed (remark → rehype → sanitize → KaTeX → Shiki) off the main thread, so typing stays smooth on large notes. The worker returns a syntax tree with source line numbers (for scroll sync) and element keys (table index and fingerprint, image path and occurrence, for O7). Export (O10) reuses the same pipeline.
- **One unit-conversion module.** The screen, PDF, and DOCX all convert through the same `page/units.ts`:
  - pt for fonts
  - px for layout (96 per inch)
  - mm for the page
  - twips and EMU for Word

  This keeps the three outputs identical.
- **Styles are CSS variables.** Each section type's style becomes a set of variables on the page element. Changing a style is instant and never re-renders the document.
- **The `.mdmeta` module is pure TypeScript.** It covers the schema (with validation), version migrations, merging (built-in → user → document), saving only the differences from defaults, and preserving unknown fields. It is easy to unit-test in isolation.
- **Rust keeps a registry of windows and tabs.** Rust knows which window holds which file. That powers "already open → switch to its tab", sending a file opened from Explorer to the right window, session restore, and moving tabs between windows. A moved tab carries its serialized editor state, including Undo history.
- **The menu bar is drawn in React, not by Windows.** Native Windows menu bars cannot follow dark mode and are awkward to translate on the fly. The window keeps the normal Windows title bar, so Snap Layouts keep working.
- **One shortcut table.** Each entry has an id, keys, a command, a menu location, and a translated label. Keymaps, menu labels, tooltips, and the F1 list are all generated from it, so they can never disagree.
- **File access goes through Rust commands.** Each path comes from a dialog, the sidebar, or the command line. Images in a note's folder are shown through Tauri's asset protocol, with permission granted for that folder only while the note is open.

### 2.3 Main dependencies

| Purpose | Packages |
|---|---|
| UI | `react`, `typescript`, `vite`, `zustand` (state) |
| Editor | CodeMirror 6 (`@codemirror/*`, `@lezer/markdown`) |
| Rendering | `unified`, `remark-parse`, `remark-gfm`, `remark-math`, `remark-rehype`, `rehype-raw`, `rehype-sanitize`, `rehype-katex`, `katex`, `shiki`, `hast-util-to-jsx-runtime` |
| Data validation | `zod` |
| Translations | `i18next`, `react-i18next` |
| Table alignment | `string-width` (East Asian character widths) |
| DOCX | `docx` (its `docx/math` module converts LaTeX to Word equations; see spike 3) |
| Tauri plugins | `single-instance`, `dialog`, `store`, `opener`, `clipboard-manager`, `updater` (Phase 8) |
| Rust crates | `windows` (DirectWrite, file and locale APIs), `webview2-com`, `encoding_rs`, `notify`, `trash`, `serde` |
| Tests | `vitest`, `@testing-library/react`, WebdriverIO with `tauri-driver` |

---

## 3. Phases

### Phase 0: Setup and spikes — ✅ complete (2026-10-15)

**Goal:** A working toolchain, a tidy repository, and early answers on the five riskiest techniques.

**Tasks**
- **0.1 Install the toolchain** (installed and verified 2026-10-15: Node.js 24.20, npm 12.2, pnpm 12.11.2, Rust 1.99, VS 2022 Build Tools 17.14, Windows SDK 10.0.26100, WebView2 155):
  - Visual Studio 2022 Build Tools with the "Desktop development with C++" workload (MSVC compiler + Windows SDK). Needs administrator approval.
  - Rust (`rustup`, stable MSVC toolchain).
  - Node.js LTS and pnpm.
  - GitHub CLI (optional, for pull requests and releases).
- **0.2 Repository hygiene:**
  - `.gitignore` for `node_modules`, `dist`, and `src-tauri/target`.
  - `.gitattributes`:
    - LF line endings for source files
    - `tests/fixtures/** -text`, so test files with CRLF, UTF-16, or ANSI encoding keep their exact bytes (this machine has `core.autocrlf=true`, which would otherwise rewrite them)
  - `.editorconfig`.
  - `LICENSE` (see section 7).
- **0.3 Spikes.** Each is a small throwaway prototype, 1–2 days, kept out of `main`. Each records "works / needs a different approach" in this plan.
  1. **Tab tear-off:** drag a tab out of one Tauri window into a new window, and onto another window's tab bar.
  2. **PDF:** WebView2's DevTools `Page.printToPDF` with the paper size and margins from CSS `@page`, page numbers from `@page` margin boxes, and bookmarks from headings.
  3. **Word equations:** LaTeX → OMML → `docx`. Confirm the equation is editable in Word.
  4. **Fonts:** list fonts through DirectWrite, including fonts installed for the current user only. Get both English and Korean family names, and detect monospaced fonts.
  5. **Korean IME:** composing Korean in CodeMirror inside WebView2. Shortcuts must not fire mid-composition, and auto-closing brackets must not break composition.

**Exit criteria**
- A "hello world" Tauri app builds and runs on this PC.
- All five spike results are recorded.

**Results** (details in `spikes/*/RESULTS.md` on the `phase0/spikes` branch)

| Spike | Result | Consequence for the plan |
|---|---|---|
| 1. Tab tear-off | ✅ Works: tear off to a new window, move to another window's tab bar, reorder, Esc to cancel, a single tab moves its window, an emptied window closes. Undo history travels with the tab. | Phase 3.9 reuses the design: the frontend handles reordering; once a tab leaves the tab bar, Rust follows the mouse globally (`GetCursorPos` / `GetAsyncKeyState`) and decides the drop with `WindowFromPoint`. |
| 2. PDF | ✅ Works as planned: A4 page size, margins, `@page` header and page numbers, page breaks, bookmarks, tagged PDF, embedded fonts. About 1 s for 4 pages. | `.otf` (CFF) and variable fonts are embedded as Type3 (they look right but may be less crisp in some viewers): mention this in the user guide. Give every style an explicit Korean fallback font. |
| 3. Word equations | ✅ Works, but **not** through `mathml2omml`, which needed a dozen fixes and still had errors. The `docx` library's own `docx/math` `latexToMath` was correct on 35 of 36 test equations; the 36th was a deliberately unknown command. | Phase 7 uses `docx/math`, with a KaTeX image as the fallback. `mathml2omml` is dropped. |
| 4. Fonts | ✅ Works: 243 families including 31 per-user families, Korean names, monospaced and Hangul flags, in about 33 ms. | Use the legacy (WWS) collection so every listed name works in CSS. Cache the list. Refresh with `checkForUpdates`. |
| 5. Korean IME | ✅ Works: all 7 hands-on checks passed (typing, brackets, list continuation during composition, Ctrl+B guard, Backspace by jamo). | Every MDNote keyboard command checks `view.composing` before acting. |

**Lessons for Phase 1**
- **Tauri permissions are explicit.** `core:default` does not include opening a window from the web page (`core:webview:allow-create-webview-window`). In the spike, the IME window failed silently until this was added. MDNote lists every permission it needs in its capability files.
- **Never ignore a failed Tauri call.** Every failure is reported to the user, translated, and logged.
- **npm 12 blocks install scripts by default.** pnpm itself needed `--allow-scripts=pnpm` to install. Dependencies whose install scripts are required must be listed explicitly in `package.json`.

---

### Phase 1: Foundation (O1, O11, O12) → v0.1 — ✅ complete (2026-10-15)

**Goal:** An installable app that opens `.md` files from Explorer into tabs, edits them as plain text, and saves them safely, with an English and Korean UI.

**Status (2026-10-15):** all tasks below are implemented on `phase1/foundation`.

Verified automatically:
- 14 Rust tests: encoding round-trips for 6 formats, safe saving, read-only protection, settings files (including ones saved with a BOM), and path matching.
- 11 frontend tests: translation parity, shortcuts (including with the Korean IME on), and naming.

Verified by running the app:
- opening files from the command line
- a second `MDNote.exe` handing its file to the running window
- switching to an already-open file opened with different letter case
- the code-page and mixed line-ending notices
- the outside-change banner
- session restore, including window size and position
- the Korean UI and the light theme

Hands-on checklist [docs/testing/phase-1.md](docs/testing/phase-1.md): all 30 items pass.

The first CI runs on GitHub (pull request #2, and `main` after the merge) failed at `pnpm install --frozen-lockfile`: the committed `pnpm-lock.yaml` still had the scaffold's version ranges. The lockfile committed in Phase 2 matches `package.json`; CI passed on pull request #3 and on `main` after that merge.

**Lessons for later phases**
- **Windows Notepad is not a neutral test editor for `.md` files.** Its Markdown formatted view rewrites the file on save, adding blank lines between paragraphs and an empty line at the end, and doesn't show those lines. Use a plain-text editor such as Sublime Text or VS Code for outside-change tests.
- **Check the bytes before fixing.** Two guesses about test 19 were wrong. A hex dump of the file settled it each time.
- **Keep test runs isolated.** Debug builds started with `MDNOTE_CONFIG_DIR` use their own settings and never hand files to an installed MDNote that is running.

**Tasks**
- **1.1 Scaffold:**
  - `create-tauri-app` with React + TypeScript and pnpm
  - set the identifier `io.github.oilyhand.mdnote`, the product name, and the publisher `oilyhand`
  - ESLint, Prettier, Vitest, `rustfmt`, `clippy`
- **1.2 Continuous integration:** GitHub Actions on Windows: lint, type check, unit tests, `cargo test`, and a build on every push.
- **1.3 Translations:** i18next with `en.json` and `ko.json`.
  - The first language follows the Windows display language, read by Rust.
  - A CI check fails the build if the two language files don't have the same keys.
- **1.4 Preferences store:** a typed schema with defaults, saved in `%APPDATA%\io.github.oilyhand.mdnote\`.
  - Preferences window (Ctrl+,) with **General** (language, session restore, number of recent files) and **Appearance** (theme).
- **1.5 Window shell:** React menu bar, tab bar, title text, empty-window screen, and light/dark themes following Windows.
- **1.6 File reading and writing (Rust):**
  - detect the encoding: BOM, then a UTF-8 check, then the ANSI code page via `encoding_rs`
  - detect line endings
  - write back with the same encoding and line endings
  - safe save: write a temporary file in the same folder, then swap it in with `ReplaceFileW`
- **1.7 Document lifecycle:**
  - New, Open, Save, Save As, Close
  - unsaved-changes markers and Save / Don't Save / Cancel prompts
  - recent files
  - a basic CodeMirror editor (no Markdown features yet)
- **1.8 External changes:** watch open files, and offer to reload when one changes on disk.
- **1.9 Single instance and command line:**
  - the file path passed by Explorer opens in the most recently used window
  - a file that is already open switches to its tab. Paths are compared without regard to letter case, as Windows does.
- **1.10 Session restore:**
  - save windows, tabs, active tab, and scroll positions
  - restore them at startup, skipping missing files with a notice
  - can be turned off in Preferences
  - the session format already supports several windows, ready for Phase 3
- **1.11 Installer (NSIS):**
  - per-user install
  - English and Korean installer screens
  - `.md` and `.markdown` file association, with a placeholder icon
  - an in-app **Make MDNote the default** button that opens the Windows Default Apps page

**Exit criteria:** all O1 "Done when" items except tab windows and crash recovery (Phase 3). The UI is complete in both languages.

---

### Phase 2: Rendering (O2) → v0.2 — ✅ complete (2026-10-15)

**Goal:** A split view that renders every supported syntax accurately and quickly.

**Status (2026-10-15):** all tasks below are implemented on `phase2/rendering`.

Verified:
- **Automated:** 33 frontend tests (+3 test files) and 20 Rust tests (+4).
- **CommonMark:** 562 of 588 spec examples (outside the raw-HTML sections) match exactly. The other 26 are documented deliberate differences:
  - sanitizing
  - raw HTML parsed by a real HTML parser
  - GFM autolinks
  - code highlighting
- **Running the app:** screenshots of every section of the sample document.

Hands-on checklist [docs/testing/phase-2.md](docs/testing/phase-2.md): all 23 items pass.

**What changed from the plan**
- **Rendering in cached chunks.** remark's parser slows down faster than linearly with document size: 1 MB took about 21 s in one piece, but about 3.4 s in 90 KB pieces. The document is therefore split into top-level chunks that render on their own and are cached (`src/render/chunks.ts`).
  - Speed: an edit to a 1 MB document re-renders in about **60 ms**. The first render takes about 7 s in Node for an extreme test file with 5,000 code blocks and 5,000 equations. Typing stays responsive meanwhile, because rendering runs in the worker.
  - Correctness: tests check that chunked output equals whole-document output for every CommonMark example, and for all of them joined together. Documents with footnotes render in one piece, because footnote numbers span the document.
- **Own KaTeX step instead of rehype-katex.** Its browser build needs `DOMParser`, which a Web Worker lacks, so the worker died as soon as it loaded and the preview stayed blank. A worker-only Vite plugin also picks the DOM-free build of `decode-named-character-reference` for the same reason. A failed worker now shows an error in the preview.
- **Worker as an ES module.** This lets Shiki load each language on demand. The worker bundle went from 10.7 MB to 0.8 MB.
- **GFM example suite.** There is no maintained package of GFM spec examples. GFM features (tables, task lists, strikethrough, autolinks, footnotes) are covered by unit tests instead.
- **Brought forward from Phase 5 / O12:** the system font list (`fonts.rs`) and the Preferences **Editor** section (font, size, word wrap, line numbers), because task 2.1 needs an editor font setting.
- **Defaults:** Fit Page Width is the starting zoom, because an A4 page is wider than half a typical window.
- **Links to local files that aren't Markdown** only open File Explorer at the file. A note must never be able to start a program with one click.

**Tasks**
- **2.1 Editor:** CodeMirror Markdown mode (GitHub Flavored Markdown), line wrapping, and the editor font from Preferences.
- **2.2 Render worker:** the pipeline from section 2.2, plus:
  - a sanitizing rule set that allows `<u>`, KaTeX output, and the page break comment
  - Shiki languages loaded only when a code block needs them
- **2.3 Page view:**
  - the rendered tree is shown with React on a "page" element
  - the page is A4 with Normal margins until Page Setup arrives in Phase 5
  - only changed blocks re-render
- **2.4 Layout:**
  - draggable dividers
  - **View** modes: Split, Source only, Preview only
  - zoom: 50–200%, Fit page width, Ctrl+mouse wheel
- **2.5 Scroll sync:** both panes follow each other, using source line numbers stored on rendered blocks. Positions between blocks are interpolated, so tall images and equations don't cause jumps.
- **2.6 Images and links:**
  - relative image paths are served through the asset protocol
  - web links open in the browser
  - `.md` links open in MDNote
  - `#heading` links scroll within the note
- **2.7 Print:** Ctrl+P with a print style sheet.
- **2.8 Test corpus:**
  - the official CommonMark and GFM example suites run as automated tests
  - one hand-made document covers every supported syntax
  - a 1 MB document is used for a performance check: the preview updates within about 100 ms after typing stops

**Exit criteria:** the O2 "Done when" items.

---

### Phase 3: Editing (O1, O8, O15, O16, O17, O18) → v0.3 — ✅ complete (2026-10-24)

**Goal:** Comfortable Word-style editing, and the remaining O1 window features.

**Status (2026-10-16):** all tasks below are implemented on `phase3/editing`.

Verified:
- **Automated:** 80 frontend tests (+47) and 24 Rust tests (+4).
- **Running the app:** the debug build was driven through WebView2's DevTools port (see the lessons below). Script-checked:
  - formatting keys, menus with keyboard navigation, the F1 list, Find and Replace
  - list continuation and renumbering, brackets, wrapping a selection
  - Korean IME composition: inside brackets, and Ctrl+B mid-syllable
  - table Tab navigation and alignment
  - image paste (saved and never-saved notes), drop, and the move on first save
  - status bar counts and a line-ending change written on save
  - a forced quit and the restore
  - Move to New Window with its Undo history, and two-window session restore

Hands-on checklist [docs/testing/phase-3.md](docs/testing/phase-3.md): the first run (2026-10-23) passed 30 items, item 6 partly, and item 31 failed. After the fixes below, the rechecks R1–R9 (2026-10-23 and 10-24) all pass. Alt+= now works with the Microsoft Korean IME, which confirms that the IME keeps the key-down of Alt+= for itself.

Fixes after the first run:
- **Shortcuts right after typing Korean did nothing** (Alt+=, Ctrl+Enter, Alt+Shift+↑/↓). CodeMirror ignores every key while the IME composes, and the last syllable stays composed until the next key. Now a Ctrl or Alt shortcut finishes the syllable first, then runs, as in Word (the O8 rule changed accordingly).
- **Moving a numbered item with Alt+Shift+↑/↓ raised the numbers each time.** The list took its start from whichever item ended up first. After a move it now starts at its lowest number.
- **Closing two windows one after the other restored only the last one.** **File > Exit** now closes every window and restores them all. Windows closed within 15 seconds of the last one also come back. **File > Close Window** (Alt+F4) closes one window.
- **Suggestion: remove a link.** Ctrl+Shift+F9 (Word's Unlink), a **Remove Link** button in the Ctrl+K dialog, and right-click items on a link.
- **Alt+= still failed with the Microsoft Korean IME, even without typing Korean** (second run, 2026-10-24). The IME appears to keep the key-down of some Alt shortcuts for itself; the script cannot reproduce a real IME, since it sends keys past Windows' input methods. Three changes:
  - An Alt shortcut whose key comes up without having gone down now runs on the key-up.
  - Insert Equation also has Ctrl+Shift+M (as in Typora), because Ctrl shortcuts pass the IME.
  - The F1 window has a **Try a shortcut** box that shows exactly which key events MDNote receives.
- **Isolated test runs failed while an installed MDNote was running.** Both used the same WebView2 data folder with different options. Isolated runs (`MDNOTE_CONFIG_DIR`) now keep their own WebView2 data.

**What changed from the plan**
- **Tab is shared.** In a table it moves between cells, in a list item it changes the level, and elsewhere it inserts a tab. The shortcut table allows a key to be bound to several commands, tried in order; a test makes sure no other key is bound twice.
- **Tables line up on Tab too**, not only when the cursor leaves them, so a table being filled in stays readable. With automatic alignment off, Tab only moves (and a new row is written compactly).
- **Enter on an empty list item leaves a blank line.** Without it, the next line would still belong to the list item above (Markdown's lazy continuation), unlike Word.
- **Pasting prefers text.** When the clipboard holds both text and a picture (Word copies a picture of the text along with it), the text is pasted.
- **Image links** percent-encode spaces, parentheses, `#`, `?` and `%`, and keep Korean readable: `assets/회의%20사진.png`. A dropped image that is already in the image folder is linked, not copied.
- **Counts** come from the render worker's chunk cache (a separate count request), so they also work in Source Only view. Generated text is left out: MathML copies of equations, footnote back links and the footnote label.
- **Status bar items and visibility are Preferences**, so every window follows a change at once.
- **Crash recovery:** Esc in the restore question means Restore, so a key press never throws work away.
- **Text changed from outside the editor** (reload, images, recovery) goes to the document the view really shows. Right after a tab switch the view can briefly still hold the previous document.

**Lessons for later phases**
- **Drive the real app through WebView2's DevTools port.** [scripts/devtools.mjs](scripts/devtools.mjs) starts an isolated debug build with the port open and scripts it over the Chrome DevTools Protocol:
  - key presses, IME composition, clicks and screenshots
  - reading the editor state and calling Tauri commands
  
  This found two real bugs that unit tests missed: Enter's keymap order, and list ending. Only physical-mouse features (tab tear-off) still need a person.
- **Simulated mouse clicks use CSS pixels.** Screenshots are in device pixels (125% on this PC), so take click positions from the page (`coordsAtPos`, `getBoundingClientRect`) rather than from a screenshot.

**Tasks**
- **3.1 Shortcut table** (section 2.2): generates keymaps, menu labels, tooltips, and the F1 list. While an IME is composing, shortcuts are ignored.
- **3.2 Formatting commands:**
  - toggle bold, italic, underline, strikethrough, and inline code, using the whole word under the cursor when nothing is selected
  - headings, normal paragraph, lists, blockquote, code block
  - insert link (Ctrl+K dialog), equation (Alt+=), and page break (Ctrl+Enter)
  - move lines (Alt+Shift+↑/↓)
  - Ctrl+] / Ctrl+[ are added in Phase 5, once styles exist
- **3.3 Find, Replace, Go to line:** CodeMirror's search, with the panel translated.
- **3.4 Editor conveniences (O17):**
  - list continuation and renumbering, using CodeMirror's Markdown commands
  - auto-closing brackets, and wrapping a selection in markers
  - each behavior can be switched off in Preferences
- **3.5 Table tools, source side (O16):**
  - grid picker to insert a table
  - insert and delete rows and columns, column alignment
  - Tab moves between cells, and Tab in the last cell adds a row
  - automatic alignment, counting Korean characters as double width
- **3.6 Image paste and drop (O15):**
  - Rust saves the image file and the editor inserts the relative link
  - name clashes are handled
  - unsaved notes keep images in a temporary folder until their first save
  - links stay safe when paths contain spaces or Korean characters
- **3.7 Status bar (O18):**
  - word count, and character counts with and without spaces, all based on the rendered text. Words are counted by spaces, which matches how Korean word processors count 어절.
  - counts for the current selection
  - cursor line and column
  - encoding and line-ending switchers
  - zoom
  - a right-click menu to choose which items are shown
- **3.8 Crash recovery (O1):**
  - recovery copies of unsaved documents are written shortly after typing pauses
  - on the next start after a crash, MDNote offers to restore them
- **3.9 Tab windows (O1):**
  - **Move to new window**
  - dragging a tab out to tear it off, or onto another window's tab bar
  - a moved tab carries its text, metadata, and Undo history

**Exit criteria:** the "Done when" items of O8, O15, O17, and O18, the source-side part of O16, and the rest of O1.

---

### Phase 4: Navigation (O13, O14) → v0.4 — ✅ complete (2026-10-26)

**Goal:** Browse a folder of notes and move around inside a note.

**Status (2026-10-24):** all tasks below are implemented on `phase4/navigation`.

Verified:
- **Automated:** 86 frontend tests (+6, link rewriting) and 27 Rust tests (+3: names, companions, numbering).
- **Running the app** (scripted through the DevTools port):
  - the Outline: nesting, rendered text, a `#` line in a code block left out, clicking a heading, the highlight following scrolling, Preview Only view
  - the Files tab: listing, hidden `.mdmeta` and non-Markdown files, a file created outside MDNote appearing, renaming in place (F2), New Note, dragging a note into a folder with its link updated, Delete into the Recycle Bin together with the `.mdmeta`
  - restoring the window's folder

Hands-on checklist [docs/testing/phase-4.md](docs/testing/phase-4.md) (2026-10-26): all 18 items pass. Items 7, 12 and 15 could not be checked at first, because nothing writes a metadata file before Phase 5; the rechecks R1–R3 with a hand-made one pass. That "a renamed note keeps its formatting" is left for the Phase 5 checklist.

**What changed from the plan**
- **Headings come from the render worker's summary**, the same request that counts words for the status bar. They are the rendered text and also update in Source Only view.
- **A note's `<name>.assets` folder travels with it**, as its `.mdmeta` does (images pasted under the "<note name>.assets" choice of O15 would otherwise be left behind).
- **Link fixing covers links to other files too**, not only images, and runs for single notes. Moving a folder keeps the links inside it working, so it is not checked.
- **A click in the folder tree keeps the keyboard there.** In the first scripted run, a click opened the note and moved the focus to the editor, so Delete deleted text instead of the file. Now F2 and Delete act on the tree, and double-click or Enter moves on to the editor.
- **Deleting an open note** closes its tab, unless it has unsaved changes; that text stays, with the "deleted" notice.
- **Open Folder** has the shortcut Ctrl+Shift+O.
- **The metadata file is `.mdmeta`**, no longer `.mdn`, which Microsoft Access registers for its blank database templates (found during the hands-on test). Nothing wrote the files yet, so only the sidebar's rules, the tests and the docs changed.

**Tasks**
- **4.1 Sidebar:** **Files** and **Outline** tabs, resizable width, **View > Sidebar**.
- **4.2 Outline:**
  - headings from the render worker
  - the current section is highlighted as you scroll and edit
  - clicking a heading scrolls both panes to it
- **4.3 Folder tree:**
  - folders are listed only when expanded (lazy loading)
  - `.mdmeta` files are hidden, and other file types are hidden by default
  - sorting by name or by date modified
  - live updates from folder watching
- **4.4 File operations:**
  - new note, new folder, rename and move (each carries the `.mdmeta` with it)
  - Delete moves the note and its `.mdmeta` to the Recycle Bin
  - Show in File Explorer, Copy path
  - open tabs follow renames and moves
  - if a move would break relative image links, MDNote warns and offers to update them
- **4.5 Session:** each window's open folder is restored.

**Exit criteria:** the O13 and O14 "Done when" items.

---

### Phase 5: Styles and page (O3, O4, O7, O9, O19) → v0.5 — 🔄 built, hands-on test pending

**Goal:** Full control over typography and the page, saved in `.mdmeta` files.

**Status (2026-10-26):** all tasks below are implemented on `phase5/styles`.

Verified:
- **Automated:** 106 frontend tests (+20: the `.mdmeta` format, the style layers, the style sheet, style set files) and 31 Rust tests (+4: reading, writing, removing and backing up `.mdmeta` files; Windows' region settings).
- **Running the app** (scripted through the DevTools port):
  - Modify Style: the page changes while the dialog is open; OK, Undo and Redo; saving writes only the `.mdmeta`; Reset to Defaults removes it on save; reopening restores the styles
  - a broken `.mdmeta`: a notice, the defaults, and a `.bak` copy when the formatting is changed and saved
  - Ctrl+] and Ctrl+[ on a heading and on body text
  - style sets: the gallery, a set shown on hover and applied on click, Save as New Style Set
  - Page Setup (A4 landscape), Layout > Margins > Narrow, dragging a margin on the ruler, Undo from the page
  - Preferences > Documents: default styles and units followed by an open window
  - crash recovery and Move to New Window keep the formatting
  - the print style sheet, in the light and the dark theme, and the Korean UI

Hands-on checklist [docs/testing/phase-5.md](docs/testing/phase-5.md), first run (2026-10-27): 27 items pass, 4 fail. Fixes:
- **Colour (item 5):** the colour box relied on WebView2's own colour popup and stayed disabled until Automatic was cleared. Modify Style now has a colour menu like Word's. It and the font list float above the dialog, which had cut them off.
- **Font for Korean (item 6) and the comparison with Word (item 7):** measured in Word 365, a line holding Korean text is far taller than an English one (Segoe UI 12 pt at 1.5 lines: 24 pt for English, 31 pt with Korean in Malgun Gothic). Word measures fonts the GDI way, and East Asian fonts as 1.3 times their Windows ascent and descent (Malgun Gothic: 1.729, against 1.33 from DirectWrite); and it always sets Korean in the "Asian text" font. MDNote now does both: the font list reports Word's line heights (checked for ten fonts), and the render worker wraps Korean runs so they take the style's Korean font and line height.
- **Margins in cm (item 29):** values such as 2.54 cm were refused by the browser's check for multiples of the arrows' step; Page Setup and Modify Style no longer use it.

Still open: the rechecks R1–R4 in the checklist, and the suggestion from item 29 to show the printed pages in the preview (a decision for Objectives O9).

**What changed from the plan**
- **Word's line spacing is exact:** DirectWrite reports each font's single line height, and the page uses it. The built-in Body text uses 1.15 lines (about the earlier 1.5 times the font size).
- **Paragraph spacing adds up as in Word**, so the page and a Word export space paragraphs alike.
- **A style set replaces the user's defaults for that document**, and the document keeps a full copy of it, so it looks the same on any PC.
- **The Styles panel is a sidebar tab.** The **Design** menu holds the style commands and the **Layout** menu the page setup, as in Word's ribbon.
- **Page Setup has Set as Default**, and the Layout menu Word's quick Size, Orientation and Margins choices.
- **The built-in sets are defined in code** (`src/styles/sets.ts`), not in `resources/stylesets/`.
- **Ctrl+Z and Ctrl+Y work outside the editor**, for changes made on the page.
- **Fixed on the way:** printing with the theme "Same as Windows" while Windows was in dark mode printed a dark page (since Phase 2).
- **Known limitation:** after a tab moves to another window, Undo still reverts its text, but no longer its formatting changes from before the move (CodeMirror keeps only text changes when its history is moved).

**Tasks**
- **5.1 `.mdmeta` module (O7):**
  - schema version 1 with validation
  - merging and saving only the differences from defaults
  - preserving unknown fields
  - a `.bak` copy before replacing a broken file
  - creating and removing the file as defined in O7
  - Save As copies it
  - extensive unit tests
- **5.2 Font list (O3):**
  - DirectWrite, including per-user fonts
  - the picker shows names in the UI language, but `.mdmeta` stores the English family name, so the file works on any PC
  - fonts are flagged as monospaced or not
- **5.3 Font picker:**
  - a virtualized list that stays fast with hundreds of fonts
  - each name previewed in its own font
  - search, recently used fonts, monospaced filter
  - fonts that aren't installed are marked as such
- **5.4 Style model (O4):**
  - section types become CSS variables
  - Word's line-spacing options map onto CSS
  - fallback fonts (Malgun Gothic by default)
  - equation size and color
  - code highlighting theme
- **5.5 Styles UI:**
  - Styles panel and Modify Style dialog
  - right-click **Modify <style> style…** in the rendered view
  - Set as default and Reset
  - Ctrl+] / Ctrl+[
  - all of these can be undone
- **5.6 Style sets (O19):**
  - three built-in sets in `resources/stylesets/`
  - a gallery with live preview on hover
  - applying a set copies its styles into the `.mdmeta`
  - save, rename, delete, import, and export user sets
  - a default set in Preferences
- **5.7 Page setup (O9):**
  - dialog with paper sizes, orientation, Word's margin presets, custom values, and a thumbnail
  - the default paper size and units come from Windows regional settings
  - the rendered page uses the margins
  - a ruler with draggable margin markers
  - page break lines are shown in the rendered view
- **5.8 Preferences:** a **Documents** section with default styles, default set, page setup, and units.

**Exit criteria:** the "Done when" items of O3, O4, O9, and O19, and those of O7 that cover styles and page setup.

---

### Phase 6: Layout (O5, O6, O7, O16) → v0.6

**Goal:** Word-style mouse resizing of tables and images, saved reliably.

**Tasks**
- **6.1 Element matching (O7):**
  - tables are matched by position plus fingerprint, with the fallbacks described in O7
  - images are matched by path plus occurrence number
  - tests cover notes edited in other programs: a table inserted above, a header renamed, a table deleted
- **6.2 Table resizing (O5):**
  - border detection and a guide line
  - inner borders trade width between neighbors, and the outer border changes the table width
  - row heights act as minimums
  - double-click fits a column to its content
  - minimum sizes
  - Distribute and Reset in the right-click menu
- **6.3 Fit to page:** tables and images wider than the text column are scaled down for display. The saved values are kept.
- **6.4 Image resizing (O6):**
  - selection handles
  - corners keep the aspect ratio
  - Reset to original size
- **6.5 Undo:** every resize is one Undo step in the shared history (section 2.2).
- **6.6 Table tools and widths (O16):** inserting or deleting columns adjusts the saved widths.

**Exit criteria:** the O5 and O6 "Done when" items, and the O16 column-width item.

---

### Phase 7: Output (O10, O20) → v0.7

**Goal:** PDF and Word files that match the screen, and formatted copy and paste.

**Tasks**
- **7.1 Print style sheet:**
  - `@page` paper size and margins
  - page numbers and header in `@page` margin boxes
  - headings kept with the next paragraph
  - page breaks
  - light colors
- **7.2 PDF (Rust + WebView2):**
  - the note is rendered in a hidden window
  - DevTools `Page.printToPDF` produces the file, with bookmarks from headings
  - fonts are embedded automatically
  - the fallback is WebView2's standard `PrintToPdf` call, plus adding bookmarks afterward
- **7.3 DOCX:**
  - built from the Markdown syntax tree and the resolved styles
  - Word styles for Normal, Heading 1–6, Quote, and Code
  - page size and margins
  - tables with exact widths, "at least" row heights, and a repeated header row
  - images at their saved sizes
  - code with shading and highlight colors
  - lists, task lists, footnotes, links, page breaks, and a page-number field
  - equations through `docx/math`'s `latexToMath`, with a KaTeX-rendered image when a command isn't supported (spike 3)
- **7.4 Export dialog:**
  - options for page numbers and header
  - a progress indicator
  - **Open file** when finished
  - fully translated
- **7.5 Copy as rich text (O20):**
  - the selection is copied with the formatting written into the text itself
  - images are included and equations become images
  - both rich text and plain text go on the clipboard
- **7.6 Verification:**
  - automated snapshot tests of the generated Word XML
  - a manual checklist: open in Microsoft Word, edit an equation, paste into Word and Outlook, compare the PDF with the screen

**Exit criteria:** the O10 and O20 "Done when" items.

---

### Phase 8: Release (O1, O11) → v1.0

**Goal:** A signed, self-updating v1.0 on GitHub Releases.

**Tasks**
- **8.1 Icons:** app icon and `.md` file icon, in every Windows size.
- **8.2 Code signing:**
  - choose a provider (see section 7)
  - until then, test builds are unsigned and show a SmartScreen warning
- **8.3 Auto-update and release pipeline:**
  - the Tauri updater, fed from GitHub Releases
  - a GitHub Actions workflow builds, signs, and publishes the installer when a version tag is pushed
- **8.4 Korean review:**
  - a full pass by a native speaker
  - a glossary of terms (스타일, 서식, 페이지 설정, …) so wording stays consistent
- **8.5 Clean-install tests:**
  - fresh Windows 10 and Windows 11 installs
  - this PC runs Windows 11 Home, which has no Hyper-V or Windows Sandbox, so use VirtualBox, VMware Workstation, or a spare PC
- **8.6 Documentation:** README, user guide (English and Korean), CHANGELOG.

**Exit criteria:**
- every "Done when" item in O1–O20 passes
- v1.0.0 is published

---

## 4. Testing strategy

| Level | Tool | Covers |
|---|---|---|
| Unit (TypeScript) | Vitest | `.mdmeta` merge/save/matching, shortcut toggling, table alignment, unit conversion, word counts, style mapping |
| Unit (Rust) | `cargo test` | encoding detection and round-trips, safe save, path comparison, recovery files, locale lookups |
| Rendering | Vitest snapshots | CommonMark and GFM example suites, MDNote's own syntax test document |
| End-to-end | WebdriverIO + `tauri-driver` | open → edit → save, `.mdmeta` creation, session restore, tabs |
| Manual checklists (`docs/`) | People | Korean IME, file association, installer, Word and Outlook paste, opening DOCX files in Word, PDF comparison |

- Test files in `tests/fixtures/` are committed without line-ending conversion (see 0.2), so encoding tests use exact bytes.
- CI runs the unit, rendering, and Rust tests on every push. End-to-end tests run before each milestone tag.

---

## 5. Workflow

- **Branches:** one branch per task group (for example `phase1/file-io`), merged into `main` through a pull request so that CI runs before merging.
- **Commits:** Conventional Commits style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- **Versions:** `0.x` during development, one minor version per phase (see section 1), and `1.0.0` at release. Each milestone is tagged and gets a GitHub pre-release with the installer.
- **Documents:** Objectives.md is the source of truth for features and decisions. This plan tracks progress: tick off tasks as they are merged.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Tab tear-off between windows has no built-in support | Phase 3 slips | Spike 1 proved the design works. **Move to new window** in the right-click menu stays as a keyboard-friendly alternative. |
| Word export quality (equations, code colors) | Exports look wrong in Word | Spike 3 showed `docx/math` handles equations well. Image fallback for unsupported commands. The spike's 36 test equations become regression tests. Manual checks in Word for every milestone. |
| Screen (KaTeX) and Word (`docx/math`) parse LaTeX differently | An equation renders on screen but fails in Word | The image fallback covers it. Regression tests on both parsers. |
| PDF bookmarks depend on an experimental WebView2/Chromium option | No bookmarks | Spike 2 confirmed they work today. A CI check fails if a PDF has no outline. Fallback: add bookmarks after the PDF is created. |
| Scroll sync drifts with tall images and equations | Annoying, not blocking | Positions anchored to source lines, with interpolation. |
| Large notes slow down typing | Poor feel | Rendering in a worker, partial re-rendering, and a 1 MB performance test in CI. |
| Korean IME edge cases | Broken Korean input | Spike 5 passed all 7 checks. Keep its checklist as a manual test for every phase that touches the editor. |
| Matching `.mdmeta` sizes after outside edits | Sizes lost or misplaced | Cautious matching (drop rather than misapply) and tests on edited notes. |
| No Hyper-V or Sandbox on Windows 11 Home | Hard to test clean installs | VirtualBox, VMware Workstation, or a spare PC. |
| Code signing needs identity verification and a fee | Unsigned builds trigger SmartScreen warnings | Decide before Phase 8. Unsigned pre-releases until then. |

---

## 7. Decisions needed

**Settled**
- **License:** MIT (2026-10-15).
- **Toolchain:** installed by the user (2026-10-15).

**Before Phase 8**
1. **Code-signing provider:** Azure Trusted Signing is proposed. It is the cheapest option recognized by SmartScreen and requires identity verification.

The small defaults listed under "Open decisions" in Objectives.md (image folder, table alignment, Alt+Shift+↑/↓) are assumed as proposed.
