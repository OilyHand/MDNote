import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import { renderMarkdown } from "./pipeline";

async function html(markdown: string): Promise<string> {
  const { blocks } = await renderMarkdown(markdown);
  return blocks.map((b) => toHtml(b.node)).join("\n");
}

describe("Markdown rendering", () => {
  it("renders GitHub Flavored Markdown", async () => {
    const out = await html(
      [
        "| a | b |",
        "|---|:-:|",
        "| 1 | 2 |",
        "",
        "- [x] done",
        "- [ ] todo",
        "",
        "~~gone~~ and https://example.com",
        "",
        "Footnote[^1].",
        "",
        "[^1]: The note.",
      ].join("\n"),
    );
    expect(out).toContain("<table>");
    expect(out).toContain('<td align="center">2</td>');
    expect(out).toMatch(/<input type="checkbox" checked disabled>/);
    expect(out).toContain("<del>gone</del>");
    expect(out).toContain('<a href="https://example.com">');
    expect(out).toContain('class="footnotes"');
  });

  it("renders math with KaTeX", async () => {
    const out = await html("Inline $E=mc^2$ and\n\n$$\n\\frac{a}{b}\n$$");
    expect(out).toContain('class="katex"');
    expect(out).toContain("katex-display");
  });

  it("highlights known languages and keeps unknown ones plain", async () => {
    const known = await html("```ts\nconst x: number = 1;\n```");
    expect(known).toContain('class="shiki');
    expect(known).toContain("--shiki-dark");
    const unknown = await html("```nosuchlanguage\nplain\n```");
    expect(unknown).toContain('<code class="language-nosuchlanguage">plain\n</code>');
  });

  it("removes scripts, event handlers and javascript: links", async () => {
    const out = await html(
      '<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n[click](javascript:alert(1)) <u>under</u>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("<u>under</u>");
  });

  it("turns a pagebreak comment into a marker (O9)", async () => {
    const out = await html("before\n\n<!-- pagebreak -->\n\nafter");
    expect(out).toContain('<div class="page-break"></div>');
  });

  it("gives headings ids, including Korean ones", async () => {
    const out = await html("## 한글 제목\n\n## Hello World");
    expect(out).toContain('id="한글-제목"');
    expect(out).toContain('id="hello-world"');
  });

  it("reports block lines and keeps keys of unchanged blocks", async () => {
    const first = await renderMarkdown("# Title\n\nPara one.\n\nPara two.\n");
    expect(first.blocks.map((b) => b.line)).toEqual([1, 3, 5]);

    const edited = await renderMarkdown("# Title\n\nPara one, edited.\n\nPara two.\n");
    expect(edited.blocks[0].key).toBe(first.blocks[0].key);
    expect(edited.blocks[1].key).not.toBe(first.blocks[1].key);
    expect(edited.blocks[2].key).toBe(first.blocks[2].key);
  });

  it("gives identical blocks distinct keys", async () => {
    const { blocks } = await renderMarkdown("same\n\nsame\n");
    expect(new Set(blocks.map((b) => b.key)).size).toBe(2);
  });

  it("marks lines inside blocks relative to the block", async () => {
    const { blocks } = await renderMarkdown("intro\n\n- one\n- two\n- three\n");
    const list = toHtml(blocks[1].node);
    expect(blocks[1].line).toBe(3);
    expect(list).toContain('<li data-rl="2">three</li>');
  });

  it("collects image sources for the main thread to resolve", async () => {
    const { images } = await renderMarkdown("![a](assets/one.png) ![b](https://example.com/b.png)");
    expect(images).toEqual(["assets/one.png", "https://example.com/b.png"]);
  });
});
