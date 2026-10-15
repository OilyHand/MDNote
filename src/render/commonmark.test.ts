// Phase 2.8: MDNote's renderer against the official CommonMark examples.
//
// MDNote deliberately differs from plain CommonMark in a few ways, listed below
// with the reason. Every other example must match the spec's HTML exactly, after
// normalizing serialization details (entity spelling, whitespace between tags)
// and removing MDNote's own data-rl attributes and heading ids. A new
// difference fails the test, so it has to be fixed or explained here.

import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import spec from "commonmark-spec";
import { renderWhole } from "./pipeline";

/** Sections whose examples are raw HTML, which MDNote sanitizes on purpose. */
const SANITIZED_SECTIONS = new Set(["HTML blocks", "Raw HTML"]);

const KNOWN_DIFFERENCES: Record<string, number[]> = {
  // Raw HTML goes through a real HTML parser: unclosed tags are closed and
  // entities in attributes are decoded. The page in the browser is the same.
  "raw HTML is parsed into a real document": [21, 31, 344, 476, 477, 494, 642, 643],
  // Unknown tags, HTML comments and links with unknown schemes are removed.
  sanitizing: [201, 308, 309, 491, 500, 524, 536, 597, 598, 599, 601],
  // GitHub Flavored Markdown turns bare URLs and e-mail addresses into links.
  "GFM autolinks": [602, 606, 608, 611, 612],
  // Fenced code with a known language is highlighted by Shiki.
  "code highlighting": [142, 143],
};

/** Normalizes both sides the same way, so only real differences remain. */
function normalize(html: string): string {
  // Entities first: whitespace between tags is collapsed afterwards, on both sides alike.
  return html
    .replace(/ data-rl="\d+"/g, "")
    .replace(/<(h[1-6]) id="[^"]*">/g, "<$1>")
    .replace(/&#x22;|&quot;/g, '"')
    .replace(/&#x26;/g, "&amp;")
    .replace(/&#x3C;/g, "&lt;")
    .replace(/&#x3E;|&gt;/g, ">")
    .replace(/>\s+</g, "><")
    .replace(/\s+$/g, "")
    .replace(/<br>/g, "<br />")
    .replace(/<hr>/g, "<hr />")
    .replace(/<img ([^>]*?) ?\/?>/g, "<img $1 />");
}

async function differences(): Promise<number[]> {
  const failed: number[] = [];
  for (const example of spec.tests) {
    if (SANITIZED_SECTIONS.has(example.section)) continue;
    const markdown = example.markdown.replace(/→/g, "\t");
    const { blocks } = await renderWhole(markdown);
    const actual = normalize(blocks.map((b) => toHtml(b.node)).join("\n"));
    const expected = normalize(example.html.replace(/→/g, "\t"));
    if (actual !== expected) failed.push(example.number);
  }
  return failed;
}

describe("CommonMark spec examples", () => {
  it("render like the spec, apart from MDNote's deliberate differences", async () => {
    const failed = await differences();
    const known = Object.values(KNOWN_DIFFERENCES)
      .flat()
      .sort((a, b) => a - b);
    const checked = spec.tests.filter((t) => !SANITIZED_SECTIONS.has(t.section)).length;
    console.log(
      `CommonMark: ${checked - failed.length}/${checked} match exactly; the rest are known.`,
    );
    expect(failed).toEqual(known);
  });
});
