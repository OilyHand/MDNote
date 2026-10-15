// Splits a Markdown document into top-level chunks that can be rendered on their
// own (Phase 2.2). Rendering a chunk alone must give the same HTML as rendering
// it inside the whole document; chunks.test.ts checks that against every
// CommonMark spec example. When in doubt the splitter keeps lines together:
// a larger chunk is always correct, only slower.
//
// Why: remark's parser slows down faster than linearly with document size
// (1 MB took ~21 s in one piece but ~3.4 s in 90 KB pieces), and chunks let the
// worker re-render only the chunk being edited.

export interface Chunk {
  text: string;
  /** 0-based line index of the chunk's first line in the document. */
  startLine: number;
  /** The chunk ends inside an unclosed code fence, math block or HTML block. */
  open: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE = /^ {0,3}\$\$/;
/** A list item may be indented by up to 3 spaces and still start a top-level list. */
const LIST_MARKER = /^ {0,3}(?:([*+-])|\d{1,9}([.)]))(?:[ \t]|$)/;

/** HTML blocks that may contain blank lines (CommonMark types 1–5) and what ends them. */
const LONG_HTML: [RegExp, RegExp][] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^ {0,3}<!--/, /-->/],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Za-z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];

/** "-", "*", "+", "." or ")" for a line that starts a list item, otherwise null. */
function listMarker(line: string): string | null {
  const match = LIST_MARKER.exec(line);
  return match ? (match[1] ?? match[2]) : null;
}

export function splitChunks(source: string): Chunk[] {
  const lines = source.split("\n");
  const chunks: Chunk[] = [];
  let chunkStart = 0;
  let fence: { char: string; length: number } | null = null;
  let mathOpen = false;
  let htmlEnd: RegExp | null = null;
  let previousBlank = false;
  /** The marker of the list the current top-level block belongs to, if any. */
  let currentList: string | null = null;

  const close = (end: number, open: boolean) => {
    chunks.push({ text: lines.slice(chunkStart, end).join("\n"), startLine: chunkStart, open });
    chunkStart = end;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      const closing = FENCE.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        if (line.trim() === closing[0].trim()) fence = null;
      }
      continue;
    }
    if (mathOpen) {
      if (MATH_FENCE.test(line)) mathOpen = false;
      continue;
    }
    if (htmlEnd) {
      if (htmlEnd.test(line)) htmlEnd = null;
      continue;
    }

    if (line.trim() === "") {
      previousBlank = true;
      continue;
    }

    const atColumnZero = !/^\s/.test(line);
    const marker = listMarker(line);
    const startsTopLevelBlock = previousBlank && atColumnZero;

    // A blank line followed by a block at column 0 is a safe place to split,
    // unless the block continues the same list (a loose list). Indented lines
    // may continue a list item, so they never split, and they keep the list
    // known unless they start a list themselves.
    if (startsTopLevelBlock && i > chunkStart && !(marker && marker === currentList)) {
      close(i, false);
    }
    if (startsTopLevelBlock || i === chunkStart) currentList = marker;
    else if (marker) currentList = marker;
    previousBlank = false;

    const opening = FENCE.exec(line);
    if (opening) {
      // A backtick fence's info string may not contain backticks.
      const info = line.slice(opening[0].length);
      if (opening[1][0] === "~" || !info.includes("`")) {
        fence = { char: opening[1][0], length: opening[1].length };
      }
      continue;
    }
    if (MATH_FENCE.test(line)) {
      // "$$ x $$" on one line closes itself.
      const rest = line.trimStart().slice(2);
      if (!rest.includes("$$")) mathOpen = true;
      continue;
    }
    for (const [start, end] of LONG_HTML) {
      if (start.test(line)) {
        if (!end.test(line.replace(start, ""))) htmlEnd = end;
        break;
      }
    }
  }

  close(lines.length, Boolean(fence || mathOpen || htmlEnd));
  return mergeUnbalancedHtml(chunks.filter((c, i) => c.text.trim() !== "" || i === 0));
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Open minus closed HTML tags, ignoring code (tags followed by ":" or "@" are autolinks). */
function htmlBalance(text: string): number {
  const withoutCode = text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/`+[^`\n]*`+/g, "");
  let balance = 0;
  for (const match of withoutCode.matchAll(/<(\/?)([A-Za-z][\w-]*)(?=[\s/>])[^<>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (VOID_ELEMENTS.has(name.toLowerCase()) || selfClosing) continue;
    balance += closing ? -1 : 1;
  }
  return balance;
}

/**
 * Raw HTML can wrap Markdown across blank lines (`<div>`, blank line, text,
 * blank line, `</div>`). The HTML parser joins those into one element, so a
 * chunk that opens more tags than it closes is merged with the following
 * chunks until the tags balance.
 */
function mergeUnbalancedHtml(chunks: Chunk[]): Chunk[] {
  const merged: Chunk[] = [];
  let balance = 0;
  for (const chunk of chunks) {
    const last = merged.at(-1);
    if (last && balance > 0) {
      last.text = `${last.text}\n${chunk.text}`;
      last.open = chunk.open;
    } else {
      merged.push({ ...chunk });
      balance = 0;
    }
    balance += htmlBalance(chunk.text);
  }
  return merged;
}

/** Footnote numbers depend on the whole document, so such documents render in one piece. */
export function hasFootnotes(source: string): boolean {
  return /^ {0,3}\[\^[^\]]+\]:/m.test(source);
}
