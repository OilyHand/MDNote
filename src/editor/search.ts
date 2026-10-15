// Find, Replace and Go to line (O8): CodeMirror's search panel, at the top of
// the editor, in the UI language.

import { EditorState } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  search,
} from "@codemirror/search";

export const searchSupport = [
  search({ top: true }),
  keymap.of([
    {
      key: "F3",
      run: findNext,
      shift: findPrevious,
      scope: "editor search-panel",
      preventDefault: true,
    },
    { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
  ]),
];

const ENGLISH: Record<string, string> = {
  next: "Next",
  previous: "Previous",
  all: "Select All",
  "match case": "Match case",
  regexp: "Regular expression",
  "by word": "Whole words",
  replace: "Replace",
  "replace all": "Replace All",
  close: "Close",
  go: "Go",
};

const KOREAN: Record<string, string> = {
  Find: "찾기",
  Replace: "바꾸기",
  next: "다음",
  previous: "이전",
  all: "모두 선택",
  "match case": "대/소문자 구분",
  regexp: "정규식",
  "by word": "단어 단위로",
  replace: "바꾸기",
  "replace all": "모두 바꾸기",
  close: "닫기",
  "current match": "현재 항목",
  "on line": "줄",
  "replaced match on line $": "$줄의 항목을 바꿨습니다",
  "replaced $ matches": "$개 항목을 바꿨습니다",
  "Go to line": "이동할 줄 번호",
  go: "이동",
};

/** The editor's own words (search panel, Go to line) in the UI language. */
export function editorPhrases(language: string) {
  return EditorState.phrases.of(language === "ko" ? KOREAN : ENGLISH);
}

function focusField(view: EditorView, name: "search" | "replace") {
  const field = view.dom.querySelector<HTMLInputElement>(`.cm-search input[name=${name}]`);
  field?.focus();
  field?.select();
}

export function openFind(view: EditorView) {
  openSearchPanel(view);
  focusField(view, "search");
}

export function openReplace(view: EditorView) {
  openSearchPanel(view);
  focusField(view, "replace");
}

export function openGoToLine(view: EditorView) {
  gotoLine(view);
}
