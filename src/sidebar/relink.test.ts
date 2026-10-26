import { describe, expect, it } from "vitest";
import { companionMoves, joinPath, relativeLinks, relativePath, relinks } from "./relink";

describe("paths", () => {
  it("joins and resolves relative paths", () => {
    expect(joinPath("C:\\notes\\a", "../img/x.png")).toBe("C:\\notes\\img\\x.png");
    expect(joinPath("C:\\notes", "./assets/x.png")).toBe("C:\\notes\\assets\\x.png");
  });

  it("finds the way from one folder to a file", () => {
    expect(relativePath("C:\\notes\\deep\\er", "C:\\notes\\img\\x.png")).toBe("../../img/x.png");
    expect(relativePath("C:\\Notes", "c:\\notes\\x.png")).toBe("x.png");
    expect(relativePath("C:\\notes", "D:\\x.png")).toBeNull();
  });
});

describe("links a move would break", () => {
  const text = [
    "![shot](assets/shot%201.png) and [other](../other.md#part)",
    "![web](https://a.b/x.png) [top](#heading) ![abs](C:/x.png)",
    "```",
    "![in code](assets/no.png)",
    "```",
  ].join("\n");

  it("finds only relative addresses outside code", () => {
    expect(relativeLinks(text).map((l) => l.path)).toEqual(["assets/shot 1.png", "../other.md"]);
  });

  it("rewrites them for a note moved into a subfolder", () => {
    const changes = relinks(text, "C:\\notes\\a\\n.md", "C:\\notes\\a\\sub\\n.md", []);
    expect(changes.map((c) => c.insert)).toEqual(["../assets/shot%201.png", "../../other.md#part"]);
    expect(changes[0].target).toBe("C:\\notes\\a\\assets\\shot 1.png");
  });

  it("leaves links alone when the note stays in its folder", () => {
    expect(relinks(text, "C:\\notes\\n.md", "C:\\notes\\renamed.md", [])).toEqual([]);
  });

  it("follows the note's own image folder when it is renamed", () => {
    const note = "![a](n.assets/a.png)";
    const moves = companionMoves("C:\\notes\\n.md", "C:\\notes\\회의.md");
    expect(relinks(note, "C:\\notes\\n.md", "C:\\notes\\회의.md", moves)[0].insert).toBe(
      "회의.assets/a.png",
    );
  });
});
