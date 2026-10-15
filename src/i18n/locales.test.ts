import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

type Tree = { [key: string]: string | Tree };

/** Flattens nested keys to "a.b.c" -> value. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else flatten(value, path).forEach((v, k) => out.set(k, v));
  }
  return out;
}

/** Plural forms differ per language (Korean has only "_other"), so compare base keys. */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKeys = (strings: Map<string, string>) =>
  new Set([...strings.keys()].map((k) => k.replace(PLURAL, "")));
const variables = (text: string) => new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

const english = flatten(en);
const korean = flatten(ko);

describe("UI translations", () => {
  it("have the same keys in English and Korean", () => {
    expect([...baseKeys(korean)].sort()).toEqual([...baseKeys(english)].sort());
  });

  it("have no empty strings", () => {
    for (const [key, value] of [...english, ...korean]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same {{variables}} in both languages", () => {
    for (const [key, value] of english) {
      const koreanKey = korean.has(key) ? key : key.replace(PLURAL, "_other");
      const translated = korean.get(koreanKey);
      if (translated === undefined) continue; // reported by the key test
      const expected = new Set(variables(value));
      expected.delete("count"); // Korean plurals may leave the count implicit
      for (const name of expected) {
        expect(variables(translated).has(name), `${key}: {{${name}}}`).toBe(true);
      }
    }
  });
});
