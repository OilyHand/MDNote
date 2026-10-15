// `$…$` and `$$…$$` math for CodeMirror's Markdown parser, so the source editor
// colours math like code and doesn't misread it (a "=" line inside a math block
// used to turn the lines above it into a heading).

import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

const DOLLAR = 36;
const MATH_FENCE = /^ {0,3}\$\$/;

export const markdownMath: MarkdownConfig = {
  defineNodes: [
    { name: "MathBlock", block: true, style: tags.monospace },
    { name: "InlineMath", style: tags.monospace },
  ],
  parseBlock: [
    {
      name: "MathBlock",
      before: "FencedCode",
      parse(cx, line) {
        if (!MATH_FENCE.test(line.text)) return false;
        const from = cx.lineStart;
        // "$$ x $$" on one line closes itself.
        const closesOnSameLine = line.text.trimStart().slice(2).includes("$$");
        if (!closesOnSameLine) {
          while (cx.nextLine()) {
            if (MATH_FENCE.test(line.text)) break;
          }
        }
        const to = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt("MathBlock", from, to));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1;
        // Like remark-math: no space right inside the dollars.
        if (cx.char(pos + 1) === 32) return -1;
        for (let end = pos + 1; end < cx.end; end++) {
          const char = cx.char(end);
          if (char === 92) {
            end++; // skip the escaped character
          } else if (char === DOLLAR && cx.char(end - 1) !== 32) {
            return cx.addElement(cx.elt("InlineMath", pos, end + 1));
          }
        }
        return -1;
      },
    },
  ],
};
