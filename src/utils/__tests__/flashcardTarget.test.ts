import { describe, expect, it } from "vitest";
import { resolveFlashcardTarget } from "../flashcardTarget";

const baseSettings = {
  flashcardCountMode: "fixed" as const,
  flashcardFixedCount: 5,
  flashcardAutoMin: 3,
  flashcardAutoMax: 25,
};

describe("resolveFlashcardTarget", () => {
  it("returns the fixed count in fixed mode", () => {
    const result = resolveFlashcardTarget(baseSettings, "irrelevant content");
    expect(result).toEqual({ mode: "fixed", count: 5 });
  });

  it("clamps to autoMin for short content in auto mode", () => {
    const settings = { ...baseSettings, flashcardCountMode: "auto" as const };
    const result = resolveFlashcardTarget(settings, "a short excerpt with a few words only");
    expect(result.mode).toBe("auto");
    expect(result.count).toBe(3);
  });

  it("clamps to autoMax for very long content in auto mode", () => {
    const settings = { ...baseSettings, flashcardCountMode: "auto" as const };
    const result = resolveFlashcardTarget(settings, 100_000);
    expect(result.mode).toBe("auto");
    expect(result.count).toBe(25);
  });

  it("scales with content size within bounds in auto mode", () => {
    const settings = { ...baseSettings, flashcardCountMode: "auto" as const };
    // 1200 words / 120 words-per-card = 10, within [3, 25]
    const result = resolveFlashcardTarget(settings, 1200);
    expect(result.mode).toBe("auto");
    expect(result.count).toBe(10);
  });

  it("respects an explicit override even when settings say fixed", () => {
    const result = resolveFlashcardTarget(baseSettings, 1200, { mode: "auto", autoMin: 5, autoMax: 8 });
    expect(result).toEqual({ mode: "auto", count: 8 });
  });

  it("respects a fixed override count", () => {
    const result = resolveFlashcardTarget(baseSettings, "content", { mode: "fixed", fixedCount: 12 });
    expect(result).toEqual({ mode: "fixed", count: 12 });
  });
});
