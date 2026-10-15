// Speed check on a ~1 MB document (Phase 2.8). Node is not WebView2, so the
// bounds are generous; the measured times are printed for the plan.

import { describe, expect, it } from "vitest";
import { Renderer } from "./pipeline";

function largeDocument(targetBytes: number): string {
  const section = (n: number) =>
    [
      `## Section ${n} 섹션`,
      "",
      `Paragraph with **bold**, *italic*, \`code\`, a [link](https://example.com/${n}) and 한글 텍스트.`,
      "",
      "- item one",
      "- item two",
      "  - nested",
      "",
      "| A | B |",
      "|---|---|",
      `| ${n} | value |`,
      "",
      "```ts",
      `const value${n} = ${n} * 2;`,
      "```",
      "",
      `Inline math $x_${n}^2$.`,
      "",
    ].join("\n");
  const parts: string[] = [];
  let size = 0;
  for (let n = 0; size < targetBytes; n++) {
    const s = section(n);
    parts.push(s);
    size += s.length;
  }
  return parts.join("\n");
}

describe("render speed", () => {
  it("renders 1 MB, then re-renders an edit quickly", { timeout: 120_000 }, async () => {
    const doc = largeDocument(1_000_000);
    const renderer = new Renderer();
    await new Renderer().render("```ts\nwarm\n```"); // load the highlighter once

    let start = performance.now();
    const first = await renderer.render(doc);
    const firstMs = performance.now() - start;

    // Type a few characters in a paragraph in the middle.
    const middle = doc.indexOf("Paragraph with", doc.length / 2);
    const edited = `${doc.slice(0, middle)}Edited. ${doc.slice(middle)}`;
    start = performance.now();
    const second = await renderer.render(edited);
    const editMs = performance.now() - start;

    console.log(
      `1 MB: first render ${Math.round(firstMs)} ms (${first.blocks.length} blocks), edit ${Math.round(editMs)} ms`,
    );
    expect(second.blocks.length).toBe(first.blocks.length);
    expect(firstMs).toBeLessThan(30_000);
    expect(editMs).toBeLessThan(2_000);
  });
});
