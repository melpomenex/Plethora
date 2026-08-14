import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_BUDGET,
  MIN_TOKEN_BUDGET,
  chunkTextByTokens,
  estimateTokens,
  resolveTokenBudget,
} from "../chunkTextByTokens";

/** Chars per estimated token, mirroring the module's heuristic. */
const CHARS_PER_TOKEN = 4;
const maxChars = (budget: number) => budget * CHARS_PER_TOKEN;

describe("resolveTokenBudget", () => {
  it("defaults to the documented budget", () => {
    expect(resolveTokenBudget()).toBe(DEFAULT_TOKEN_BUDGET);
  });

  it("clamps a below-floor budget up to the floor", () => {
    expect(resolveTokenBudget(10)).toBe(MIN_TOKEN_BUDGET);
    expect(resolveTokenBudget(0)).toBe(MIN_TOKEN_BUDGET);
    expect(resolveTokenBudget(-500)).toBe(MIN_TOKEN_BUDGET);
  });

  it("passes an above-floor budget through", () => {
    expect(resolveTokenBudget(2000)).toBe(2000);
  });
});

describe("chunkTextByTokens", () => {
  it("returns nothing for blank input", () => {
    expect(chunkTextByTokens("")).toEqual([]);
    expect(chunkTextByTokens("   \n\n  ")).toEqual([]);
  });

  it("returns a single trimmed chunk when the text already fits", () => {
    expect(chunkTextByTokens("  Short enough.  ")).toEqual(["Short enough."]);
  });

  it("splits at paragraph boundaries when it can", () => {
    const budget = MIN_TOKEN_BUDGET;
    const para = (word: string) => `${word} `.repeat(600).trim(); // ~3000 chars
    const text = `${para("alpha")}\n\n${para("beta")}`;

    const chunks = chunkTextByTokens(text, budget);

    expect(chunks.length).toBe(2);
    expect(chunks[0].startsWith("alpha")).toBe(true);
    expect(chunks[1].startsWith("beta")).toBe(true);
    // Nothing was lost or duplicated at the seam.
    expect(chunks[0]).not.toContain("beta");
    expect(chunks[1]).not.toContain("alpha");
  });

  it("packs several small paragraphs into one chunk", () => {
    const text = ["one", "two", "three"].join("\n\n");
    expect(chunkTextByTokens(text, MIN_TOKEN_BUDGET)).toEqual(["one\n\ntwo\n\nthree"]);
  });

  it("falls back to sentence boundaries inside an oversized paragraph", () => {
    const budget = MIN_TOKEN_BUDGET;
    // One paragraph, many sentences, well over the 4000-char budget.
    const sentence = `${"word ".repeat(60).trim()}.`;
    const text = Array.from({ length: 40 }, () => sentence).join(" ");

    const chunks = chunkTextByTokens(text, budget);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars(budget));
    }
    // Sentence-level splitting keeps terminal punctuation attached.
    expect(chunks.every((c) => c.endsWith("."))).toBe(true);
  });

  it("hard-splits a single sentence that exceeds the budget", () => {
    const budget = MIN_TOKEN_BUDGET;
    const monster = "x".repeat(maxChars(budget) * 2 + 100);

    const chunks = chunkTextByTokens(monster, budget);

    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars(budget));
    }
    expect(chunks.join("")).toBe(monster);
  });

  it("honours the floor rather than an absurdly small budget", () => {
    const text = "y".repeat(maxChars(MIN_TOKEN_BUDGET));
    // A budget of 1 token would otherwise produce thousands of 4-char chunks.
    expect(chunkTextByTokens(text, 1)).toEqual([text]);
  });

  it("keeps every chunk within budget for mixed structure", () => {
    const budget = MIN_TOKEN_BUDGET;
    const text = [
      "Tiny intro.",
      "z".repeat(maxChars(budget) + 500),
      ["A sentence.", "Another sentence.", "w".repeat(maxChars(budget) + 1)].join(" "),
    ].join("\n\n");

    const chunks = chunkTextByTokens(text, budget);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.trim()).not.toBe("");
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(budget);
    }
  });
});
