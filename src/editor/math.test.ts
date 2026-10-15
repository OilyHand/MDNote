import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { markdownMath } from "./math";

const withMath = parser.configure([markdownMath]);

function nodeNames(text: string): string[] {
  const names: string[] = [];
  withMath.parse(text).iterate({ enter: (node) => void names.push(node.name) });
  return names;
}

describe("math in the source editor", () => {
  it("reads a $$ block as math, so a '=' line inside is not a heading underline", () => {
    const names = nodeNames("$$\na\n=\nb\n$$\n\nafter");
    expect(names).toContain("MathBlock");
    expect(names).not.toContain("SetextHeading1");
    expect(names).toContain("Paragraph");
  });

  it("reads $…$ as inline math, but not prices like $5 and $6", () => {
    expect(nodeNames("Energy $E=mc^2$ here")).toContain("InlineMath");
    expect(nodeNames("costs $5 and $6 now")).not.toContain("InlineMath");
  });
});
