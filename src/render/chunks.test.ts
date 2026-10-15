import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import spec from "commonmark-spec";
import { splitChunks } from "./chunks";
import { renderMarkdown, renderWhole, type RenderResult } from "./pipeline";

/** The spec writes tabs as "→". */
const examples = spec.tests.map((t) => ({ ...t, markdown: t.markdown.replace(/→/g, "\t") }));

const html = (result: RenderResult) => result.blocks.map((b) => toHtml(b.node)).join("\n");
const lines = (result: RenderResult) => result.blocks.map((b) => b.line);

describe("chunk splitting", () => {
  it("splits at blank lines between top-level blocks", () => {
    const chunks = splitChunks("# A\n\npara\n\n> quote");
    expect(chunks.map((c) => c.text)).toEqual(["# A\n", "para\n", "> quote"]);
    expect(chunks.map((c) => c.startLine)).toEqual([0, 2, 4]);
  });

  it("keeps fenced code, math blocks and HTML comments with blank lines together", () => {
    for (const doc of [
      "```\na\n\nb\n```\n\nafter",
      "$$\na\n\nb\n$$\n\nafter",
      "<!--\na\n\nb\n-->\n\nafter",
      "<pre>\na\n\nb\n</pre>\n\nafter",
    ]) {
      const chunks = splitChunks(doc);
      expect(chunks).toHaveLength(2);
      expect(chunks[1].text).toBe("after");
    }
  });

  it("keeps a loose list together but splits different lists", () => {
    expect(splitChunks("- a\n\n- b\n\n- c")).toHaveLength(1);
    expect(splitChunks("1. a\n\n2. b")).toHaveLength(1);
    expect(splitChunks("- a\n\n* b")).toHaveLength(2);
  });

  it("keeps indented continuation lines with their block", () => {
    expect(splitChunks("- a\n\n  more\n\n- b")).toHaveLength(1);
    expect(splitChunks("para\n\n    code\n\nnext")).toHaveLength(2);
  });

  it("marks a chunk that ends inside an unclosed fence", () => {
    const chunks = splitChunks("intro\n\n```\nnever closed\n\ntext");
    expect(chunks.at(-1)?.open).toBe(true);
  });
});

describe("chunked rendering matches whole-document rendering", () => {
  it("for every CommonMark spec example", async () => {
    const mismatches: number[] = [];
    for (const example of examples) {
      const [chunked, whole] = await Promise.all([
        renderMarkdown(example.markdown),
        renderWhole(example.markdown),
      ]);
      if (html(chunked) !== html(whole)) mismatches.push(example.number);
    }
    expect(mismatches).toEqual([]);
  });

  it("for all spec examples joined into one document", { timeout: 120_000 }, async () => {
    const doc = examples.map((e) => e.markdown).join("\n\n");
    const [chunked, whole] = await Promise.all([renderMarkdown(doc), renderWhole(doc)]);
    expect(lines(chunked)).toEqual(lines(whole));
    expect(html(chunked)).toBe(html(whole));
  });

  it("resolves a reference whose definition is in another chunk", async () => {
    const doc = "See [the docs][d].\n\nMore text.\n\n[d]: https://example.com/docs";
    const out = html(await renderMarkdown(doc));
    expect(out).toContain('<a href="https://example.com/docs">the docs</a>');
  });
});
