import { describe, expect, it } from "vitest";
import {
  resolveExtractDisplay,
  type ExtractDisplayInput,
  type ExtractSummaryEntry,
} from "../extractDisclosure";

const content =
  "Hamilton's priority alarms interrupted displays to warn of emergency. " +
  "Garman recognized the errors, shouted \"Go,\" and the mission continued " +
  "successfully despite the cascade of failures in the control room.";

function summaries(count: number): ExtractSummaryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    level: i + 1,
    summary: `summary ${i + 1}`,
    word_count: 10,
  }));
}

function input(overrides: Partial<ExtractDisplayInput> = {}): ExtractDisplayInput {
  return {
    content,
    maxLevel: 3,
    currentLevel: 0,
    summaries: summaries(2),
    summariesEnabled: true,
    isGenerating: false,
    hasError: false,
    ...overrides,
  };
}

describe("resolveExtractDisplay", () => {
  it("shows full text and no stage when the global setting is off", () => {
    const display = resolveExtractDisplay(input({ summariesEnabled: false }));

    expect(display).toEqual({ kind: "full", text: content, stage: null, fraction: null });
  });

  it("shows full text and no stage when the extract has no disclosure levels", () => {
    const display = resolveExtractDisplay(input({ maxLevel: 0, summaries: [] }));

    expect(display.kind).toBe("full");
    expect(display.stage).toBeNull();
    expect(display.text).toBe(content);
  });

  it("uses one AI summary stage for maxLevel 1 and reveals everything after it", () => {
    const first = resolveExtractDisplay(input({ maxLevel: 1, currentLevel: 0, summaries: summaries(1) }));
    expect(first).toMatchObject({ kind: "summary", text: "summary 1", stage: 1 });

    const after = resolveExtractDisplay(input({ maxLevel: 1, currentLevel: 1, summaries: summaries(1) }));
    expect(after).toMatchObject({ kind: "full", text: content, stage: 1 });
  });

  it("walks the default 3-level extract as summary, summary, full", () => {
    const stages = [0, 1, 2, 3].map((currentLevel) =>
      resolveExtractDisplay(input({ maxLevel: 3, currentLevel }))
    );

    expect(stages.map((s) => s.kind)).toEqual(["summary", "summary", "full", "full"]);
    expect(stages.map((s) => s.stage)).toEqual([1, 2, 3, 3]);
    expect(stages[0].text).toBe("summary 1");
    expect(stages[1].text).toBe("summary 2");
    // 3/3 is the full extract, never a partially revealed text.
    expect(stages[2].text).toBe(content);
  });

  it("keeps a partial reveal for 4 levels and ends on the full extract", () => {
    const partial = resolveExtractDisplay(input({ maxLevel: 4, currentLevel: 2 }));
    expect(partial.kind).toBe("partial");
    expect(partial.stage).toBe(3);
    expect(partial.fraction).toBe(0.5);
    expect(partial.text.endsWith("...")).toBe(true);
    expect(partial.text.length).toBeLessThan(content.length);

    const final = resolveExtractDisplay(input({ maxLevel: 4, currentLevel: 3 }));
    expect(final).toMatchObject({ kind: "full", text: content, stage: 4 });
  });

  it("paces partial reveals for 6 levels at 1/3 and 2/3", () => {
    const oneThird = resolveExtractDisplay(input({ maxLevel: 6, currentLevel: 3, summaries: summaries(3) }));
    const twoThirds = resolveExtractDisplay(input({ maxLevel: 6, currentLevel: 4, summaries: summaries(3) }));

    expect(oneThird.kind).toBe("partial");
    expect(oneThird.fraction).toBeCloseTo(1 / 3);
    expect(oneThird.stage).toBe(4);
    expect(twoThirds.fraction).toBeCloseTo(2 / 3);
    expect(twoThirds.stage).toBe(5);
    expect(twoThirds.text.length).toBeGreaterThan(oneThird.text.length);
  });

  it("shows a loading stage before summaries arrive", () => {
    const display = resolveExtractDisplay(
      input({ currentLevel: 0, summaries: [], isGenerating: true })
    );

    expect(display).toMatchObject({ kind: "loading", text: "", stage: 1 });
  });

  it("does not fall through to negative reveal fractions when generation never starts", () => {
    const display = resolveExtractDisplay(input({ currentLevel: 0, summaries: [] }));

    expect(display.kind).toBe("loading");
    expect(display.text).toBe("");
    expect(display.fraction).toBeNull();
  });

  it("falls back to full text when generation finishes without summaries", () => {
    const display = resolveExtractDisplay(
      input({ currentLevel: 0, summaries: [], generationFinished: true })
    );

    expect(display).toEqual({ kind: "full", text: content, stage: null, fraction: null });
  });

  it("surfaces a generation error while keeping the full text available", () => {
    const display = resolveExtractDisplay(
      input({ currentLevel: 0, summaries: [], hasError: true })
    );

    expect(display).toMatchObject({ kind: "error", text: content, stage: 1 });
  });

  it("clamps to the last cached summary when fewer summaries exist than the stage", () => {
    const display = resolveExtractDisplay(
      input({ maxLevel: 6, currentLevel: 2, summaries: summaries(1) })
    );

    expect(display).toMatchObject({ kind: "summary", text: "summary 1", stage: 3 });
  });

  it("treats a negative max level as disclosure disabled", () => {
    const display = resolveExtractDisplay(input({ maxLevel: -1 }));

    expect(display).toEqual({ kind: "full", text: content, stage: null, fraction: null });
  });
});
