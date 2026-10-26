# Phase 4 hands-on checklist

These checks need a person: the Open Folder dialog, real mouse drags, File Explorer, the Recycle Bin and several windows. Automated tests cover the link rewriting after a move (paths, relative links, links in code left alone) and the Rust side (names Windows refuses, a note's companions, numbering new names). Most items were also run once on the debug build by script.

Make a test folder with a few notes, a subfolder, and a note with an image (paste one). Mark each item ✅ or ❌ and note what happened.

## Sidebar (4.1)

1. ✅ The sidebar is on the left with **Files** and **Outline** tabs. Drag its edge to change the width; double-click the edge for the default. **View > Sidebar** hides and shows it. Width, tab and visibility are remembered after a restart.

## Outline (O13)

2. ✅ The Outline lists the note's headings as a tree, with their rendered text (no `#` or `**`). A `#` line inside a code block is not listed, and neither is an empty heading.
3. ✅ Type a new heading, or change one: the Outline follows within a moment. It also works in **View > Source Only**.
4. ✅ Click a heading: both panes scroll to it and the cursor is on it. In **Preview Only**, the preview scrolls to it.
5. ✅ Scroll or move the cursor: the highlighted heading follows the section you are in. Branches can be collapsed with ▸/▾.

## Folder tree (O14)

6. ✅ **File > Open Folder…** (Ctrl+Shift+O) shows the folder in the **Files** tab. Subfolders load when you expand them.
7. ⚠️ `.mdn` files never show. Other files (images, …) show only with **Preferences > Files > Show other files**; clicking one shows it in File Explorer.
8. ✅ Clicking a note opens it; the note in the active tab is highlighted, and its folders open by themselves when you switch tabs.
9. ✅ **⋯ > Sort by Name / Sort by Date Modified**: folders stay first; "Note 2" comes before "Note 10".
10. ✅ In File Explorer, create, rename and delete a note in the folder: the tree follows without a refresh.

## File operations (O14)

11. ✅ **New Note** and **New Folder** (header buttons and right-click): the name can be typed straight away; a new note then opens.
12. ⚠️ Rename a note (F2, or right-click): its `.mdn` is renamed too, the open tab shows the new name, and its formatting stays. With **Preferences > Files** set to "<note name>.assets", its image folder is renamed too and the images still show.
13. ✅ Drag a note with images onto another folder: MDNote asks to update the links. **Update Links** fixes them (the tab shows unsaved changes, or a closed note's file is updated); **Don't Update** leaves them; **Cancel** does not move it.
14. ✅ Drag a folder onto another folder: it moves, with everything in it; open tabs from inside it follow. Dropping a folder into itself is refused.
15. ⚠️ Delete a note (Delete key, or right-click): MDNote asks first. The note and its `.mdn` are in the Recycle Bin and can be restored. An open tab of the note closes; with unsaved changes it stays, with the "deleted" notice.
16. ✅ **Show in File Explorer** and **Copy Path** work. Single-click a note, then press F2 or Delete: they act on the tree, not on the text. Double-click or Enter opens the note and puts the cursor in it.

## Session (4.5)

17. ✅ Open a different folder in a second window. Quit with **File > Exit** and restart: each window shows its own folder again.
18. ✅ With session restore off (**Preferences**), MDNote starts without a folder.

🚨 Currently, a .mdn file isn't being created separately, so I can't verify it. Is the .mdn file supposed to be created immediately? Are there specific conditions that must be met for it to be created?

## Recheck with a hand-made `.mdn` (2026-10-26)

MDNote doesn't write `.mdn` files yet. They come with styles and page setup in Phase 5, and even then only for a note whose settings differ from the defaults (O7): opening and saving a plain note never creates one. The checklist should have said so.

What Phase 4 does with a `.mdn` depends only on its name, not on what is inside, so a hand-made one is enough:

1. In File Explorer, turn on **View > Show > File name extensions**.
2. Next to a note in your test folder, for example `test2.md`, create a text file and rename it to the note's name with `.mdn`: `test2.mdn`. What is inside doesn't matter yet.

- ✅ **R1.** Item 7: the tree doesn't list `test2.mdn`, also with **Show other files** on (images are listed then).
- ✅ **R2.** Item 12: rename `test2` in the tree (F2). In File Explorer, its `.mdn` has the new name too. Then drag the note onto a subfolder: the `.mdn` moves with it. ("Its formatting stays" can only be checked in Phase 5, so it moves to that checklist.)
- ✅ **R3.** Item 15: delete the note in the tree. The note and its `.mdn` are both in the Recycle Bin, and both can be restored.

After this recheck the extension became `.mdmeta`, because Microsoft Access registers `.mdn` (Objectives, decision of 2026-10-26). The items above were tested with `.mdn`; the tree now treats `.mdmeta` the same way, covered by the Rust tests.