import { describe, expect, it } from "vitest";
import { formatTranscript, parseTimestampReferences, planVideoContext } from "../videoContextPlanner";
import { longTranscript } from "./fixtures/transcript";
describe("video context planning", () => {
  it("retains the complete short transcript", () => {
    const segments = longTranscript.slice(0, 3);
    const plan = planVideoContext({ segments, query: "Summarize", sourceBudgetTokens: 2000 });
    expect(plan.content).toBe(formatTranscript(segments)); expect(plan.coverage).toBe("full");
  });
  it("retrieves late-video facts rather than a head slice", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "Explain quantum entanglement", sourceBudgetTokens: 700 });
    expect(plan.content).toContain("Late finding"); expect(plan.content).toMatch(/\[1:5\d:/); expect(plan.content.length).toBeLessThanOrEqual(2800);
  });
  it("parses timestamps and natural minute references", () => {
    expect(parseTimestampReferences("around 42:00 through 44:00 then at 1:15:30; at minute 15 and 42 minutes")).toEqual([2520, 2640, 4530, 900]);
  });
  it("centers explicit time windows", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "Explain 42:00", sourceBudgetTokens: 1000 });
    expect(plan.mode).toBe("timestamp"); expect(plan.content).toContain("[42:");
  });
  it("centers playback-relative questions", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "What did they just say?", currentTime: 2060, sourceBudgetTokens: 700 });
    expect(plan.mode).toBe("playback"); expect(plan.content).toContain("[34:");
  });
  it("requests synthesis for over-budget whole-video questions", () => {
    expect(planVideoContext({ segments: longTranscript, query: "main arguments across the whole video", sourceBudgetTokens: 700 }).mode).toBe("map-reduce");
  });
  it("merges semantic relevance into lexical ranking", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "an unknown synonym", sourceBudgetTokens: 700, semanticChunks: [{ start: 6900, end: 6960, score: 1, text: "quantum" }] });
    expect(plan.content).toContain("Late finding");
  });
  it("reports empty transcripts and zero evidence honestly", () => {
    expect(planVideoContext({ segments: [], query: "summary", sourceBudgetTokens: 200 }).coverage).toBe("none");
    expect(planVideoContext({ segments: longTranscript, query: "unmatchedword", sourceBudgetTokens: 200 }).content).toBe("");
  });
});
