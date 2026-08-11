import { describe, expect, it } from "vitest";
import { addTag, hasTag, normalizeTagInput, removeTag } from "../normalize";

describe("normalizeTagInput", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTagInput("  math  ")).toBe("math");
  });

  it("preserves the entered display casing", () => {
    expect(normalizeTagInput("  FSRS  ")).toBe("FSRS");
  });
});

describe("hasTag", () => {
  it("matches case-insensitively", () => {
    expect(hasTag(["Math", "Physics"], "math")).toBe(true);
    expect(hasTag(["Math"], "PHYSICS")).toBe(false);
  });
});

describe("addTag", () => {
  it("accepts a valid new tag and preserves its casing", () => {
    const result = addTag(["Math"], "  Biology ");
    expect(result.added).toBe(true);
    expect(result.rejected).toBeNull();
    expect(result.tags).toEqual(["Math", "Biology"]);
  });

  it("rejects empty and whitespace-only input without mutating", () => {
    const result = addTag(["Math"], "   ");
    expect(result.added).toBe(false);
    expect(result.rejected).toBe("empty");
    expect(result.tags).toEqual(["Math"]);
  });

  it("rejects case-insensitive duplicates without mutating", () => {
    const result = addTag(["Math"], "math");
    expect(result.added).toBe(false);
    expect(result.rejected).toBe("duplicate");
    expect(result.tags).toEqual(["Math"]);
  });

  it("does not mutate the input array when adding", () => {
    const original = ["Math"];
    const result = addTag(original, "Physics");
    expect(result.tags).toEqual(["Math", "Physics"]);
    expect(original).toEqual(["Math"]);
  });
});

describe("removeTag", () => {
  it("removes exactly the matching tag", () => {
    expect(removeTag(["Math", "Physics"], "Math")).toEqual(["Physics"]);
  });

  it("keeps other tags whose casing differs", () => {
    expect(removeTag(["math", "Math"], "Math")).toEqual(["math"]);
  });
});
