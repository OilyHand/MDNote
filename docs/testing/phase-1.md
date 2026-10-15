# Phase 1 hands-on checklist

These checks need a person: real mouse and keyboard, the installer, and Windows Explorer. Automated tests cover the rest (encoding round-trips, safe saving, settings, shortcuts, translations).

Mark each item ✅ or ❌ and note what happened.

## Installer and file association (O1)

1. ✅ Run `MDNote_0.1.0_x64-setup.exe`. It installs without an administrator prompt, and the installer is in Korean on Korean Windows and English otherwise.
2. ✅ MDNote appears in the Start menu, and under **Settings > Apps > Installed apps** with publisher **oilyhand**.
3. ✅ Right-click a `.md` file > **Open with**: MDNote is listed. Choose it and tick "Always use this app".
4. ✅ Double-click a `.md` file in Explorer: MDNote opens it.
5. ✅ With MDNote open, double-click another `.md` file: it opens as a new tab in the same window, not in a second window.
6. ✅ Double-click a `.md` file that is already open: MDNote switches to its tab instead of opening it twice.
7. ✅ **Help > Make MDNote the Default for .md Files…** opens the Windows Default Apps page.
8. ✅ Uninstall MDNote: the Start menu entry and the "Open with" entry disappear.

## Documents

9. ✅ **File > New** (Ctrl+N) opens "Untitled-1" (Korean UI: "제목 없음-1"). A second one is "Untitled-2".
10. ✅ Type something: a ● appears on the tab and in the title bar.
11. ✅ **Ctrl+S** on an untitled document opens the Save dialog; after saving, the tab shows the file name and the ● disappears.
12. ✅ **F12** (or Ctrl+Shift+S) is Save As.
13. ✅ Close a tab with unsaved changes (×, middle-click, or Ctrl+W): **Save / Don't Save / Cancel** appears, and each button does what it says.
14. ✅ Close the window with several unsaved tabs: MDNote asks for each one, in tab order. Cancel keeps the window open.
15. ✅ Open a file saved by Notepad as **ANSI** with Korean text: a notice says it was read with code page 949. Add an emoji and save: MDNote offers **Save as UTF-8**.
16. ✅ Open a read-only file and save: an error explains that it is read-only.
17. ✅ Drag a `.md` file from Explorer onto the window: it opens.
18. ✅ **File > Open Recent** lists recent files; **Clear Recent Files** empties the list.

## Outside changes

19. ✅ Edit an open file in another editor and save: a yellow bar offers **Reload** / **Keep My Version**. Reload shows the new text, and Ctrl+Z brings back the old text.
    - **First result (❌):** "The feature itself works fine. However, when saving from an external editor, line break characters appear to be added in mdnote."
    - **Cause, confirmed (not an MDNote bug):** Windows Notepad (11.2607) opens `.md` files in its **Markdown formatted view**. When it saves, it writes the Markdown back out, adding blank lines between paragraphs and an empty line at the end. Its formatted view doesn't show those lines, but they are really in the file, and even Ctrl+S with no edits can change the bytes. The same test with **Sublime Text** shows no extra line breaks.
    - **What MDNote does:** reads the bytes exactly as they are. Every file checked contained only plain CRLF, and MDNote showed exactly those lines.
    - **Wrong guesses along the way:** Notepad writing CR CR LF (the code change was reverted), and a stale Notepad tab.
    - **Kept improvement:** when another program saves a file without changing its bytes, MDNote updates quietly instead of showing the bar.
    - **For future tests:** use a plain-text editor (Sublime Text, VS Code), or Notepad with Settings > Formatting turned off.
20. ✅ Delete an open file in Explorer: the bar says the file was deleted; **Save to Recreate It** writes it again.

## Tabs and keyboard

21. ✅ Drag a tab sideways to reorder it.
22. ✅ Ctrl+Tab / Ctrl+Shift+Tab switch tabs.
23. ✅ Alt+F, Alt+E, Alt+H open the menus; the arrow keys, Enter and Esc work in them.
24. ✅ All of the shortcuts above also work with the **Korean IME switched on**.

## Preferences and session (O11, O12)

25. ✅ **File > Preferences…** (Ctrl+,) opens the Preferences window. Pressing Ctrl+, again brings the same window to the front.
26. ✅ Switch **Language** to 한국어: every window changes to Korean immediately, without a restart. Switch back.
27. ✅ Switch **Theme** to Light, Dark, and "Same as Windows": the windows, including their title bars, follow immediately.
28. ✅ Open three files, move and resize the window, then close MDNote. Start it again: the same tabs reopen, the same tab is active, and the window has the same size and position.
29. ✅ Turn off "Reopen the documents from the last session" and restart: MDNote starts empty, but the window size and position are still remembered.
30. ✅ Maximize the window and close MDNote: it starts maximized, and un-maximizing gives the earlier size.
