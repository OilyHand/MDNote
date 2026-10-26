// Markdown → sanitized HTML tree (O2). Runs in a Web Worker (see worker.ts) and
// in Node for tests, so it must not touch the DOM.
//
// The document is split into chunks (chunks.ts). Each chunk is rendered on its
// own and cached by its text, so typing re-renders only the chunk being edited.
// The result is a list of top-level blocks; each has its first source line (for
// scroll sync) and a stable key (so the preview only rebuilds changed blocks).
// Elements inside a block carry `data-rl`, their line relative to the block, so
// a cached block stays valid when lines above it move.

import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import { raw } from "hast-util-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import katex from "katex";
import { fromHtml } from "hast-util-from-html";
import GithubSlugger from "github-slugger";
import { toString } from "hast-util-to-string";
import { visit, SKIP } from "unist-util-visit";
import type { Element, ElementContent, Root } from "hast";
import type { Definition, Root as MdastRoot } from "mdast";
import { highlightCode } from "./highlight";
import type { CodeTheme } from "../mdmeta/schema";
import { hasFootnotes, splitChunks, type Chunk } from "./chunks";

export interface RenderedBlock {
  /** Stable while the block's source text (and heading id) stay the same. */
  key: string;
  /** 1-based source line where the block starts. */
  line: number;
  node: Element;
}

export interface RenderResult {
  blocks: RenderedBlock[];
  /** Image sources as written in the document (resolved by the main thread). */
  images: string[];
  counts: TextCounts;
}

/** Counts of the rendered text, for the status bar (O18). */
export interface TextCounts {
  /** Runs of text between spaces, which is how Korean word processors count 어절. */
  words: number;
  /** Characters including spaces, not counting line breaks. */
  characters: number;
  charactersNoSpaces: number;
}

export const NO_COUNTS: TextCounts = { words: 0, characters: 0, charactersNoSpaces: 0 };

export function addCounts(a: TextCounts, b: TextCounts): TextCounts {
  return {
    words: a.words + b.words,
    characters: a.characters + b.characters,
    charactersNoSpaces: a.charactersNoSpaces + b.charactersNoSpaces,
  };
}

/** One rendered top-level element, with its line relative to the chunk (1-based). */
interface ChunkBlock {
  key: string;
  line: number;
  node: Element;
}

/** A heading for the Outline (O13), with its first source line. */
export interface OutlineHeading {
  level: number;
  /** The text as rendered: no `#`, `**` or link addresses. */
  text: string;
  line: number;
}

interface ChunkOutput {
  blocks: ChunkBlock[];
  images: string[];
  counts: TextCounts;
  /** Lines relative to the chunk. */
  headings: OutlineHeading[];
}

/** `<!-- pagebreak -->` on its own line (O9). */
const PAGE_BREAK = /^\s*pagebreak\s*$/i;

const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u"],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "page-break"]],
  },
};

/**
 * Parses raw HTML only when a chunk has some; it is the slowest step otherwise.
 * `file` must be passed, or the HTML parser drops the elements' line positions.
 */
const rehypeRawIfNeeded: Plugin<[], Root> = () => (tree, file) => {
  let found = false;
  visit(tree, "raw", () => {
    found = true;
    return false;
  });
  return found ? (raw(tree, { file }) as Root) : tree;
};

/** Turns `<!-- pagebreak -->` comments into a marker before sanitizing drops comments. */
const rehypePageBreaks: Plugin<[], Root> = () => (tree) => {
  visit(tree, "comment", (node, index, parent) => {
    if (!parent || index === undefined || !PAGE_BREAK.test(node.value)) return;
    const marker: Element = {
      type: "element",
      tagName: "div",
      properties: { className: ["page-break"] },
      children: [],
      position: node.position,
    };
    parent.children.splice(index, 1, marker);
    return [SKIP, index + 1];
  });
};

function classesOf(node: Element): string[] {
  const classes = node.properties.className;
  return Array.isArray(classes) ? classes.map(String) : [];
}

function renderMath(tex: string, displayMode: boolean): ElementContent[] {
  const html = katex.renderToString(tex, {
    displayMode,
    throwOnError: false, // invalid math shows KaTeX's red error message instead
    strict: "ignore",
    output: "htmlAndMathml",
  });
  return fromHtml(html, { fragment: true }).children as ElementContent[];
}

/**
 * Math with KaTeX (`$…$` and `$$…$$`). Written here rather than using
 * rehype-katex: its browser build needs `DOMParser`, which a Web Worker lacks,
 * and the worker died on load (the preview stayed blank). Display math is kept
 * in a `div` with the source position, so scroll sync can find it.
 */
const rehypeMath: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node, index, parent) => {
    if (!parent || index === undefined) return;
    const code =
      node.tagName === "pre"
        ? node.children.find((c): c is Element => c.type === "element" && c.tagName === "code")
        : node.tagName === "code"
          ? node
          : undefined;
    if (!code || !classesOf(code).includes("language-math")) return;
    const display = node.tagName === "pre" || classesOf(code).includes("math-display");
    const rendered = renderMath(toString(code), display);
    if (display) {
      const block: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["math-display"] },
        children: rendered,
        position: node.position,
      };
      parent.children[index] = block;
    } else {
      parent.children.splice(index, 1, ...rendered);
    }
    return [SKIP, index + 1];
  });
};

/**
 * Replaces fenced code with Shiki's highlighted version (math blocks are
 * KaTeX's), in the code block style's colour theme (O4).
 */
const rehypeHighlight: Plugin<[], Root> = () => async (tree, file) => {
  const theme = (file.data as { codeTheme?: CodeTheme }).codeTheme;
  const jobs: Promise<void>[] = [];
  visit(tree, "element", (node, index, parent) => {
    if (node.tagName !== "pre" || !parent || index === undefined) return;
    const code = node.children.find(
      (c): c is Element => c.type === "element" && c.tagName === "code",
    );
    const language = languageOf(code);
    if (!code || !language || language === "math") return;
    jobs.push(
      highlightCode(toString(code), language, theme).then((highlighted) => {
        if (!highlighted) return;
        highlighted.position = node.position;
        parent.children[index] = highlighted;
      }),
    );
    return SKIP;
  });
  await Promise.all(jobs);
};

function languageOf(code: Element | undefined): string | undefined {
  const classes = code?.properties.className;
  if (!Array.isArray(classes)) return undefined;
  const language = classes.find((c) => String(c).startsWith("language-"));
  return language ? String(language).slice("language-".length).toLowerCase() : undefined;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  // Footnote ids get their "user-content-" prefix from the sanitizer only once.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "" })
  .use(rehypeRawIfNeeded)
  .use(rehypePageBreaks)
  .use(rehypeSanitize, schema)
  // Trusted output from here on.
  .use(rehypeMath)
  .use(rehypeHighlight)
  .freeze();

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();

/**
 * The label exactly as written (escapes kept). References match labels as
 * written, but the parser's `label` field has its escapes removed.
 */
function rawLabel(definition: Definition, source: string): string {
  const text = source.slice(
    definition.position?.start.offset ?? 0,
    definition.position?.end.offset ?? 0,
  );
  const start = text.indexOf("[");
  for (let i = start + 1; start >= 0 && i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "]") return text.slice(start + 1, i);
  }
  return definition.label ?? definition.identifier;
}

/** Writes a definition back as one line, so it can be appended to other chunks. */
function definitionLine(definition: Definition, source: string): string {
  const label = rawLabel(definition, source).replace(/\s+/g, " ");
  const url = definition.url.replace(/[\\<>]/g, (c) => `\\${c}`);
  const title = definition.title ? ` "${definition.title.replace(/[\\"]/g, (c) => `\\${c}`)}"` : "";
  return `[${label}]: <${url}>${title}`;
}

/** Block-level elements inside a block get `data-rl` = their line minus the block's line. */
const LINE_MARKED = new Set([
  "p",
  "li",
  "tr",
  "pre",
  "blockquote",
  "table",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "div",
]);

function markRelativeLines(block: Element, blockLine: number) {
  visit(block, "element", (node) => {
    if (node !== block && node.position && LINE_MARKED.has(node.tagName)) {
      node.properties.dataRl = node.position.start.line - blockLine;
    }
  });
}

function collectImages(node: Element, into: Set<string>) {
  visit(node, "element", (child) => {
    const src = child.tagName === "img" ? child.properties.src : undefined;
    if (typeof src === "string" && src) into.add(src);
  });
}

// ---------------------------------------------------------------------------
// Counting the rendered text (O18)
// ---------------------------------------------------------------------------

/** Elements that start a new line of text: their text never runs into their neighbours'. */
const TEXT_BLOCKS = new Set([
  ...LINE_MARKED,
  "ul",
  "ol",
  "td",
  "th",
  "section",
  "dt",
  "dd",
  "details",
  "summary",
  "figure",
  "figcaption",
]);

/** Generated, not written: MathML copies of equations, footnote labels and back links. */
function isGenerated(node: Element): boolean {
  const classes = classesOf(node);
  return (
    classes.includes("katex-mathml") ||
    classes.includes("sr-only") ||
    node.properties.dataFootnoteBackref !== undefined
  );
}

/** The text a reader sees, one line per block. Soft line breaks read as spaces. */
function visibleText(nodes: ElementContent[], into: string[], inPre = false) {
  for (const node of nodes) {
    if (node.type === "text") {
      // KaTeX lays out superscripts with zero-width spaces; they are not text.
      const value = node.value.replace(/[\u200b\ufeff]/g, "");
      into.push(inPre ? value : value.replace(/\s+/g, " "));
    } else if (node.type === "element" && !isGenerated(node)) {
      if (node.tagName === "br") {
        into.push("\n");
        continue;
      }
      const block = TEXT_BLOCKS.has(node.tagName);
      if (block) into.push("\n");
      visibleText(node.children, into, inPre || node.tagName === "pre");
      if (block) into.push("\n");
    }
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function countText(text: string): TextCounts {
  let characters = 0;
  let charactersNoSpaces = 0;
  let words = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    words += trimmed.split(/\s+/).length;
    for (const { segment } of graphemes.segment(trimmed)) {
      characters++;
      if (!/^\s+$/.test(segment)) charactersNoSpaces++;
    }
  }
  return { words, characters, charactersNoSpaces };
}

/** The document's own headings; headings with no text are left out (O13). */
function headingsOf(blocks: ChunkBlock[]): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  for (const block of blocks) {
    const level = /^h([1-6])$/.exec(block.node.tagName);
    if (!level) continue;
    const parts: string[] = [];
    visibleText(block.node.children, parts);
    const text = parts.join("").replace(/\s+/g, " ").trim();
    if (text) headings.push({ level: Number(level[1]), text, line: block.line });
  }
  return headings;
}

function countBlocks(blocks: ChunkBlock[]): TextCounts {
  const parts: string[] = [];
  visibleText(
    blocks.map((b) => b.node),
    parts,
  );
  return countText(parts.join(""));
}

/** FNV-1a, enough to tell blocks apart. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

async function renderChunk(
  text: string,
  definitions: string,
  chunkKey: string,
  codeTheme?: CodeTheme,
): Promise<ChunkOutput> {
  // Definitions go after the chunk so they cannot shift its line numbers.
  const input = definitions ? `${text}\n\n${definitions}\n` : text;
  const tree = (await processor.run(processor.parse(input), { data: { codeTheme } })) as Root;
  const chunkLines = text.split("\n").length;
  const blocks: ChunkBlock[] = [];
  const images = new Set<string>();
  let lastLine = 1;
  tree.children.forEach((child, index) => {
    if (child.type !== "element") return; // whitespace between blocks
    // Anything from the appended definitions (e.g. a line that only looked like one).
    if (child.position && child.position.start.line > chunkLines) return;
    // Generated elements (the footnotes section) have no position: they follow the last block.
    const line = child.position?.start.line ?? lastLine;
    lastLine = child.position?.end.line ?? lastLine;
    markRelativeLines(child, line);
    collectImages(child, images);
    blocks.push({ key: `${chunkKey}.${index}`, line, node: child });
  });
  return {
    blocks,
    images: [...images],
    counts: countBlocks(blocks),
    headings: headingsOf(blocks),
  };
}

/**
 * Renders documents and remembers the result for each chunk. Keep one Renderer
 * per document (and code colour theme) so its cache matches that document.
 */
export class Renderer {
  constructor(readonly codeTheme?: CodeTheme) {}

  private cache = new Map<string, Promise<ChunkOutput>>();
  private definitionCache = new Map<string, string[]>();
  private definitionsKey = "";
  /** Counts of chunks that only occurred in selections. */
  private extraCache = new Map<string, Promise<ChunkOutput>>();

  /**
   * Link reference definitions in a chunk, found by parsing it (only chunks
   * containing "]:" are parsed). Parsing gets the cases a pattern would miss:
   * definitions over several lines, escaped brackets, and lines that only look
   * like a definition because they continue a paragraph.
   */
  private definitionsOf(text: string): string[] {
    if (!text.includes("]:")) return [];
    const cached = this.definitionCache.get(text);
    if (cached) return cached;
    const found: string[] = [];
    visit(parser.parse(text) as MdastRoot, "definition", (node) => {
      found.push(definitionLine(node, text));
    });
    this.definitionCache.set(text, found);
    return found;
  }

  async render(source: string): Promise<RenderResult> {
    // Footnote numbering spans the whole document, so it is rendered in one piece.
    const chunks: Chunk[] = hasFootnotes(source)
      ? [{ text: source, startLine: 0, open: true }]
      : splitChunks(source);
    const definitions =
      chunks.length > 1 ? chunks.flatMap((c) => this.definitionsOf(c.text)).join("\n") : "";
    const definitionsKey = definitions ? hashText(definitions) : "";
    this.definitionsKey = definitionsKey;
    if (this.definitionCache.size > 4 * chunks.length + 100) this.definitionCache.clear();

    const previous = this.cache;
    this.cache = new Map();
    const outputs = await Promise.all(
      chunks.map((chunk) => {
        // An open chunk (unclosed fence) would swallow appended definitions.
        const defs = chunk.open ? "" : definitions;
        const key = `${hashText(chunk.text)}${defs ? `~${definitionsKey}` : ""}`;
        const output =
          previous.get(key) ??
          this.cache.get(key) ??
          renderChunk(chunk.text, defs, key, this.codeTheme);
        this.cache.set(key, output);
        return output;
      }),
    );

    // Heading ids are unique across the document, so they are assigned here.
    const slugger = new GithubSlugger();
    const blocks: RenderedBlock[] = [];
    const images = new Set<string>();
    const seen = new Map<string, number>();
    let counts = NO_COUNTS;
    outputs.forEach((output, i) => {
      counts = addCounts(counts, output.counts);
      output.images.forEach((src) => images.add(src));
      for (const block of output.blocks) {
        let key = block.key;
        if (/^h[1-6]$/.test(block.node.tagName)) {
          const id = slugger.slug(toString(block.node));
          block.node.properties.id = id;
          key += `#${id}`;
        }
        // The same chunk text can occur twice; keep keys unique.
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        blocks.push({
          key: n === 0 ? key : `${key}@${n}`,
          line: chunks[i].startLine + block.line,
          node: block.node,
        });
      }
    });
    return { blocks, images: [...images], counts };
  }

  /**
   * Counts and headings of `source` (the document, or a selection), for the
   * status bar and the Outline, also while the preview is hidden. Chunks the
   * document already rendered are not rendered again.
   */
  async summarize(source: string): Promise<{ counts: TextCounts; headings: OutlineHeading[] }> {
    const chunks: Chunk[] = hasFootnotes(source)
      ? [{ text: source, startLine: 0, open: true }]
      : splitChunks(source);
    if (this.extraCache.size > 500) this.extraCache.clear();
    const outputs = await Promise.all(
      chunks.map((chunk) => {
        const hash = hashText(chunk.text);
        const rendered = this.cache.get(hash) ?? this.cache.get(`${hash}~${this.definitionsKey}`);
        if (rendered) return rendered;
        let output = this.extraCache.get(hash);
        if (!output) {
          output = renderChunk(chunk.text, "", hash);
          this.extraCache.set(hash, output);
        }
        return output;
      }),
    );
    return {
      counts: outputs.reduce((sum, output) => addCounts(sum, output.counts), NO_COUNTS),
      headings: outputs.flatMap((output, i) =>
        output.headings.map((h) => ({ ...h, line: chunks[i].startLine + h.line })),
      ),
    };
  }

  async count(source: string): Promise<TextCounts> {
    return (await this.summarize(source)).counts;
  }
}

/** Renders a document once (tests and one-off use). */
export function renderMarkdown(source: string): Promise<RenderResult> {
  return new Renderer().render(source);
}

/** Exposed for tests: render without splitting into chunks. */
export async function renderWhole(source: string): Promise<RenderResult> {
  const output = await renderChunk(source, "", "whole");
  const slugger = new GithubSlugger();
  for (const block of output.blocks) {
    if (/^h[1-6]$/.test(block.node.tagName))
      block.node.properties.id = slugger.slug(toString(block.node));
  }
  return { blocks: output.blocks, images: output.images, counts: output.counts };
}
