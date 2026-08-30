import { describe, expect, it } from "vitest";
import { foldForAlignment, tokenizePlainText } from "../normalize";

describe("normalize", () => {
  it("folds smart quotes and case", () => {
    expect(foldForAlignment("“Hello”")).toBe('"hello"');
    expect(foldForAlignment("Mr. Smith")).toBe("mr. smith");
  });

  it("tokenizes with stable char offsets", () => {
    const tokens = tokenizePlainText("Hello, world!");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ text: "Hello", charStart: 0 });
    expect(tokens[1]).toMatchObject({ text: "world", charStart: 7 });
  });

  it("handles unicode accents", () => {
    const tokens = tokenizePlainText("café résumé");
    expect(tokens.map((t) => t.norm)).toEqual(["café", "résumé"]);
  });
});
