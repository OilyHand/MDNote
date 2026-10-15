# Phase 2 hands-on checklist

These checks need a person: scrolling, clicking, printing, and judging how things look. Automated tests cover the rest:
- the rendering pipeline: every CommonMark example, plus chunked vs. whole-document equivalence
- sanitizing, footnotes, heading ids, block lines and keys
- speed: a 1 MB document re-renders an edit in about 60 ms
- math in the source editor's syntax colouring

Open [phase-2-sample.md](phase-2-sample.md) in MDNote (it uses every supported syntax). Mark each item ✅ or ❌ and note what happened.

## Rendering (O2)

1. Each section of the sample renders as its text describes:
   - text styles and the hard line break
   - nested and task lists
   - quotes and the rule
   - highlighted TypeScript, Python and Rust, and the plain unknown language
   - the table's left, center and right alignment
   - links and the image
   - inline and display math, including the matrices
   - the footnotes at the bottom
   - the dashed "Page break" line
   - the HTML section: no alert box appears, and "Click to expand" opens
2. Type in the source editor: the preview follows within a moment, and typing never stutters.
3. Type Korean with the IME on: the preview shows it correctly once each syllable is finished.
4. Make a deliberate math error, such as `$\frac{a$`: the preview shows it in red, and the rest still renders.

## Layout and view

5. Drag the divider between the panes; double-click it to go back to half and half.
6. **View > Source Only**, **Preview Only**, **Split View**: the check mark moves. Switching back keeps the text, selection and Undo history. **Alt+V** opens the View menu.
7. Ctrl+mouse wheel over the preview zooms the page, and a percentage shows for a moment. **View > Actual Size** goes to 100%, and **Fit Page Width** fits the page to the pane and stays fitted when the window is resized.
8. Close and restart MDNote: the view mode, divider position and zoom are remembered.

## Scroll sync

9. Scroll the source editor: the preview follows to the same place.
10. Scroll the preview: the editor follows.
11. Scroll past the image, the display math and the long code block: neither side jumps.

## Links

12. **Tauri** opens in your web browser.
13. **jump to Math** scrolls the preview to section 7.
14. A footnote number scrolls to its footnote, and the ↩ scrolls back.
15. **the Phase 1 checklist** opens `phase-1.md` in a new MDNote tab.
16. Change a link to a missing file, such as `[x](missing.md)`, and click it: a notice says it can't be found.

## Print

17. **File > Print…** (Ctrl+P) shows only the document, without menus, tabs or the editor. Section 9 starts on a new page.
18. With the dark theme on, the print preview still uses black text on white, and the code colours are the light ones.

## Editor and preferences

19. The source editor colours Markdown: headings, emphasis, links and code. Math (`$…$`, `$$…$$`) is coloured like code. In the sample's matrix example, the `=` line no longer turns the lines above it into a heading.
20. **Preferences > Editor**:
    - The font list shows the fonts installed on this PC, including per-user ones such as JetBrains Mono or Pretendard. In the Korean UI, fonts with Korean names also show them.
    - Font, size, word wrap and line numbers apply at once.
21. Switch the theme between Light and Dark: the page, the code colours and the editor colours follow.

## Tabs

22. With two documents open, switching tabs shows each one's preview at once, and each keeps its own scroll position.
23. A new, unsaved document renders too. Relative images can't show until it is saved.
