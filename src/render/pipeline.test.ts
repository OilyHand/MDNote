import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import { Renderer, renderMarkdown } from "./pipeline";

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

describe("counts of the rendered text (O18)", () => {
  const counts = async (source: string) => (await renderMarkdown(source)).counts;

  it("leaves out Markdown syntax", async () => {
    // Rendered: "Title" / "Bold and code, E=mc2"
    expect(await counts("# Title\n\n**Bold** and `code`, $E=mc^2$")).toEqual({
      words: 5,
      characters: 25,
      charactersNoSpaces: 22,
    });
  });

  it("counts Korean words by spaces (어절) and characters as syllables", async () => {
    expect(await counts("한글 문단입니다.\n\n- 목록 하나\n- 둘")).toEqual({
      words: 5,
      characters: 15,
      charactersNoSpaces: 13,
    });
  });

  it("reads a soft line break as a space and keeps blocks apart", async () => {
    expect(await counts("one\ntwo\n\n| a | b |\n|---|---|\n| c | d |")).toEqual({
      words: 6,
      characters: 11,
      charactersNoSpaces: 10,
    });
  });

  it("counts a selection from the chunks already rendered", async () => {
    const renderer = new Renderer();
    const doc = "First paragraph here.\n\nSecond one.\n";
    const whole = await renderer.render(doc);
    expect(await renderer.count(doc)).toEqual(whole.counts);
    expect(await renderer.count("Second one.")).toEqual({
      words: 2,
      characters: 11,
      charactersNoSpaces: 10,
    });
  });

  it("does not count footnote back links or the footnote label", async () => {
    const { counts: c } = await renderMarkdown("Text[^1]\n\n[^1]: Note.");
    // "Text1" and "Note."
    expect(c.words).toBe(2);
  });
});
