# Phase 5 hands-on checklist

These checks need a person: printing, the native file dialogs, fonts installed in Windows, real mouse drags, and comparing with Word. Automated tests already cover:
- the `.mdmeta` format: reading, writing only the document's own settings, keeping values MDNote can't use, broken files
- the style layers (built-in, defaults, style set, document) and what each style takes from Body text
- the style sheet: Word's line spacing, missing fonts, dark-mode colours
- style set files, and the Rust side of `.mdmeta` and style set storage

Most items were also run once on the debug build by script.

Open [phase-5-sample.md](phase-5-sample.md) in MDNote. Mark each item ✅ or ❌ and note what happened.

This PC's Windows regional format is English (United States), so MDNote starts with Letter paper and inches, as Word does. Item 27 changes that in Preferences.

## Styles (O4)

1. ✅ The sidebar has a **Styles** tab: every section type, each in its own font, with its size. The header says "Default styles".
2. ✅ Click **Heading 2** in the Styles tab, or right-click a heading 2 on the page > **Modify Heading 2 Style…**. Change the font, the size and the line spacing: every Heading 2 on the page changes while the dialog is open. **OK** keeps the change; **Cancel** puts the page back.
3. ✅ After OK: the tab shows unsaved changes, and **Ctrl+Z** takes the change back in one step, also with the focus on the page (click the page first). **Ctrl+Y** brings it back.
4. ✅ **Ctrl+]** and **Ctrl+[** with the cursor in a heading, in body text and in the code block: that section type gets 1 pt bigger or smaller. The text itself doesn't change.
5. ❌ Colour: give Heading 1 a dark blue. On the dark page it shows lighter; in light mode, and when printed (item 29), it is the blue you chose. **Automatic** goes back to the page's text colour.
<!-- The color selection menu isn't working. -->
<!-- Upon checking, I found that the color selection menu does not appear even when clicked for the default index. -->
6. ❌ **Font for Korean**: change Body text's to another Korean font (for example 바탕 or 굴림, if installed). The Korean text changes; the English text doesn't.
<!-- Korean text is also displayed using English fonts. -->
8. ❌ Optional, with Word: type a paragraph in Word in Segoe UI 12 pt with line spacing 1.5, and set MDNote's Body text to the same. The lines are as far apart in both.
<!-- The line spacing appears larger in Word. -->
9. ✅ **Design > Set as Default** (asks first): a new note (Ctrl+N) and notes without styles of their own now look like this one. Preferences > Documents > Default styles shows "From a document". Set it back to **Built-in (Default)**.
10. ✅ **Design > Reset to Defaults** removes the note's own styles and style set; Ctrl+Z brings them back.

## Fonts (O3)

10. ✅ The font picker (Modify Style > Font) shows each font in its own typeface. The search box, **Monospaced only** and the **Recently used** section work. In the Korean UI, fonts with Korean names show both (맑은 고딕 (Malgun Gothic)).
11. ✅ Install a font for your account only: right-click a `.ttf` file > **Install** (not "Install for all users"). In the picker, click **Refresh**: the font is listed; choosing it changes the page at once.
12. ✅ A missing font: close the note, open its `.mdmeta` in Notepad, change a `"fontFamily"` value to `"Nowhere Sans"`, save, reopen the note in MDNote. That style shows in Segoe UI, the picker shows "Nowhere Sans" marked **not installed**, and saving keeps the name in the file.

## The `.mdmeta` file (O7)

13. ✅ After a style change, save (Ctrl+S): `phase-5-sample.mdmeta` appears next to the note (File Explorer). It is readable in Notepad and holds only the changed values. The `.md` file's modified time doesn't change when only styles changed.
14. ✅ Close and reopen the note: every style comes back.
15. ✅ Open a note you never styled and save it: no `.mdmeta` appears.
16. ✅ **Reset to Defaults**, then save: the `.mdmeta` is removed.
17. ✅ A broken file: change a style, save, close the note. Remove a `}` from its `.mdmeta` in Notepad and reopen the note. MDNote shows a notice and the default styles, and works normally. Change a style and save: the broken file is kept as `phase-5-sample.mdmeta.bak`.
18. ✅ **Save As** (F12) under a new name: `<new name>.mdmeta` is written next to it, and the old `.mdmeta` stays with the old note.
19. ✅ Left from Phase 4: rename the styled note in the sidebar (F2). Its `.mdmeta` is renamed too, and the note keeps its styles.
20. ✅ With an unsaved style change, end MDNote in Task Manager and start it again. **Restore** brings back the formatting too.

## Style sets (O19)

21. ✅ **Design > Style Sets…**: pointing at a set shows it on the page, and moving away shows the note's own styles again. Clicking applies the set; the Styles tab then says "Style set: …". One Ctrl+Z takes it back. Check **Report** and **Compact** with the Korean text.
22. ✅ **Save as New Style Set…** (Design menu or the gallery): the set appears in the gallery. Its **⋯** menu renames and deletes it; built-in sets can't be renamed or deleted.
23. ✅ **⋯ > Export…** saves a set as a `.json` file. **Import…** adds it back (as "<name> (2)" if the name is taken), with the same styles. Optional: import it on another PC.
24. ✅ Preferences > Documents > **Default styles**: choose **Report**. Notes without styles of their own, and new notes, look like Report at once. A note with a set applied keeps its own set.

## Page setup (O9)

25. ✅ **Layout > Page Setup…**: paper size (A4, Letter, Legal, A5, B5 (JIS), custom), orientation, and margins (Word's presets or your own values). The thumbnail and the page follow as you change them; margins that leave no room for text are refused. OK applies; Ctrl+Z takes it back.
26. ✅ **Layout > Size / Orientation / Margins** apply Word's quick choices, with the current one checked.
27. ✅ Preferences > Documents: **Measurement units** "Centimeters" shows cm in Page Setup and on the ruler; **Default paper size** "A4" makes notes without their own page setup A4. Set both back to "Same as Windows".
28. ✅ The ruler (**View > Ruler**) shows the margins. Dragging a margin marker shows the value and changes that margin; Ctrl+Z takes it back. Double-clicking the ruler opens Page Setup.
29. ❌ Print (Ctrl+P) with A5, landscape and Wide margins: the print preview uses that paper and those margins, in light colours even in dark mode, with style colours as chosen. The page break line starts a new page.
<!-- When set in centimeters, values such as 2.54 cm—which include a digit after the second decimal place—cannot be used. -->
<!-- It would be nice if the preview included features such as showing the trim area based on the paper size or displaying a page split into multiple pages to fit the paper size. -->


## Others

30. ✅ A tab with unsaved style changes, moved to a new window (**File > Move to New Window**), keeps its formatting and its unsaved marker.
31. ✅ **F1** lists Ctrl+] and Ctrl+[ under "Styles and page". The Design and Layout menus and every new dialog are translated in Korean.

## Recheck after the fixes (2026-10-27)

Install the new build, then:

- ✅ **R1.** Item 5: Modify Style > **Color** opens a menu like Word's Font Color: **Automatic**, the theme colours with their shades, the standard colours, and **Other color** for a value such as `#1F3864` (Enter or **Use**). Pick a dark blue for Heading 1: the page shows it (lighter on the dark page), and it prints as chosen. The menu is never cut off by the dialog.
- ✅ **R2.** Item 6: set Body text's **Font for Korean** to 바탕 (Batang): the Korean text changes, the English text doesn't. This also holds when the main font has Korean letters (set Body text's **Font** to 맑은 고딕 and its Font for Korean to 바탕: Korean shows in 바탕).
- ✅ **R3.** Item 7, with Word: Segoe UI 12 pt at 1.5 lines, Word's font for Asian text 맑은 고딕 in both. English lines are as far apart in both (24 pt), and so are lines with Korean text (31 pt in Word, wider than the English ones).
- ✅ **R4.** Item 29: Page Setup accepts values such as 2.54 cm or 1.27 in (Preferences > Documents > Measurement units to switch). Then print with A5, landscape and Wide margins, as in item 29.
<!-- Currently, the document is displayed as a single continuous page in the preview. I would like the preview to show the pages divided according to the paper size, just like in an actual Word document. (It would be nice to add this as an option.) -->

## Print Layout (2026-10-27)

Added for the suggestion above. Install the new build, then open [phase-5-sample.md](phase-5-sample.md) and a long note of your own (several pages, with a long table or code block if you have one).

- ⬜ **R5.** **View > Print Layout** is checked: the page is split into sheets of the paper size, with a gap between them, as in Word. **Ctrl+Alt+P** or the menu item turns it off (one continuous sheet, as before) and on again. MDNote remembers the choice after a restart.
- ⬜ **R6.** The status bar shows "Page 2 of 5" while Print Layout is on, following as you scroll. Right-clicking the status bar lists **Page number**, which hides it.
- ⬜ **R7.** Change the paper, orientation and margins (Layout menu, Page Setup, the ruler) and the zoom: the sheets follow at once, and the pages break elsewhere.
- ⬜ **R8.** Print (Ctrl+P) the long note: every printed page starts with the same text as the page on screen. The `<!-- pagebreak -->` line in the sample starts a new page on screen too.
- ⬜ **R9.** Code blocks and tables: a long one continues on the next page instead of scrolling sideways, on screen and in print, and long code lines wrap. A table's header row is not repeated on the next page (as in Word). With Print Layout off, they scroll sideways as before.
