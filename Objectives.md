# MDNote: Implementation Objectives

> Status: draft, updated 2026-10-15

MDNote is a Windows desktop app for writing and reading Markdown notes. It renders standard Markdown and lets the user control the typography of each kind of content (headings, code, equations, and so on) and the size of tables and images. Formatting that Markdown cannot express is stored in a companion `.mdn` file next to each note. This keeps the `.md` file standard and portable.

- **Platform:** Windows 10 and 11 (x64) only
- **Planned stack:** Tauri 2 (Rust) + TypeScript/React + CodeMirror 6 + unified/remark (to be confirmed; see [Open decisions](#open-decisions))

---

## O1. Complete Windows program with `.md` file association

**Goal:** MDNote installs like a normal Windows app and opens `.md` files from File Explorer.

**Installation**
- Installer (NSIS, per-user, no admin rights needed) with a Start menu shortcut and a clean uninstaller.
- Registers MDNote as a handler for `.md` files (optionally also `.markdown`), with its own file icon.
- Windows 10/11 do not let an app silently make itself the default. MDNote appears under **Open with**. An in-app button, **Make MDNote the default for .md**, opens the Windows Default Apps page (`ms-settings:defaultapps`), where the user confirms the choice.
- Uninstalling removes the file association and all registry entries.

**Opening files**
- `MDNote.exe "C:\path\note.md"` opens that file. This is the command Explorer runs on double-click.
- Single instance: if MDNote is already running, the file opens as a new tab in the most recently used MDNote window, and that window comes to the front.
- If the file is already open, MDNote switches to its existing tab instead of opening it again. This also stops two tabs from saving conflicting versions of the same `.md` and `.mdn`.
- Files can also be opened with **File > Open** (Ctrl+O), by dragging them onto the window, or from the recent files list.

**Tabs and windows** (similar to MarkText)
- Each open file is a tab. A tab shows the file name and an unsaved-changes marker, and its tooltip shows the full path.
- Tabs can be reordered by dragging. Middle-click or Ctrl+W closes a tab.
- Dragging a tab out of the tab bar moves it into a new window. The tab's right-click menu also has **Move to new window**.
- Dragging a tab onto another MDNote window's tab bar moves it into that window.
- Each window has its own tabs, split-view layout, and scroll positions.
- Closing a window that has unsaved tabs asks **Save / Don't Save / Cancel** for each unsaved document.

**Document lifecycle**
- New, Open, Save, Save As, Close, Exit.
- The title bar shows the active tab's file name and an unsaved-changes marker.
- Closing a tab with unsaved changes asks **Save / Don't Save / Cancel**, as Word does.
- If the file changes on disk while it is open (for example, edited in another app), MDNote offers to reload it.
- Saves are written to a temporary file that then replaces the original, so a crash never leaves a half-written note.

**Text encoding**
- Reads UTF-8 (with or without BOM) and UTF-16 (with BOM). Other files fall back to the system ANSI code page, with a notice.
- Saving keeps the file's original encoding and line endings (CRLF or LF).

**App behavior**
- Remembers window size, position, and the last session's state.
- Follows the Windows light/dark mode setting.

**Done when**
- After installation, double-clicking a `.md` file in Explorer (with MDNote chosen as the handler) opens and renders it.
- Double-clicking a second `.md` file opens it as a new tab in the instance that is already running.
- Dragging a tab out of the tab bar opens it in a new window, and dragging it onto another window's tab bar moves it there.
- Uninstalling leaves no association or registry entries behind.

---

## O2. Markdown rendering and editing

**Goal:** Render standard Markdown accurately and let the user edit it.

**Layout (v1: split view)**
- The source editor is on the left and the rendered view is on the right, separated by a divider that can be dragged.
- The two panes scroll together.
- The **View** menu switches between **Split** (default), **Source only**, and **Preview only**.
- Formatting shortcuts (O8) work in the source editor. In v1 you cannot type in the rendered pane. There you can resize tables and images (O5, O6), open style menus (O4), and follow links.
- **Live preview** is planned as an extra option in the **View** menu after v1. It is Obsidian-style: a single pane where Markdown syntax is hidden except on the line being edited.

**Supported syntax**
- **CommonMark:** headings, paragraphs, emphasis, lists, blockquotes, inline code, fenced code blocks, links, images, horizontal rules, line breaks.
- **GitHub Flavored Markdown:** tables, task lists (`- [ ]`), strikethrough, autolinks, footnotes.
- **Math:** `$inline$` and `$$block$$` equations (KaTeX).
- **Code blocks:** syntax highlighting for common languages.
- **Raw HTML:** only a sanitized, safe subset is rendered. Scripts never run.

**Behavior**
- Relative image paths are resolved from the folder that contains the `.md` file.
- Web links open in the default browser. Links to other `.md` files open in MDNote.
- The rendered view updates while typing, with no noticeable lag for documents up to about 1 MB.
- **Print** (Ctrl+P) uses the current styles. Printing to PDF uses the built-in *Microsoft Print to PDF*.

**Done when**
- A test document that uses every syntax item above renders correctly.
- Editing that document updates the rendered view immediately.
- Dragging the divider resizes both panes, and they stay in sync when scrolling.

---

## O3. Font selection from system fonts

**Goal:** The user can pick any font installed on the PC for any section type.

- Lists every installed font, read through DirectWrite. This includes fonts installed for the current user only, not just system-wide ones.
- Font picker:
  - search box
  - each font name shown in its own typeface
  - recently used fonts at the top
  - a "monospaced only" filter (useful for code)
- Each style can have an optional fallback font for characters the main font doesn't contain (for example CJK text). This works like Word's separate "Asian text" font.
- **Missing fonts:** a `.mdn` file may name a font that isn't installed on this PC. In that case:
  - that style uses the default font
  - the picker shows the name marked as *not installed*
  - the stored font name is kept, so the note looks correct again on a PC that has the font
- A **Refresh** button reloads the font list after new fonts are installed.

**Done when**
- A font installed for the current user only shows up in the picker.
- Selecting a font changes the rendered text immediately.

---

## O4. Per-section formatting (styles)

**Goal:** Each kind of content has its own style, like Word's Styles (Normal, Heading 1, ...).

**Section types with their own style**
- **Body text** (paragraphs): the base style. Other styles inherit any value they don't set.
- **Headings 1–6:** each level has its own style.
- **Blockquote**
- **Lists:** bulleted, numbered, and task lists.
- **Inline code**
- **Code block:** also has a syntax-highlighting color theme.
- **Equations** (inline and block): only size, color, and spacing can be changed. KaTeX uses its own math fonts, so the math font family cannot be changed freely.
- **Table header cells** and **table body cells**
- **Links:** color and underline.
- **Footnotes**

**Properties of each style**
- Font family, plus an optional fallback font (O3)
- Font size, in points (pt), as in Word
- Bold and italic
- Text color
- Line spacing, with Word's options: Single, 1.15, 1.5, Double, Multiple (custom value), Exactly (pt)
- Spacing before and after, in pt
- Alignment (left, center, right, justify) for paragraphs and headings

**Document-level layout**
- Content width (the width of the text column)

**Where settings come from** (later items override earlier ones)
1. **Built-in defaults**, for example Segoe UI 12 pt with 1.5 line spacing, and code in Consolas 10.5 pt.
2. **User defaults**: the user's own defaults, stored in the app settings under `%APPDATA%`.
3. **Document settings**: read from the note's `.mdn` file (O7).

**UI**
- A **Styles** panel lists all section types. Editing a style updates the rendered view live.
- Right-clicking any element in the rendered view offers **Modify <style> style…** (for example, right-clicking a heading offers *Modify Heading 2 style…*).
- **Set as default** saves the current document's styles as the user defaults. This is the equivalent of Word's "New documents based on this template".
- **Reset to defaults** removes the document's own style settings.

**Done when**
- Changing the Heading 2 font, size, and line spacing immediately restyles every H2 in the document.
- The change is still there after closing and reopening the file.
- The `.md` file is not modified by the style change.

---

## O5. Table resizing by mouse drag (Word-style)

**Goal:** Resize table columns and rows by dragging borders with the mouse, as in Microsoft Word.

- Hovering over a cell border changes the mouse cursor to a resize cursor.
- **Inner column border:** dragging moves width between the two neighboring columns. The total table width stays the same.
- **Right outer border:** dragging changes the last column's width, and therefore the table's width. A table can be at most 100% of the content width.
- **Row border:** dragging a row's bottom border sets that row's height. As in Word, this is a *minimum* height: the row still grows if its content needs more room.
- A dashed guide line follows the mouse while dragging.
- Double-clicking a column border fits the column to its content.
- Minimum column width and row height stop cells from collapsing to nothing.
- The table's right-click menu has **Distribute columns evenly**, **Distribute rows evenly**, and **Reset table size**.
- Every resize can be undone (Ctrl+Z) and marks the document as unsaved.
- **Units:** column widths are saved as percentages of the table width, and the table width as a percentage of the content width. Tables therefore scale with the window.
- Row heights are saved in pixels (proposed). A height has no sensible base for a percentage.
- If the window becomes too narrow for the minimum column widths, the table scrolls sideways instead of squeezing the cells further.
- Sizes are saved only in the `.mdn` file (O7). The Markdown table text is never changed.

**Done when**
- After resizing columns and rows, saving, closing, and reopening, the table looks the same.
- Resizing the window scales the table's columns proportionally.
- The `.md` file is byte-for-byte unchanged.

---

## O6. Image resizing

**Goal:** Let the user set image sizes with the mouse. Image sizes are part of the metadata requirement (O7), so the user needs a way to set them.

- Clicking an image selects it and shows resize handles.
- Corner handles keep the aspect ratio. Side handles stretch one dimension only. This matches Word.
- The image's right-click menu has **Reset to original size**.
- By default, an image shows at its natural size, but never wider than the content area.
- **Units (proposed):** the width is saved as a percentage of the content width, so images scale with the window like tables do.
- The height follows the image's aspect ratio. If a side handle stretched the image, the stretched ratio is saved instead.
- Resizing can be undone, marks the document as unsaved, and is saved only in the `.mdn` file.

**Done when**
- A resized image keeps its size after saving and reopening.
- The `.md` file is unchanged.

---

## O7. Metadata file (`.mdn`)

**Goal:** Store everything Markdown cannot express in a separate file, so the `.md` stays clean, standard Markdown that any editor can open. This includes per-section styles, table column widths and row heights, image sizes, and document layout.

**Location and name**
- The `.mdn` file sits in the same folder as the `.md` file and has the same name without the `.md` extension: `<md file name>.mdn`.
- Example: `C:\Notes\Meeting.md` → `C:\Notes\Meeting.mdn`

**Opening a note**
1. Read `Meeting.md`.
2. Check for `Meeting.mdn` in the same folder.
3. **Found and valid:** apply its settings on top of the defaults (see the order in O4).
4. **Not found:** render with the default settings.
5. **Found but unreadable or invalid:** render with the defaults and show a notice that doesn't block work. Never overwrite the broken file silently: before the next save, copy it to `Meeting.mdn.bak`.

**Saving**
- The `.mdn` is saved together with the `.md` when the user saves (Ctrl+S). Layout-only changes, such as resizing a table, mark the document unsaved just like text edits do.
- Only files that actually changed are written.
- An `.mdn` file is created only when the note has settings that differ from the defaults. Opening and saving a plain note leaves no extra file behind.
- Only values that differ from the defaults are stored, which keeps the file small.
- If every setting is back at its default, the existing `.mdn` is removed on save.
- Save As also writes the `.mdn` file under the new name.

**Format**
- JSON (UTF-8), readable by people, with a `version` number so the format can change later.
- Fields MDNote doesn't recognize (for example, ones written by a newer version) are kept when saving.

```json
{
  "version": 1,
  "document": { "contentWidth": 800 },
  "styles": {
    "body":      { "fontSize": 13,
                   "lineSpacing": { "rule": "multiple", "value": 1.6 } },
    "heading2":  { "fontFamily": "Georgia", "fontSize": 18, "bold": true,
                   "spaceBefore": 12, "spaceAfter": 6 },
    "codeBlock": { "fontFamily": "Consolas", "fontSize": 10.5,
                   "lineSpacing": { "rule": "exactly", "value": 15 } }
  },
  "tables": [
    { "index": 0,
      "match": { "columns": 3, "header": ["Name", "Type", "Notes"] },
      "width": 100,
      "columnWidths": [25, 20, 55],
      "rowHeights": [32, null, null] }
  ],
  "images": [
    { "src": "images/diagram.png", "occurrence": 0, "width": 60 }
  ]
}
```

*Units:*
- Font sizes and spacing are in pt.
- `contentWidth` and `rowHeights` are in px (1/96 inch at 100% zoom).
- A table's `width` is a percentage of the content width.
- `columnWidths` are percentages of the table width and add up to 100.
- An image's `width` is a percentage of the content width (proposed).
- `null` means automatic.
- Row 0 is the header row.

**Matching saved sizes to tables and images**

The `.md` file may be edited in other programs, so saved table and image sizes must still find the right element after such edits:
- **Tables** are identified by their position (1st, 2nd, ... table in the document) plus a fingerprint: the column count and the header row text. If the table at the saved position no longer matches, MDNote looks for a table with the same fingerprint elsewhere in the document. If none matches, the saved entry is ignored and the table uses default sizing.
- **Images** are identified by their path plus an occurrence number, which handles the same image appearing more than once.
- **Rule:** it is better to drop a saved size than to apply it to the wrong table.
- Entries that no longer match anything are removed on the next save.

**Known limitation:** if a `.md` file is renamed or moved outside MDNote, its `.mdn` does not follow it, and the note opens with defaults. Renaming the `.mdn` to match restores the formatting.

**Done when**
- Opening a note that has no `.mdn` uses the defaults and creates no file.
- Changing a style and saving creates `<name>.mdn`, and reopening the note restores every setting.
- A deliberately broken `.mdn` does not crash the app.

---

## O8. Word-style keyboard shortcuts

**Goal:** Common editing and formatting shortcuts work the way they do in Microsoft Word. Each one inserts or removes the matching Markdown syntax.

**Behavior rules**
- **Formatting shortcuts toggle.** For example, Ctrl+B on bold text removes the bold markers.
- **No selection:** if the cursor is inside a word, the shortcut applies to that whole word, as in Word. Otherwise it inserts the markers and places the cursor between them.
- Shortcuts do not fire while an IME is composing text (for example, during Korean or Japanese input).
- Every shortcut is shown next to its menu item and in tooltips. F1 opens the full list of shortcuts.

The **Source** column shows whether a shortcut matches Word's default ("Word") or is a new proposal because Word has no default for it ("Proposed").

**File**

| Action | Shortcut | Source |
|---|---|---|
| New | Ctrl+N | Word |
| Open | Ctrl+O | Word |
| Save (`.md` and `.mdn`) | Ctrl+S | Word |
| Save As | F12, Ctrl+Shift+S | Word / Proposed |
| Print | Ctrl+P | Word |
| Close tab | Ctrl+W | Word (closes the document) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Proposed |

**Edit**

| Action | Shortcut | Source |
|---|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y | Word |
| Cut / Copy / Paste | Ctrl+X / Ctrl+C / Ctrl+V | Word |
| Select all | Ctrl+A | Word |
| Find / Replace | Ctrl+F / Ctrl+H | Word |
| Go to line | Ctrl+G | Word (Go To) |

**Text formatting**

| Action | Shortcut | Markdown result | Source |
|---|---|---|---|
| Bold | Ctrl+B | `**text**` | Word |
| Italic | Ctrl+I | `*text*` | Word |
| Underline | Ctrl+U | `<u>text</u>` (Markdown has no underline) | Word |
| Strikethrough | Ctrl+Shift+X | `~~text~~` | Proposed |
| Inline code | Ctrl+` | `` `text` `` | Proposed |
| Insert link | Ctrl+K | `[text](url)` | Word |
| Insert equation | Alt+= | `$…$` inside a line, `$$` block on an empty line | Word |

**Paragraphs and blocks**

| Action | Shortcut | Markdown result | Source |
|---|---|---|---|
| Heading 1 / 2 / 3 | Ctrl+Alt+1 / 2 / 3 | `#` / `##` / `###` | Word |
| Heading 4 / 5 / 6 | Ctrl+Alt+4 / 5 / 6 | `####` / `#####` / `######` | Proposed |
| Normal paragraph | Ctrl+Shift+N | removes heading, list, or quote markers | Word |
| Bulleted list | Ctrl+Shift+L | `- ` | Word |
| Numbered list | Ctrl+Shift+7 | `1. ` | Proposed |
| Blockquote | Ctrl+Shift+Q | `> ` | Proposed |
| Code block | Ctrl+Shift+` | <code>```</code> fence | Proposed |
| Indent / outdent list item | Tab / Shift+Tab | changes list level | Word |
| Next / previous table cell | Tab / Shift+Tab (in a table) | moves the cursor | Word |

**View and styles**

| Action | Shortcut | Source |
|---|---|---|
| Bigger / smaller font for the current section type | Ctrl+] / Ctrl+[ | Word (per selection there; per section type here, since Markdown cannot store sizes for individual words) |
| Zoom | Ctrl+mouse wheel | Word |
| Shortcut list | F1 | Proposed |

**Done when**
- Every shortcut in the tables above works as described.
- Pressing a formatting shortcut a second time undoes it.
- Typing with an IME never triggers a shortcut by accident.

---

## Roadmap

| Phase | Scope | Objectives |
|---|---|---|
| 1. Foundation | Tauri project, tabs, open/save, encoding, file path from the command line, single instance, installer with `.md` association | O1 |
| 2. Rendering | Split view with synced scrolling, full syntax, code highlighting, math, images, HTML sanitization | O2 |
| 3. Editing | Editor, Word-style shortcuts, detaching tabs into windows | O1, O2, O8 |
| 4. Styles | Font list, styles panel, user defaults, `.mdn` load/save | O3, O4, O7 |
| 5. Layout | Table and image resizing, saved in `.mdn` | O5, O6, O7 |
| 6. Release | Code signing, auto-update, icons, installer tests on clean Windows 10/11 | O1 |
| 7. After v1 | Live preview mode as a **View** menu option | O2 |

---

## Decisions

| Date | Topic | Decision |
|---|---|---|
| 2026-10-14 | Platform | Windows 10 and 11 only. |
| 2026-10-15 | Editing model | Split view for v1. Live preview is added later as a **View** menu option. |
| 2026-10-15 | Multiple documents | Tabs by default. Tabs can be detached into separate windows, similar to MarkText. |
| 2026-10-15 | Table size units | Percentages: column widths relative to the table width, table width relative to the content width. |
| 2026-10-15 | `.mdn` visibility | `.mdn` files are not hidden in File Explorer. |

## Open decisions

**Needed before Phase 1**
1. **Tech stack:** Tauri 2 + React/TypeScript (recommended), or C#/.NET + WebView2.
2. **App identifier and publisher name**, for example `com.<yourname>.mdnote`. These are used by:
   - the installer
   - the file-association registry entries
   - the settings folder (`%APPDATA%\<identifier>`)
   - code signing, later

   Changing the identifier after release moves every user's settings to a new folder.
3. **UI language(s):** English only, or several languages? If there will be more than one, set up translation support from the start, because adding it later means touching every UI string.

**Can wait until the phase that needs them**

4. **Underline** (Phase 3): Ctrl+U writes `<u>…</u>` HTML tags (proposed), or Ctrl+U is disabled.
5. **Proposed shortcuts** (Phase 3): confirm or change the shortcuts marked "Proposed" in O8.
6. **Saving and crash recovery** (Phase 3). Proposed: work like Word. The user saves manually, and MDNote keeps recovery copies of unsaved changes in `%APPDATA%` and offers to restore them after a crash. The alternative is auto-saving straight to the file.
7. **Session restore** (Phase 3). Proposed: on startup, reopen the tabs and windows from the last session, with a setting to turn this off.
8. **Row height units** (Phase 5): pixels (proposed), because a height has no sensible base for a percentage.
9. **Image size units** (Phase 5): width as a percentage of the content width, keeping the aspect ratio (proposed). This matches tables.

## Out of scope (for now)

- macOS and Linux
- Cloud sync and collaboration
- Plugins
- Custom shortcut mapping
- Storing any formatting inside the `.md` file
- Formatting individual words or passages (for example, one red word). Styles apply to whole section types only.
