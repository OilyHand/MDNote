import { describe, expect, it } from "vitest";
import { baseName, encodingLabel, nextUntitledNumber, samePath } from "./naming";

describe("naming", () => {
  it("takes the file name from Windows and Unix paths", () => {
    expect(baseName("C:\\Notes\\회의록.md")).toBe("회의록.md");
    expect(baseName("C:/Notes/a.md")).toBe("a.md");
    expect(baseName("a.md")).toBe("a.md");
  });

  it("compares Windows paths without regard to case or slash direction", () => {
    expect(samePath("C:\\Notes\\A.md", "c:/notes/a.MD")).toBe(true);
    expect(samePath("C:\\Notes\\a.md", "C:\\Notes\\b.md")).toBe(false);
  });

  it("reuses the lowest free Untitled number", () => {
    expect(nextUntitledNumber([])).toBe(1);
    expect(nextUntitledNumber([1, 2, 4])).toBe(3);
  });

  it("labels encodings", () => {
    expect(encodingLabel({ kind: "utf8Bom" })).toBe("UTF-8 BOM");
    expect(encodingLabel({ kind: "ansi", codepage: 949 })).toBe("Windows-949");
  });
});
