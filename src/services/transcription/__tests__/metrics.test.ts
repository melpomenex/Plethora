import { describe, expect, it } from "vitest";
import { computeCER, computeWER, levenshteinDistance } from "../benchmark/metrics";

describe("levenshteinDistance", () => {
  it("returns zero for identical strings", () => {
    expect(levenshteinDistance("kitten", "kitten")).toBe(0);
  });

  it("counts insertions and deletions", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

describe("computeWER", () => {
  it("returns zero for identical transcripts", () => {
    expect(computeWER("hello world", "hello world")).toBe(0);
  });

  it("counts substituted words", () => {
    expect(computeWER("the cat sat", "the dog sat")).toBeCloseTo(1 / 3);
  });

  it("returns 1 when reference is empty but hypothesis is not", () => {
    expect(computeWER("", "hello")).toBe(1);
  });
});

describe("computeCER", () => {
  it("returns zero for identical strings", () => {
    expect(computeCER("transcribe", "transcribe")).toBe(0);
  });

  it("counts character edits", () => {
    expect(computeCER("abc", "adc")).toBeCloseTo(1 / 3);
  });

  it("returns 1 when reference is empty but hypothesis is not", () => {
    expect(computeCER("", "x")).toBe(1);
  });
});
