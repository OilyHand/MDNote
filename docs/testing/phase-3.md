# Phase 3 hands-on checklist

These checks need a person: real mouse drags, the Korean IME, screenshots, other programs and a forced quit. Automated tests already cover:
- every formatting, list, table and image-link command (on CodeMirror states)
- the shortcut table: key spellings, no key bound twice by accident
- the word and character counts of the rendered text
- image naming and folders, recovery copies, and the Rust side of tab moves

Some checks were also run on the debug build by script (formatting keys, menus, Find, tables, image paste and drop, the status bar, a forced quit and restore, Move to New Window, two-window session restore).

Open [phase-3-sample.md](phase-3-sample.md) in MDNote. Mark each item ✅ or ❌ and note what happened.

## Formatting shortcuts (O8)

1. ✅ With the cursor inside a word (no selection), Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X and Ctrl+\` format the whole word. Pressing the same keys again removes the formatting.
2. ✅ Inside the bold sentence, Ctrl+B removes the bold from the whole sentence. With a selection, the shortcut wraps it; pressing again unwraps it.
3. ✅ Ctrl+Alt+1 to 6 make headings; pressing the same keys again makes a normal paragraph. Ctrl+Shift+N removes heading, list and quote markers.
4. ✅ Ctrl+Shift+L(✅), Ctrl+Shift+7(✅), Ctrl+Shift+Q(✅) and Ctrl+Shift+\`(✅) switch bulleted lists, numbered lists, quotes and code blocks on and off. **Format > Task List** does the same for tasks.
5. ✅ Ctrl+K: on a word, on selected text, and inside an existing link (it edits that link). An address with spaces still works in the preview.
   <!-- It would be nice if there were a keyboard shortcut to remove the links attached here. -->
6. ⚠️ Alt+= puts `$…$` around the selection, or a `$$` block on an empty line. Ctrl+Enter inserts a page break. Alt+Shift+↑/↓ moves lines.
   <!-- It works! but has some bugs... -->
   <!-- This shortcut does not work in the Korean IME. -->
   <!-- In the “Lists” section, there is a bug where moving the second item using Alt+Shift+↑/↓ causes the list number to keep increasing. -->
7. ✅ With the Korean IME on: while a syllable is still being composed, Ctrl+B does nothing. Typing Korean inside `( )` and in lists gives no stray or doubled characters.
8. ✅ F1 lists every shortcut, and the menus show the same keys. Alt+I and Alt+O open **Insert** and **Format**; the arrow keys reach the **Heading** and **Table** submenus.

## Find and Go to line

9. ✅ Ctrl+F, Ctrl+H (the cursor lands in the Replace box), Ctrl+G, F3 and Shift+F3 work. In the Korean UI the panel is in Korean.

## Typing conveniences (O17)

10. ✅ A bulleted list, a numbered list and a task list can each be typed using only Enter after the first item. Enter on an empty item ends the list, and the next text is a normal paragraph.
11. ✅ Deleting or moving a numbered item renumbers the list.
12. ✅ `( [ { "` close automatically, typing the closing character steps over it, and Backspace between an empty pair deletes both. Typing `*`, `_`, `` ` `` or `~` with text selected wraps it.
13. ✅ **Preferences > Editor**: each convenience can be turned off, and the change applies at once.

## Tables (O16)

14. ✅ **Insert > Table…**: choose 3 × 4 in the grid. Fill it using Tab only; Tab in the last cell adds a row. No `|` typed by hand.
15. ✅ Right-click inside a table: insert and delete rows and columns, and align a column. Leaving the table lines up its columns, Korean included. **Preferences > Editor** can turn the alignment off.

## Images (O15)

16. ✅ Take a screenshot (Win+Shift+S) and press Ctrl+V in a saved note. The image appears in the preview, and the file is in `assets\` next to the note.
17. ✅ Drag image files from File Explorer onto the editor: they are copied and linked where you dropped them. Dropped on the preview, they are linked at the cursor. **Insert > Image…** works too.
18. ✅ Paste an image into a new, never-saved note; it shows in the preview. Save the note: the image moves next to it, and the link still works. Check the link in another Markdown app too (for example VS Code's preview).
19. ✅ **Preferences > Files**: the other two image folder choices work.
20. ✅ Copy text from Word and paste it: you get the text, not a picture.

## Status bar (O18)

21. ✅ The counts match the rendered text: the sample's "Counting" section has 10 + 5 words. Select some text: the counts show "selected / total".
22. ✅ Click the encoding, then the line ending, choose another, and save: another editor (for example VS Code) shows the new encoding and line endings.
23. ✅ Clicking the zoom resets it to 100%. Right-click chooses the items shown. **View > Status Bar** hides and shows it.

## Crash recovery (O1)

24. ✅ Type in a saved note and in a new note, wait two seconds, then end MDNote in Task Manager. Start it again: it offers to restore both. After **Restore**, both are back as unsaved changes; in the saved note, Ctrl+Z shows the file's own text.
25. ✅ Repeat, but choose **Discard**: the next start asks nothing. A normal exit with **Don't Save** asks nothing at the next start either.

## Tab windows (O1)

26. ✅ Drag a tab down out of the tab bar and release it over the desktop: a new window opens under the mouse, and a small label follows the mouse while you drag.
27. ✅ Drag a tab onto another window's tab bar: it moves there at that position, and Ctrl+Z still undoes earlier typing.
28. ✅ Drag the only tab of a window: the window moves. Drop it on another window's tab bar: the tab moves, and the empty window closes.
29. ✅ Press Esc while dragging: nothing changes.
30. ✅ **Move to New Window** from the tab's right-click menu and from the File menu. **Close Other Tabs**, **Copy Path** and **Show in File Explorer** work.
31. ❌ With two windows open, quit and restart MDNote: both windows return with their tabs and positions.
<!-- If you try to close both windows at the same time, they close one after the other. Therefore, when you restart the program, the window that was closed last will open. -->
32. ✅ Open a file from File Explorer that is already open in the second window: MDNote switches to it there.

## Recheck after the fixes (2026-10-23)

- ✅　**R1.** Item 6: with the Korean IME on, type a word and, while its last syllable is still being composed, press Alt+=, then try Ctrl+Enter and Alt+Shift+↑. The syllable stays and the shortcut runs.
- ✅　**R2.** Item 7 changed: Ctrl+B mid-syllable now finishes the syllable and then applies bold (at the end of a word it turns bold on for what you type next, as in Word). Plain typing still never triggers a shortcut.
-　✅ **R3.** Item 6: in "Lists", move the second item up and down several times with Alt+Shift+↑/↓. The numbers stay 1 to 4.
- ✅　**R4.** Item 5 suggestion: Ctrl+Shift+F9 inside a link keeps its text and removes the link. The Ctrl+K dialog on an existing link has **Remove Link**, and right-clicking a link offers **Edit Link…** and **Remove Link**. **Format > Remove Link** works with several links selected.
- ✅　**R5.** Item 31: with two windows open, **File > Exit**, then start MDNote: both windows return. Also close both windows one after the other (or right-click MDNote on the taskbar > **Close all windows**): both return.
-　✅ **R6.** **File > Close Window** (Alt+F4) closes only the current window; a window closed long before the last one does not come back.

## Recheck after the second run (2026-10-24)

R1: Alt+= still did nothing with the Microsoft Korean IME, even without typing Korean.

- ✅　**R7.** With the Microsoft Korean IME on, both in Hangul and in English mode, press Alt+= in the editor: `$$` is inserted.
- ✅　**R8.** Ctrl+Shift+M inserts an equation too, with the Korean IME on.
- ✅　**R9.** If Alt+= still does nothing: press F1, click the **Try a shortcut** box, press Alt+= once in each IME mode, and copy the lines that appear (or take a screenshot). ▼ is a key going down, ▲ a key coming up; a key that only comes up, or nothing at all, means the IME kept it.
