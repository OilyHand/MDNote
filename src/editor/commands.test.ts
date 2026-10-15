// The editing commands (O8, O16, O17) on real CodeMirror states.
// In the strings below, ¦ is the cursor and ‹…› a selection.

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownMath } from "./math";
import type { Edit } from "./edits";
import { encodeLinkTarget } from "./edits";
import { insertEquation, insertLink, linkTargetAt, toggleInline } from "./inline";
import {
  indentListItem,
  insertPageBreak,
  outdentListItem,
  setHeading,
  setNormal,
  toggleCodeBlock,
  toggleList,
  toggleQuote,
} from "./blocks";
import { endListOnEmptyItem, renumberLists } from "./lists";
import { editTable, formatTable, insertTable, moveToCell } from "./table";
import { imageMarkdown, insertImageLinks, pastedImageName } from "./images";

const language = markdown({ base: markdownLanguage, extensions: [markdownMath] });

function stateOf(marked: string, extensions: Extension[] = []): EditorState {
  const cursor = marked.indexOf("¦");
  const from = marked.indexOf("‹");
  const doc = marked.replace(/[¦‹›]/g, "");
  const selection =
    cursor >= 0
      ? EditorSelection.cursor(cursor)
      : EditorSelection.range(from, marked.indexOf("›") - 1);
  return EditorState.create({ doc, selection, extensions: [language, ...extensions] });
}

function show(state: EditorState): string {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  if (from === to) return doc.slice(0, from) + "¦" + doc.slice(from);
  return doc.slice(0, from) + "‹" + doc.slice(from, to) + "›" + doc.slice(to);
}

function run(edit: Edit, marked: string): string | null {
  const state = stateOf(marked);
  const spec = edit(state);
  return spec ? show(state.update(spec).state) : null;
}

describe("inline formatting toggles", () => {
  const bold = toggleInline("bold");

  it("formats the whole word around the cursor, as Word does", () => {
    expect(run(bold, "a wo¦rd here")).toBe("a **wo¦rd** here");
    expect(run(bold, "한글 단¦어입니다")).toBe("한글 **단¦어입니다**");
  });

  it("removes the formatting when pressed again", () => {
    expect(run(bold, "a **wo¦rd** here")).toBe("a wo¦rd here");
    expect(run(bold, "a **two wo¦rds** here")).toBe("a two wo¦rds here");
    expect(run(toggleInline("code"), "x `co¦de` y")).toBe("x co¦de y");
    expect(run(toggleInline("strikethrough"), "~~gon¦e~~")).toBe("gon¦e");
  });

  it("inserts markers at a word edge, and Ctrl+B again removes the empty pair", () => {
    expect(run(bold, "word ¦")).toBe("word **¦**");
    expect(run(bold, "word **¦**")).toBe("word ¦");
  });

  it("wraps a selection, trimming spaces, and unwraps it again", () => {
    expect(run(bold, "a‹ some text ›b")).toBe("a **‹some text›** b");
    expect(run(bold, "a **‹some text›** b")).toBe("a ‹some text› b");
    expect(run(bold, "‹**whole**›")).toBe("‹whole›");
  });

  it("keeps bold and italic apart", () => {
    expect(run(toggleInline("italic"), "**‹bold›**")).toBe("***‹bold›***");
    expect(run(bold, "***‹both›***")).toBe("*‹both›*");
    expect(run(toggleInline("italic"), "***bo¦th***")).toBe("**bo¦th**");
  });

  it("underlines with <u> and removes it", () => {
    expect(run(toggleInline("underline"), "an ‹important› word")).toBe(
      "an <u>‹important›</u> word",
    );
    expect(run(toggleInline("underline"), "an <u>impor¦tant</u> word")).toBe("an impor¦tant word");
  });

  it("wraps each line of a multi-line selection on its own, after list markers", () => {
    expect(run(bold, "- ‹one\n- two›")).toBe("- **‹one**\n- **two›**");
  });

  it("uses double backticks for code that contains a backtick", () => {
    expect(run(toggleInline("code"), "‹a`b›")).toBe("`` ‹a`b› ``");
  });
});

describe("paragraph commands", () => {
  it("sets and toggles headings", () => {
    expect(run(setHeading(2), "Ti¦tle")).toBe("## Ti¦tle");
    expect(run(setHeading(2), "## Ti¦tle")).toBe("Ti¦tle");
    expect(run(setHeading(1), "### Ti¦tle")).toBe("# Ti¦tle");
    expect(run(setHeading(3), "- it¦em")).toBe("### it¦em");
    expect(run(setHeading(1), "¦")).toBe("# ¦");
  });

  it("makes a normal paragraph from headings, lists and quotes", () => {
    expect(run(setNormal, "> - [x] do¦ne")).toBe("do¦ne");
    expect(run(setNormal, "#### He¦ad")).toBe("He¦ad");
  });

  it("toggles bulleted, numbered and task lists", () => {
    expect(run(toggleList("bullet"), "‹one\ntwo›")).toBe("- ‹one\n- two›");
    expect(run(toggleList("bullet"), "- ‹one\n- two›")).toBe("‹one\ntwo›");
    expect(run(toggleList("numbered"), "- ‹one\n- two›")).toBe("1. ‹one\n2. two›");
    expect(run(toggleList("numbered"), "1. ‹one\n2. two›")).toBe("‹one\ntwo›");
    expect(run(toggleList("task"), "- it¦em")).toBe("- [ ] it¦em");
    expect(run(toggleList("task"), "- [x] it¦em")).toBe("it¦em");
  });

  it("quotes and unquotes lines, keeping blank lines inside the quote", () => {
    expect(run(toggleQuote, "‹one\n\ntwo›")).toBe("> ‹one\n>\n> two›");
    expect(run(toggleQuote, "> ‹one\n>\n> two›")).toBe("‹one\n\ntwo›");
    expect(run(toggleQuote, "¦")).toBe("> ¦");
  });

  it("puts lines in a code block and takes them out again", () => {
    expect(run(toggleCodeBlock, "‹a\nb›")).toBe("```\n‹a\nb›\n```");
    expect(run(toggleCodeBlock, "```\na¦\n```")).toBe("a¦");
    expect(run(toggleCodeBlock, "¦")).toBe("```\n¦\n```");
    expect(run(toggleCodeBlock, "‹```\ncode\n```\nafter›")).toBe(
      "````\n‹```\ncode\n```\nafter›\n````",
    );
  });

  it("inserts a page break as its own block", () => {
    expect(run(insertPageBreak, "before¦after")).toBe("before\n\n<!-- pagebreak -->\n\n¦after");
    expect(run(insertPageBreak, "text\n¦")).toBe("text\n\n<!-- pagebreak -->\n\n¦");
  });

  it("indents and outdents list items, and declines outside lists", () => {
    expect(run(indentListItem, "- one\n- tw¦o")).toBe("- one\n  - tw¦o");
    expect(run(indentListItem, "1. one\n2. tw¦o")).toBe("1. one\n   2. tw¦o");
    expect(run(outdentListItem, "- one\n  - tw¦o")).toBe("- one\n- tw¦o");
    expect(run(indentListItem, "plain ¦text")).toBeNull();
  });
});

describe("equations and links", () => {
  it("inserts inline math, or a block on an empty line", () => {
    expect(run(insertEquation, "x ‹E=mc^2› y")).toBe("x $‹E=mc^2›$ y");
    expect(run(insertEquation, "x ¦")).toBe("x $¦$");
    expect(run(insertEquation, "¦")).toBe("$$\n¦\n$$");
  });

  it("edits the link around the cursor", () => {
    const state = stateOf("see [the do¦cs](https://a.b/c) now");
    expect(linkTargetAt(state)).toMatchObject({ text: "the docs", url: "https://a.b/c" });
  });

  it("takes a selected address as both text and address", () => {
    expect(linkTargetAt(stateOf("‹https://tauri.app›"))).toMatchObject({
      text: "https://tauri.app",
      url: "https://tauri.app",
    });
  });

  it("writes link targets that other Markdown apps can read", () => {
    const state = stateOf("¦");
    const edit = insertLink(linkTargetAt(state), "", "my notes/a (1).md");
    expect(show(state.update(edit(state)!).state)).toBe(
      "[my notes/a (1).md](my%20notes/a%20%281%29.md)¦",
    );
    expect(encodeLinkTarget("이미지 1#.png", true)).toBe("이미지%201%23.png");
  });
});

describe("Enter in lists", () => {
  const enter = (marked: string) => {
    let state = stateOf(marked);
    const handled = endListOnEmptyItem({ state, dispatch: (tr) => (state = tr.state) });
    return handled ? show(state) : null;
  };

  it("ends the list on an empty item with a blank line, so new text is a paragraph", () => {
    expect(enter("- [ ] next\n- [ ] ¦")).toBe("- [ ] next\n\n¦");
    expect(enter("1. a\n2. ¦")).toBe("1. a\n\n¦");
  });

  it("leaves other cases to the normal list continuation", () => {
    expect(enter("- item¦")).toBeNull();
    expect(enter("- a\n  - ¦")).toBeNull();
  });
});

describe("numbered lists renumber themselves", () => {
  const typed = (marked: string, insert: string) => {
    const state = stateOf(marked, [renumberLists]);
    const at = state.selection.main;
    return state
      .update({ changes: { from: at.from, to: at.to, insert }, userEvent: "input.type" })
      .state.doc.toString();
  };

  it("after deleting an item", () => {
    expect(typed("1. a\n‹2. b\n›3. c\n4. d", "")).toBe("1. a\n2. c\n3. d");
  });

  it("after pasting an item in the middle", () => {
    expect(typed("1. a\n¦2. b", "1. new\n")).toBe("1. a\n2. new\n3. b");
  });

  it("but not on Undo", () => {
    const state = stateOf("1. a\n¦", [renumberLists]);
    const next = state.update({ changes: { from: 5, insert: "7. b" }, userEvent: "undo" });
    expect(next.state.doc.toString()).toBe("1. a\n7. b");
  });
});

describe("source tables", () => {
  const table = "| a | 값 |\n|---|:-:|\n| 한글 | 1 |";

  it("lines columns up, counting Korean characters as two columns", () => {
    expect(run(formatTable(), `¦${table}`)).toBe(
      "¦| a    |  값   |\n| ---- | :---: |\n| 한글 |   1   |",
    );
  });

  it("inserts an empty table with the cursor in the first cell", () => {
    expect(run(insertTable(2, 2, true), "¦")).toBe("| ¦    |     |\n| --- | --- |\n|     |     |");
  });

  it("moves between cells with Tab, and Tab in the last cell adds a row", () => {
    expect(run(moveToCell(1, false), "| a¦ | b |\n|---|---|\n| c | d |")).toBe(
      "| a | ‹b› |\n|---|---|\n| c | d |",
    );
    expect(run(moveToCell(1, false), "| a | b |\n|---|---|\n| c | d¦ |")).toBe(
      "| a | b |\n|---|---|\n| c | d |\n| ¦ |  |",
    );
    expect(run(moveToCell(-1, false), "| a | b |\n|---|---|\n| c¦ | d |")).toBe(
      "| a | ‹b› |\n|---|---|\n| c | d |",
    );
    expect(run(moveToCell(1, false), "plain¦")).toBeNull();
  });

  it("inserts and deletes rows and columns, and aligns columns", () => {
    const small = "| a | b |\n|---|---|\n| c¦ | d |";
    expect(run(editTable("insertColumnRight", false), small)).toBe(
      "| a |  | b |\n| --- | --- | --- |\n| c | ¦ | d |",
    );
    expect(run(editTable("deleteColumn", false), small)).toBe("| b |\n| --- |\n| ‹d› |");
    expect(run(editTable("insertRowBelow", false), small)).toBe(
      "| a | b |\n| --- | --- |\n| c | d |\n| ¦ |  |",
    );
    expect(run(editTable("alignRight", false), small)).toBe(
      "| a | b |\n| --: | --- |\n| ‹c› | d |",
    );
    expect(run(editTable("delete", false), `x\n\n${small}\n\ny`)).toBe("x\n\n¦y");
  });
});

describe("image links (O15)", () => {
  it("names pasted images by local date and time", () => {
    expect(pastedImageName("image/png", new Date(2026, 9, 15, 14, 30, 12))).toBe(
      "image-20261015-143012.png",
    );
    expect(pastedImageName("image/jpeg", new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "image-20260102-030405.jpg",
    );
  });

  it("writes links other apps can read, with spaces and Korean in the path", () => {
    expect(imageMarkdown(["assets/회의 사진 (1).png"])).toBe(
      "![](assets/회의%20사진%20%281%29.png)",
    );
  });

  it("puts images dropped on an empty line in a paragraph of their own", () => {
    const state = stateOf("text\n¦\nmore");
    expect(show(state.update(insertImageLinks(state, ["a.png"])).state)).toBe(
      "text\n\n![](a.png)¦\n\nmore",
    );
    const inline = stateOf("see ¦ here");
    expect(show(inline.update(insertImageLinks(inline, ["a.png"])).state)).toBe(
      "see ![](a.png)¦ here",
    );
  });
});
