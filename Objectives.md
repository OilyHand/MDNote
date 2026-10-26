# MDNote: Implementation Objectives

> Status: draft, updated 2026-10-15

MDNote is a Windows desktop app for writing and reading Markdown notes. It renders standard Markdown and lets the user control the typography of each kind of content (headings, code, equations, and so on), the page layout, and the size of tables and images. Notes can be exported to PDF and Word (`.docx`). Formatting that Markdown cannot express is stored in a companion `.mdmeta` file next to each note. This keeps the `.md` file standard and portable.

- **Platform:** Windows 10 and 11 (x64) only
- **App identifier:** `io.github.oilyhand.mdnote`
- **Publisher:** `oilyhand`
- **UI languages:** English and Korean

**Tech stack**

| Area | Choice |
|---|---|
| App shell | Tauri 2 (Rust) on WebView2 |
| UI | TypeScript + React + Vite |
| Source editor | CodeMirror 6 |
| Markdown rendering | unified (remark / rehype), KaTeX for math, Shiki for code highlighting |
| UI translations | i18next |
| PDF export | WebView2's built-in PDF engine |
| DOCX export | `docx` library, building the document from the Markdown syntax tree |
| System fonts | DirectWrite, through the `windows` crate |

**Objectives**

| # | Objective | # | Objective |
|---|---|---|---|
| O1 | Windows program with `.md` file association | O11 | UI languages (English and Korean) |
| O2 | Markdown rendering and editing | O12 | Preferences |
| O3 | Font selection from system fonts | O13 | Outline panel |
| O4 | Per-section formatting (styles) | O14 | Folder sidebar |
| O5 | Table resizing by mouse drag | O15 | Images by paste or drag-and-drop |
| O6 | Image resizing | O16 | Table tools |
| O7 | Metadata file (`.mdmeta`) | O17 | Editor conveniences |
| O8 | Word-style keyboard shortcuts | O18 | Status bar |
| O9 | Page setup | O19 | Style sets |
| O10 | Export to PDF and Word | O20 | Copy as rich text |

Features planned for after the essential implementation are listed under [After v1](#after-v1).

---

## O1. Complete Windows program with `.md` file association

**Goal:** MDNote installs like a normal Windows app and opens `.md` files from File Explorer.

**Installation**
- Installer (NSIS, per-user, no admin rights needed) in English and Korean, with a Start menu shortcut and a clean uninstaller.
- The publisher is shown as `oilyhand` in the installer and in the Windows **Installed apps** list.
- Registers MDNote (`io.github.oilyhand.mdnote`) as a handler for `.md` files (optionally also `.markdown`), with its own file icon.
- Windows 10/11 do not let an app silently make itself the default. MDNote appears under **Open with**. An in-app button, **Make MDNote the default for .md**, opens the Windows Default Apps page (`ms-settings:defaultapps`), where the user confirms the choice.
- Uninstalling removes the file association and all registry entries.

**Opening files**
- `MDNote.exe "C:\path\note.md"` opens that file. This is the command Explorer runs on double-click.
- Single instance: if MDNote is already running, the file opens as a new tab in the most recently used MDNote window, and that window comes to the front.
- If the file is already open, MDNote switches to its existing tab instead of opening it again. This also stops two tabs from saving conflicting versions of the same `.md` and `.mdmeta`.
- Files can also be opened with **File > Open** (Ctrl+O), from the folder sidebar (O14), by dragging them onto the window, or from the recent files list.

**Tabs and windows** (similar to MarkText)
- Each open file is a tab. A tab shows the file name and an unsaved-changes marker, and its tooltip shows the full path.
- Tabs can be reordered by dragging. Middle-click or Ctrl+W closes a tab.
- Dragging a tab out of the tab bar moves it into a new window. The tab's right-click menu also has **Move to new window**.
- Dragging a tab onto another MDNote window's tab bar moves it into that window.
- Each window has its own tabs, sidebar folder, split-view layout, and scroll positions.
- Closing a window that has unsaved tabs asks **Save / Don't Save / Cancel** for each unsaved document.

**Document lifecycle**
- New, Open, Save, Save As, Close, Exit.
- The title bar shows the active tab's file name and an unsaved-changes marker.
- Closing a tab with unsaved changes asks **Save / Don't Save / Cancel**, as Word does.
- If the file changes on disk while it is open (for example, edited in another app), MDNote offers to reload it.
- Saves are written to a temporary file that then replaces the original, so a crash never leaves a half-written note.

**Saving and crash recovery**
- Saving is manual (Ctrl+S), as in Word. MDNote never writes to the user's `.md` or `.mdmeta` files on its own.
- While a document has unsaved changes, MDNote keeps a recovery copy in `%APPDATA%\io.github.oilyhand.mdnote\recovery\`. The copy is updated shortly after typing pauses.
- If MDNote closes unexpectedly, the next start offers to restore the unsaved changes.
- Recovery copies are deleted when the document is saved, or closed without saving.

**Session restore**
- On startup, MDNote reopens the windows and tabs from the last session. This includes window positions, the active tab, scroll positions, and the folder open in each window's sidebar.
- This is on by default and can be turned off in Preferences (O12).
- Files that were moved or deleted since the last session are skipped, with a notice.
- If MDNote is started by opening a file from Explorer, the previous session is restored first, and the new file opens as the active tab.
- **File > Exit** closes every window, and the next start restores them all. Windows closed together (for example with the taskbar's **Close all windows**) come back together too. A window closed earlier, while others stayed open, does not.

**Text encoding**
- Reads UTF-8 (with or without BOM) and UTF-16 (with BOM). Other files fall back to the system ANSI code page, with a notice.
- Saving keeps the file's original encoding and line endings (CRLF or LF), unless the user changes them from the status bar (O18).

**App behavior**
- Remembers window size and position.
- Follows the Windows light/dark mode setting, unless a theme is chosen in Preferences (O12).

**Done when**
- After installation, double-clicking a `.md` file in Explorer (with MDNote chosen as the handler) opens and renders it.
- Double-clicking a second `.md` file opens it as a new tab in the instance that is already running.
- Dragging a tab out of the tab bar opens it in a new window, and dragging it onto another window's tab bar moves it there.
- With session restore on, restarting MDNote reopens the previous windows and tabs. With it off, MDNote starts with one empty window.
- After MDNote is force-closed with unsaved changes, the next start offers to restore them.
- Uninstalling leaves no association or registry entries behind.

---

## O2. Markdown rendering and editing

**Goal:** Render standard Markdown accurately and let the user edit it.

**Layout (v1: split view)**
- From left to right, the window shows:
  - the sidebar, with **Files** and **Outline** tabs (O13, O14), which can be hidden
  - the source editor
  - the rendered view
- Dividers between the areas can be dragged.
- The source editor and the rendered view scroll together.
- The rendered view shows the document on a page with the width and margins set in Page Setup (O9), like Word's page layout.
- If the window is narrower than the page, the rendered view scrolls sideways. **View > Zoom** offers 50–200% and **Fit page width**.
- The **View** menu switches between **Split** (default), **Source only**, and **Preview only**.
- Formatting shortcuts (O8) work in the source editor. In v1 you cannot type in the rendered pane. There you can:
  - resize tables and images (O5, O6)
  - open style menus (O4)
  - follow links
  - copy text with its formatting (O20)
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
- **Print** (Ctrl+P) uses the current styles and page setup. To make a PDF file, use **Export > PDF** (O10).

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
- Each style can have an optional fallback font for characters the main font doesn't contain (for example Korean text). This works like Word's separate "Asian text" font.
- **Missing fonts:** a `.mdmeta` file may name a font that isn't installed on this PC. In that case:
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

**Page layout**
- Paper size and margins are set for each document in Page Setup (O9). The width of the text column is the page width minus the left and right margins.

**Where settings come from** (later items override earlier ones)
1. **Built-in defaults:** for example Segoe UI 12 pt with Malgun Gothic as the fallback for Korean text, 1.5 line spacing, and code in Consolas 10.5 pt.
2. **User defaults:** the user's own defaults, set in Preferences (O12) and stored in `%APPDATA%\io.github.oilyhand.mdnote\`.
3. **Document settings:** read from the note's `.mdmeta` file (O7).

**UI**
- A **Styles** panel lists all section types. Editing a style updates the rendered view live.
- Right-clicking any element in the rendered view offers **Modify <style> style…** (for example, right-clicking a heading offers *Modify Heading 2 style…*).
- **Style sets** (O19) apply a whole collection of styles at once.
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
- **Right outer border:** dragging changes the last column's width, and therefore the table's width. A table can be no wider than the text column (page width minus margins).
- **Row border:** dragging a row's bottom border sets that row's height. As in Word, this is a *minimum* height: the row still grows if its content needs more room.
- A dashed guide line follows the mouse while dragging.
- Double-clicking a column border fits the column to its content.
- Minimum column width and row height stop cells from collapsing to nothing.
- The table's right-click menu has **Distribute columns evenly**, **Distribute rows evenly**, and **Reset table size**.
- Every resize can be undone (Ctrl+Z) and marks the document as unsaved.
- **Units:** column widths and row heights are saved in pixels (px). At 96 px per inch, they convert exactly to page measurements for PDF and Word export.
- The page has a fixed width (O9), so resizing the window does not change table sizes.
- If the page is later made narrower than a table, the table is scaled down proportionally to fit, both on screen and in exports. The saved sizes are kept, so widening the page again restores the original size.
- Sizes are saved only in the `.mdmeta` file (O7). The Markdown table text is never changed.

**Done when**
- After resizing columns and rows, saving, closing, and reopening, the table looks the same.
- Resizing the window does not change the table.
- PDF and DOCX exports show the same column widths and row heights.
- The `.md` file is byte-for-byte unchanged.

---

## O6. Image resizing

**Goal:** Let the user set image sizes with the mouse. Image sizes are part of the metadata requirement (O7), so the user needs a way to set them.

- Clicking an image selects it and shows resize handles.
- Corner handles keep the aspect ratio. Side handles stretch one dimension only. This matches Word.
- The image's right-click menu has **Reset to original size**.
- By default, an image shows at its natural size, but never wider than the text column.
- **Units:** width and height are saved in pixels (px).
- If the page is later made narrower than an image, the image is scaled down proportionally to fit, both on screen and in exports. The saved size is kept.
- Resizing can be undone, marks the document as unsaved, and is saved only in the `.mdmeta` file.

**Done when**
- A resized image keeps its size after saving and reopening.
- PDF and DOCX exports show the image at the same size.
- The `.md` file is unchanged.

---

## O7. Metadata file (`.mdmeta`)

**Goal:** Store everything Markdown cannot express in a separate file, so the `.md` stays clean, standard Markdown that any editor can open. This includes per-section styles, page setup, table column widths and row heights, and image sizes.

**Location and name**
- The `.mdmeta` file sits in the same folder as the `.md` file and has the same name without the `.md` extension: `<md file name>.mdmeta`.
- Example: `C:\Notes\Meeting.md` → `C:\Notes\Meeting.mdmeta`

**Opening a note**
1. Read `Meeting.md`.
2. Check for `Meeting.mdmeta` in the same folder.
3. **Found and valid:** apply its settings on top of the defaults (see the order in O4).
4. **Not found:** render with the default settings.
5. **Found but unreadable or invalid:** render with the defaults and show a notice that doesn't block work. Never overwrite the broken file silently: before the next save, copy it to `Meeting.mdmeta.bak`.

**Saving**
- The `.mdmeta` is saved together with the `.md` when the user saves (Ctrl+S). Layout-only changes, such as resizing a table, mark the document unsaved just like text edits do.
- Only files that actually changed are written.
- An `.mdmeta` file is created only when the note has settings that differ from the defaults. Opening and saving a plain note leaves no extra file behind.
- Only values that differ from the defaults are stored, which keeps the file small.
- If every setting is back at its default, the existing `.mdmeta` is removed on save.
- Save As also writes the `.mdmeta` file under the new name.

**Format**
- JSON (UTF-8), readable by people, with a `version` number so the format can change later.
- Fields MDNote doesn't recognize (for example, ones written by a newer version) are kept when saving.

```json
{
  "version": 1,
  "page": {
    "size": "A4",
    "orientation": "portrait",
    "margins": { "top": 25.4, "bottom": 25.4, "left": 19.1, "right": 19.1 }
  },
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
      "columnWidths": [160, 120, 320],
      "rowHeights": [32, null, null] }
  ],
  "images": [
    { "src": "assets/diagram.png", "occurrence": 0, "width": 480, "height": 270 }
  ]
}
```

*Units:*
- Page margins are in mm. A custom paper size is saved as `"size": "custom"` with `width` and `height` in mm.
- Font sizes and spacing are in pt.
- Table column widths, row heights, and image sizes are in px (96 px = 1 inch).
- `null` means automatic.
- Row 0 is the header row.

**Matching saved sizes to tables and images**

The `.md` file may be edited in other programs, so saved table and image sizes must still find the right element after such edits:
- **Tables** are identified by their position (1st, 2nd, ... table in the document) plus a fingerprint: the column count and the header row text. If the table at the saved position no longer matches, MDNote looks for a table with the same fingerprint elsewhere in the document. If none matches, the saved entry is ignored and the table uses default sizing.
- **Images** are identified by their path plus an occurrence number, which handles the same image appearing more than once.
- **Rule:** it is better to drop a saved size than to apply it to the wrong table.
- Entries that no longer match anything are removed on the next save.
- Table tools (O16) keep the saved sizes in step when columns are inserted or deleted inside MDNote.

**Renaming and moving notes**
- Renaming or moving a note in the folder sidebar (O14) renames or moves its `.mdmeta` along with it.
- **Known limitation:** if a note is renamed or moved outside MDNote (for example in File Explorer), its `.mdmeta` stays behind, and the note opens with defaults. Renaming the `.mdmeta` to match restores the formatting.

**Done when**
- Opening a note that has no `.mdmeta` uses the defaults and creates no file.
- Changing a style and saving creates `<name>.mdmeta`, and reopening the note restores every setting.
- A deliberately broken `.mdmeta` does not crash the app.

---

## O8. Word-style keyboard shortcuts

**Goal:** Common editing and formatting shortcuts work the way they do in Microsoft Word. Each one inserts or removes the matching Markdown syntax.

**Behavior rules**
- **Formatting shortcuts toggle.** For example, Ctrl+B on bold text removes the bold markers.
- **No selection:** if the cursor is inside a word, the shortcut applies to that whole word, as in Word. Otherwise it inserts the markers and places the cursor between them.
- Keys typed into an IME never trigger shortcuts. A Ctrl or Alt shortcut pressed while a syllable is still being composed (for example, right after typing Korean) first finishes the syllable, then runs, as in Word.
- Every shortcut is shown next to its menu item and in tooltips. F1 opens the full list of shortcuts.

The **Source** column shows whether a shortcut is Word's default ("Word") or MDNote's own choice where Word has none ("MDNote").

**File**

| Action | Shortcut | Source |
|---|---|---|
| New | Ctrl+N | Word |
| Open | Ctrl+O | Word |
| Open Folder | Ctrl+Shift+O | MDNote |
| Save (`.md` and `.mdmeta`) | Ctrl+S | Word |
| Save As | F12, Ctrl+Shift+S | Word / MDNote |
| Print | Ctrl+P | Word |
| Close tab | Ctrl+W | Word (closes the document) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | MDNote |
| Preferences | Ctrl+, | MDNote |

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
| Strikethrough | Ctrl+Shift+X | `~~text~~` | MDNote |
| Inline code | Ctrl+` | `` `text` `` | MDNote |
| Insert link | Ctrl+K | `[text](url)` | Word |
| Remove link | Ctrl+Shift+F9 | keeps the link's text, removes `[ ](url)` | Word (Unlink) |
| Insert equation | Alt+=, Ctrl+Shift+M | `$…$` inside a line, `$$` block on an empty line | Word / MDNote (Typora's math key, for when an IME keeps Alt+=) |

**Paragraphs and blocks**

| Action | Shortcut | Markdown result | Source |
|---|---|---|---|
| Heading 1 / 2 / 3 | Ctrl+Alt+1 / 2 / 3 | `#` / `##` / `###` | Word |
| Heading 4 / 5 / 6 | Ctrl+Alt+4 / 5 / 6 | `####` / `#####` / `######` | MDNote |
| Normal paragraph | Ctrl+Shift+N | removes heading, list, or quote markers | Word |
| Bulleted list | Ctrl+Shift+L | `- ` | Word |
| Numbered list | Ctrl+Shift+7 | `1. ` | MDNote |
| Blockquote | Ctrl+Shift+Q | `> ` | MDNote |
| Code block | Ctrl+Shift+` | <code>```</code> fence | MDNote |
| Page break | Ctrl+Enter | `<!-- pagebreak -->` line (O9) | Word |
| Move line or paragraph up / down | Alt+Shift+↑ / Alt+Shift+↓ | moves the current line, or the selected lines (O17) | Word |
| Indent / outdent list item | Tab / Shift+Tab | changes list level | Word |
| Next / previous table cell | Tab / Shift+Tab (in a table) | moves the cursor; Tab in the last cell adds a row (O16) | Word |

**View and styles**

| Action | Shortcut | Source |
|---|---|---|
| Bigger / smaller font for the current section type | Ctrl+] / Ctrl+[ | Word (per selection there; per section type here, since Markdown cannot store sizes for individual words) |
| Zoom | Ctrl+mouse wheel | Word |
| Shortcut list | F1 | MDNote |

**Done when**
- Every shortcut in the tables above works as described.
- Pressing a formatting shortcut a second time undoes it.
- Typing with an IME never triggers a shortcut by accident.

---

## O9. Page setup

**Goal:** Set the paper size and margins as with Word's **Layout > Size** and **Layout > Margins**, so the screen, PDF exports, and Word exports all use the same page.

**Page Setup dialog** (Layout menu)
- Paper size: A4, Letter, Legal, A5, B5, or a custom width and height.
- Orientation: portrait or landscape.
- Margins: Word's presets or custom values.
  - **Normal:** 2.54 cm on all sides
  - **Narrow:** 1.27 cm on all sides
  - **Moderate:** 2.54 cm top and bottom, 1.91 cm left and right
  - **Wide:** 2.54 cm top and bottom, 5.08 cm left and right
- A thumbnail previews the page and its margins.

**Ruler**
- A horizontal ruler above the rendered page shows the margins. Dragging its margin markers changes the left and right margins, as in Word.
- **View > Ruler** shows or hides it.

**Units and defaults**
- The UI shows cm or inches, following the Windows measurement setting. This can be changed in Preferences (O12). The `.mdmeta` file always stores millimeters.
- The default paper size follows the Windows region, as in Word: Letter in the US and Canada, A4 everywhere else. The default page setup can be changed in Preferences.
- Page setup is saved for each document in its `.mdmeta` file (O7).

**On screen**
- The rendered view shows the text on a page of the chosen width, with its margins, as one continuous sheet. Page breaks appear in print and export output, not in the editing view.

**Page breaks**
- Ctrl+Enter, Word's page break shortcut, inserts a `<!-- pagebreak -->` line into the `.md` file.
- MDNote shows it as a dashed "Page break" line, and PDF and Word exports start a new page there.
- Other Markdown apps ignore the line, because it is an HTML comment.

**Done when**
- Changing the paper size or margins changes the rendered page width immediately.
- Dragging a margin marker on the ruler changes that margin.
- Exported PDF and DOCX files use the same paper size and margins.

---

## O10. Export to PDF and Word (`.docx`)

**Goal:** Export a note to PDF and Word while keeping its styles, page setup, and table and image sizes.

**Common to both formats**
- **File > Export > PDF…** and **File > Export > Word document (.docx)…**
- The save dialog suggests the note's folder and name (for example `Meeting.pdf`).
- Exports use the document's styles (O4), page setup (O9), and table and image sizes (O5, O6).
- Exports always use light print colors, even when the app is in dark mode.
- Export options: page numbers in the footer (on by default) and the document name in the header (off by default).
- Headings stay with the paragraph that follows them, so a heading never sits alone at the bottom of a page.
- Page breaks (O9) start a new page.
- Links stay clickable, and images are embedded.
- Long documents show a progress indicator. When the export finishes, the file can be opened with one click.

**PDF**
- Produced by WebView2's built-in PDF engine from the same rendering as the screen, so fonts, spacing, and sizes match exactly.
- Fonts are embedded, so the PDF looks the same on any PC.
- Text can be selected and searched.
- Headings become PDF bookmarks.

**Word (`.docx`)**
- Built directly from the Markdown structure. The result is a normal, editable Word document, not a picture of the page.
- MDNote styles become Word styles (Normal, Heading 1–6, Quote, Code, and so on), so the whole document can be restyled in Word later.
- Fonts, sizes, bold and italic, colors, line spacing, and spacing before and after carry over.
- Paper size and margins become the Word document's page setup.
- Tables keep their column widths and row heights. Row heights become Word's "At least" heights. The header row repeats on every page.
- Images keep their saved sizes.
- Code blocks use the code font on a shaded background, with syntax-highlighting colors.
- Equations become native Word equations that can be edited in Word. An equation that cannot be converted is inserted as an image instead.
- Lists, task lists (☐ / ☑), blockquotes, footnotes (as real Word footnotes), links, strikethrough, and underline are all supported.
- Fonts are referenced by name, not embedded. If the reader's PC lacks a font, Word substitutes another.

**Done when**
- A test document that contains every supported element exports to both formats without errors.
- The PDF matches the rendered view's fonts, spacing, and table and image sizes.
- The DOCX opens in Microsoft Word without a repair prompt, uses the same page setup, and shows MDNote's styles in Word's Styles pane.
- Equations in the DOCX can be edited in Word's equation editor.

---

## O11. UI languages (English and Korean)

**Goal:** The whole interface is available in English and Korean.

- This covers menus, dialogs, tooltips, messages, Preferences, the shortcut list (F1), and the installer.
- On first launch, MDNote uses Korean if Windows' display language is Korean, and English otherwise.
- The language can be changed in Preferences (O12) and takes effect immediately.
- All UI text lives in translation files from the start. No text is hard-coded, and the build reports any text that is missing a translation.
- Dates and numbers are formatted for the selected language.
- Korean text displays correctly with any font: when a font has no Korean characters, the fallback font is used (Malgun Gothic by default; see O3 and O4).

**Done when**
- Switching the language changes every visible piece of UI text without a restart.
- Neither language contains untranslated text.

---

## O12. Preferences

**Goal:** One place for app-wide settings, opened with **File > Preferences** (Ctrl+,).

- **General:**
  - UI language (O11)
  - restore the previous session on startup (on by default; see O1)
  - number of recent files
- **Appearance:** theme: System (default), Light, or Dark.
- **Editor:**
  - source editor font and size (separate from document styles)
  - line numbers and word wrap
  - each editor convenience on or off (O17)
  - automatic alignment of source tables on or off (O16)
- **Documents:**
  - default styles and default style set (O4, O19)
  - default page setup (O9)
  - measurement units (cm or inches)
- **Files:**
  - folder for pasted and dropped images (O15)
  - show non-Markdown files in the folder sidebar (O14)
- **Export:** default page number and header options (O10).
- Changes apply immediately and are saved in `%APPDATA%\io.github.oilyhand.mdnote\`.
- **Reset all** restores the built-in defaults.

**Done when**
- Every setting takes effect immediately and is still set after restarting MDNote.

---

## O13. Outline panel

**Goal:** See the structure of the current note and jump to any section.

- The sidebar on the left of the window has two tabs, **Files** (O14) and **Outline**, similar to MarkText. **View > Sidebar** shows or hides it, and its width is remembered.
- The Outline tab lists the note's headings (H1–H6) as an indented tree. Branches can be collapsed.
- Clicking a heading scrolls both the source editor and the rendered view to it, and places the cursor there.
- The heading of the section currently being read or edited is highlighted, and the highlight follows scrolling.
- The outline updates as you type.
- Headings with no text, and `#` characters inside code blocks, are not listed.

**Done when**
- The outline matches the document's headings at all times while typing.
- Clicking any heading brings it into view in both panes.

---

## O14. Folder sidebar

**Goal:** Browse and manage a folder of notes without using the Open dialog.

- **File > Open Folder…** shows a folder as a tree in the sidebar's **Files** tab. Each window can have its own folder.
- The tree shows subfolders and `.md` files. Each `.mdmeta` file is hidden in the tree because it belongs to its note. It is still visible in File Explorer.
- Other files (such as images) are hidden by default. Preferences (O12) can show them.
- Clicking a note opens it in a tab (O1). The note in the active tab is highlighted in the tree.
- Notes can be sorted by name or by date modified.
- The right-click menu has:
  - **New note**
  - **New folder**
  - **Rename**
  - **Delete**
  - **Show in File Explorer**
  - **Copy path**
- **Delete** asks for confirmation and moves the note to the Recycle Bin, together with its `.mdmeta`.
- **Rename**, and moving a note by dragging it in the tree, also renames or moves its `.mdmeta` and its `<name>.assets` image folder (O15), and updates any open tab (O7).
- If a moved note has relative image links that would break in its new folder, MDNote warns and offers to update those links.
- The tree updates automatically when files are added, renamed, or deleted outside MDNote.
- The open folder is part of session restore (O1).

**Done when**
- Renaming a note in the sidebar renames its `.mdmeta` too, and the note keeps its formatting.
- A file created in File Explorer appears in the tree without a manual refresh.
- A deleted note and its `.mdmeta` can be recovered from the Recycle Bin.

---

## O15. Images by paste or drag-and-drop

**Goal:** Add images without saving files by hand and typing paths.

- Pasting an image from the clipboard (for example a screenshot taken with Win+Shift+S) saves it as a PNG file. The Markdown image link is inserted at the cursor, for example `![](assets/image-20261015-143012.png)`.
- Dropping image files into the source editor or the rendered view copies them into the image folder and inserts links. If a file with the same name already exists, a number is added to the new file's name.
- **Image folder:** by default, an `assets` folder next to the note. Preferences (O12) offers three choices:
  - `assets` (default)
  - `<note name>.assets`
  - the note's own folder
- A new note that has never been saved has no folder yet. Its images are kept in a temporary folder and moved into place on the first save.
- Links use relative paths with forward slashes, written so that paths containing spaces or Korean characters work in other Markdown apps too.
- Undo removes the inserted link. The copied image file stays on disk.

**Done when**
- A screenshot pasted into a saved note appears in the rendered view immediately, and the image file exists in the image folder.
- Images added to an unsaved note show correctly after the note is first saved.

---

## O16. Table tools

**Goal:** Create and edit Markdown tables without typing pipes and dashes by hand.

- **Insert > Table…** opens a Word-style grid picker. Hovering chooses the rows × columns, and clicking inserts the table.
- The right-click menu inside a table (in the source editor or the rendered view) offers:
  - **Insert row above / below**
  - **Insert column left / right**
  - **Delete row / column / table**
  - **Align column left / center / right**, which writes `:---`, `:---:`, or `---:`
- Tab and Shift+Tab move between cells (O8). Tab in the last cell adds a new row, as in Word.
- **Source alignment:** when the cursor leaves a table, its source text is re-padded so that the columns line up. **Format table** does the same on demand.
  - Korean characters count as double width so that columns line up in the editor.
  - Only spaces change. The table content stays the same.
  - This can be turned off in Preferences (O12).
- Inserting or deleting a column keeps the saved column widths (O5) in step. A new column takes its width from its neighbors, and a deleted column's width goes to its neighbors.

**Done when**
- A 3 × 4 table can be inserted, extended, and realigned without typing any `|` characters.
- Column widths set by dragging survive inserting and deleting columns.

---

## O17. Editor conveniences

**Goal:** Common Markdown typing is fast and needs few keystrokes.

**Lists and quotes**
- Pressing Enter in a list item starts the next item with the right marker (`- `, `1. `, or `- [ ] `).
- Pressing Enter on an empty item ends the list.
- Numbered lists are renumbered automatically when items are added, removed, or moved.
- Pressing Enter in a `> ` line continues the quote.

**Brackets and markers**
- Brackets and quotes close automatically: `( )`, `[ ]`, `{ }`, `" "`.
- Typing the closing character skips over the one that was inserted automatically.
- Backspace between an empty pair deletes both characters.
- Typing `*`, `_`, `` ` ``, or `~` with text selected wraps the selection in that marker instead of replacing it.

**Lines**
- Alt+Shift+↑ / Alt+Shift+↓ moves the current line, or the selected lines, up or down, as Word does for paragraphs.

**General**
- None of these behaviors interfere with Korean IME input.
- Each behavior can be turned off in Preferences (O12).

**Done when**
- A bulleted list, a numbered list, and a task list can each be typed using only Enter after the first item.
- Typing Korean text inside brackets and lists works without stray or duplicated characters.

---

## O18. Status bar

**Goal:** Show key facts about the current note at the bottom of each window.

- **Counts:**
  - words
  - characters with spaces
  - characters without spaces
- When text is selected, the counts cover the selection, for example "120 / 3,450 words".
- Counts are based on the rendered text, so Markdown syntax such as `**` or `#` is not counted.
- **Cursor:** line and column.
- **Encoding and line endings**, for example `UTF-8 · CRLF`. Clicking either one lets the user change it. The change applies on the next save.
- **Zoom level.** Clicking it resets the zoom to 100%.
- Right-clicking the status bar chooses which items are shown, as in Word.
- **View > Status bar** shows or hides it.
- Counts update shortly after typing pauses, so typing never lags.

**Done when**
- Counts match the rendered text of a test document, both with and without spaces.
- Changing the line endings from the status bar and saving writes the new line endings.

---

## O19. Style sets

**Goal:** Change the whole look of a note in one step, like Word's **Design > Style Sets**.

- A style set is a named collection of every section style (O4): fonts, sizes, spacing, and colors. It does not include page setup.
- MDNote ships at least three built-in sets (for example Default, Report, and Compact). Each set is checked with both English and Korean text.
- **Design > Style Sets** shows a gallery. Hovering over a set previews it in the rendered view, and clicking applies it.
- Applying a set copies its styles into the document's `.mdmeta` file. The document therefore looks the same on a PC that doesn't have the set, and later changes to the set don't alter documents that already used it. The name of the set is remembered for display.
- **Save as new style set** stores the current document's styles as a user set. User sets can be renamed and deleted. Built-in sets cannot be changed.
- Sets can be exported to a file and imported, for sharing or for moving to another PC.
- User sets are stored in `%APPDATA%\io.github.oilyhand.mdnote\stylesets\`.
- A set can be chosen as the default for documents without an `.mdmeta` file (O12).

**Done when**
- Applying a built-in set restyles the entire document in one step, and Undo reverts it.
- A user set exported on one PC and imported on another produces identical styles.

---

## O20. Copy as rich text

**Goal:** Paste formatted text from MDNote into Word, Outlook, and other email apps.

- Copying a selection in the rendered view (Ctrl+C) puts both formatted text and plain text on the clipboard.
- In the source editor, Ctrl+C still copies plain Markdown. **Edit > Copy as rich text** (also in the right-click menu) copies the rendered result of the selected Markdown instead.
- The formatting is written directly into the copied text, because other apps ignore MDNote's style sheet.
- Kept formatting:
  - fonts, sizes, colors, bold and italic
  - headings and lists
  - tables, with their column widths
  - links
  - code blocks, with the code font, background, and highlighting
- Images are included where the receiving app supports it. Equations are pasted as images.

**Done when**
- Pasting into Microsoft Word keeps headings, emphasis, lists, tables, and code formatting.
- Pasting into Outlook gives the same result.

---

## Roadmap

| Phase | Scope | Objectives |
|---|---|---|
| 1. Foundation | Tauri project, translation setup (English and Korean), Preferences window, tabs, open/save, encoding, file path from the command line, single instance, session restore, installer with `.md` association | O1, O11, O12 |
| 2. Rendering | Split view with synced scrolling, full syntax, code highlighting, math, images, HTML sanitization | O2 |
| 3. Editing | Editor, Word-style shortcuts, editor conveniences, table tools (source side), image paste and drop, status bar, crash recovery, detaching tabs into windows | O1, O2, O8, O15, O16, O17, O18 |
| 4. Navigation | Sidebar with folder tree and outline | O13, O14 |
| 5. Styles and page | Font list, styles panel, style sets, page setup and ruler, user defaults, `.mdmeta` load/save | O3, O4, O7, O9, O19 |
| 6. Layout | Table and image resizing, saved in `.mdmeta`; keeping column widths in step with table tools | O5, O6, O7, O16 |
| 7. Output | PDF and Word export, copy as rich text | O10, O20 |
| 8. Release | Code signing, auto-update, icons, Korean translation review, installer tests on clean Windows 10/11 | O1, O11 |

---

## After v1

These features follow once the essential implementation (phases 1–8) is complete. **Size** is a rough relative effort: S = small, M = medium, L = large.

**Decided**

| # | Feature | What it does | Builds on | Size |
|---|---|---|---|---|
| — | Live preview | A single-pane editing mode, offered as a **View** menu option. Markdown syntax is hidden except on the line being edited. | O2 | L |

**Nice-to-have: higher priority**

| # | Feature | What it does | Builds on | Size |
|---|---|---|---|---|
| N1 | Smart paste | Content pasted from web pages or Word becomes Markdown (headings, lists, tables, links) instead of plain text. Cells pasted from Excel become a Markdown table. | O2, O16 | M |
| N2 | Quick open and folder search | Open a note by typing part of its name. Search the text of every note in the sidebar folder, with results listed by note. | O14 | M |

**Nice-to-have: medium priority**

| # | Feature | What it does | Builds on | Size |
|---|---|---|---|---|
| N3 | Spell check | Underlines misspelled words in the source editor, using the Windows spell checker. Korean support depends on the spell-check languages installed in Windows. | O2 | S |
| N4 | Version history | Keeps recent saved versions of each note (and its `.mdmeta`) in `%APPDATA%`. Versions can be compared with the current text and restored. | O1, O7 | M |
| N5 | HTML export | Saves one self-contained HTML file with the document's styles and embedded images. | O10 | S |

**Nice-to-have: lower priority**

| # | Feature | What it does | Builds on | Size |
|---|---|---|---|---|
| N6 | Mermaid diagrams | Draws flowcharts and sequence diagrams from `mermaid` code blocks, including in PDF and Word exports. | O2, O10 | M |
| N7 | Windows extras | Adds **New > Markdown document** to Explorer's right-click menu, and shows recent notes in the taskbar jump list. | O1 | S |
| N8 | Unused image cleanup | Finds images in the image folders that no note links to any more, and offers to move them to the Recycle Bin. | O14, O15 | S |

---

## Decisions

| Date | Topic | Decision |
|---|---|---|
| 2026-10-14 | Platform | Windows 10 and 11 only. |
| 2026-10-15 | Editing model | Split view for v1. Live preview is added later as a **View** menu option. |
| 2026-10-15 | Multiple documents | Tabs by default. Tabs can be detached into separate windows, similar to MarkText. |
| 2026-10-15 | `.mdmeta` visibility | `.mdmeta` files are not hidden in File Explorer. |
| 2026-10-15 | Tech stack | Tauri 2 + TypeScript/React + CodeMirror 6 + unified/remark. |
| 2026-10-15 | App identifier | `io.github.oilyhand.mdnote` |
| 2026-10-15 | Publisher name | `oilyhand` |
| 2026-10-15 | UI languages | English and Korean. |
| 2026-10-15 | Shortcuts | As listed in O8, including Ctrl+U writing `<u>…</u>` and Ctrl+, for Preferences. |
| 2026-10-15 | Saving | Manual saving, as in Word, with crash-recovery copies. |
| 2026-10-15 | Session restore | On by default. Can be turned off in Preferences. |
| 2026-10-15 | Table and image units | Pixels for column widths, row heights, and image sizes. This replaces the earlier choice of percentages for table widths. |
| 2026-10-15 | Page setup and export | Word-style paper size and margins. Export to PDF and DOCX. |
| 2026-10-15 | Page breaks | Ctrl+Enter inserts a `<!-- pagebreak -->` line into the `.md` file. |
| 2026-10-15 | v1 additions | Outline panel, folder sidebar, image paste and drag-and-drop, table tools, editor conveniences, status bar, style sets, and copy as rich text (O13–O20). |
| 2026-10-15 | Deferred features | The other suggestions are scheduled after the essential implementation (see [After v1](#after-v1)). |
| 2026-10-15 | License | MIT. |
| 2026-10-15 | New documents | Saved as UTF-8 without a BOM, with Windows (CRLF) line endings, like Notepad. Existing files keep their own encoding and line endings. |
| 2026-10-15 | Language setting | Preferences offer "Same as Windows" (the default, following the O11 rule), English, and 한국어. |
| 2026-10-15 | Preview zoom | Fit Page Width is the default, because an A4 page is wider than half a typical window. |
| 2026-10-15 | Links in the preview | Web links open in the browser and `.md` links open in MDNote. Links to other local files only show the file in File Explorer, so a note can never start a program. |
| 2026-10-16 | Ending a list | Enter on an empty top-level list item ends the list with a blank line, so the next text is a separate paragraph, as in Word. |
| 2026-10-16 | Pasting | When the clipboard holds both text and a picture, the text is pasted. Only a clipboard with just an image saves an image file (O15). |
| 2026-10-16 | Restore after a crash | The question offers Restore and Discard; Esc means Restore, so no key press throws work away. |
| 2026-10-23 | Shortcuts during IME composition | A Ctrl or Alt shortcut pressed mid-syllable finishes the syllable, then runs (as in Word), instead of being ignored. Found in Phase 3 testing: Alt+= right after typing Korean did nothing. Plain keys still go to the IME. |
| 2026-10-23 | Exit and closing windows | File > Exit closes all windows and restores them all next time. Windows closed within 15 seconds of the last one also come back. File > Close Window (Alt+F4) closes one window. |
| 2026-10-23 | Remove Link | Ctrl+Shift+F9, as Word's Unlink; also a button in the Ctrl+K dialog and an item in the right-click menu. |
| 2026-10-24 | Alt shortcuts and the Korean IME | The Microsoft Korean IME can keep an Alt shortcut's key-down for itself (Alt+= failed even without typing Korean). An Alt shortcut whose key comes up without having gone down now runs on the key-up, and Insert Equation also has Ctrl+Shift+M (Ctrl shortcuts pass the IME). The F1 window has a key tester that shows what MDNote receives. |
| 2026-10-24 | What travels with a note | Renaming, moving or deleting a note in the sidebar takes its `<name>.mdmeta` and its `<name>.assets` image folder along, so its formatting and images stay with it. |
| 2026-10-24 | Clicking in the folder tree | A click opens a note but keeps the keyboard in the tree, so F2 and Delete act on the tree, not on the text. Double-click or Enter moves on to the editor. Other files are only shown in File Explorer, never started. |
| 2026-10-24 | Links after a move | MDNote checks a single note's relative links when it is renamed or moved and offers to fix those that would break. Moving a whole folder keeps the links inside it working and is not checked. |
| 2026-10-26 | Metadata file extension | `.mdmeta` instead of `.mdn`, which Microsoft Access registers for its blank database templates: on a PC with Office, a `.mdn` showed the Access icon and opened in Access. `.mdmeta` is not used by other programs and reads as "the metadata of the `.md`". |

## Open decisions

These are small defaults that came up while writing O13–O20. The proposals below are used unless changed.

1. **Image folder:** an `assets` folder next to the note (O15).
2. **Source table alignment:** on by default (O16).
3. **Alt+Shift+↑ / ↓:** added to the shortcuts. These are Word's own "move paragraph up / down" keys (O8, O17).

---

## Out of scope (for now)

- macOS and Linux
- Cloud sync and collaboration
- Plugins
- Custom shortcut mapping
- Storing formatting inside the `.md` file. The page break marker (O9) is the only exception.
- Formatting individual words or passages (for example, one red word). Styles apply to whole section types only.
