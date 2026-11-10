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
  it("requests complete-coverage synthesis for ordinary over-budget questions on a complete-transcript turn", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "Explain quantum entanglement", sourceBudgetTokens: 700, requireCompleteCoverage: true });
    expect(plan.mode).toBe("map-reduce");
    expect(plan.chunkCount).toBeGreaterThan(0);
  });
  it("keeps bounded strategies for timestamp and playback questions on a complete-transcript turn", () => {
    const timestamped = planVideoContext({ segments: longTranscript, query: "Explain 42:00", sourceBudgetTokens: 1000, requireCompleteCoverage: true });
    expect(timestamped.mode).toBe("timestamp");
    expect(timestamped.content).toContain("[42:");
    const playback = planVideoContext({ segments: longTranscript, query: "What did they just say?", currentTime: 2060, sourceBudgetTokens: 700, requireCompleteCoverage: true });
    expect(playback.mode).toBe("playback");
    expect(playback.content).toContain("[34:");
  });
  it("falls back to retrieval windows when hierarchical synthesis is disabled or unavailable", () => {
    const fallback = planVideoContext({ segments: longTranscript, query: "Explain quantum entanglement", sourceBudgetTokens: 700, requireCompleteCoverage: true, allowMapReduce: false });
    expect(fallback.mode).toBe("retrieval");
    expect(fallback.content).toContain("Late finding");
    const summaryFallback = planVideoContext({ segments: longTranscript, query: "main arguments across the whole video", sourceBudgetTokens: 700, allowMapReduce: false });
    expect(summaryFallback.mode).toBe("retrieval");
  });
  it("merges semantic relevance into lexical ranking", () => {
    const plan = planVideoContext({ segments: longTranscript, query: "an unknown synonym", sourceBudgetTokens: 700, semanticChunks: [{ start: 6900, end: 6960, score: 1, text: "quantum" }] });
    expect(plan.content).toContain("Late finding");
  });
  it("reports empty transcripts and zero evidence honestly", () => {
    expect(planVideoContext({ segments: [], query: "summary", sourceBudgetTokens: 200 }).coverage).toBe("none");
    expect(planVideoContext({ segments: longTranscript, query: "unmatchedword", sourceBudgetTokens: 200 }).content).toBe("");
  });

  describe("broadened whole-source action matching", () => {
    it.each([
      "Key points",
      "Summarize",
      "Outline document",
      "Examine argument",
      "Analyze argument",
      "Quiz me",
      "Make flashcards",
      "Key terms",
      "What are the main claims in this video?",
      "Give me a high-level overview of the entire video",
    ])("routes '%s' to map-reduce when over budget", (query) => {
      const plan = planVideoContext({
        segments: longTranscript,
        query,
        sourceBudgetTokens: 700,
      });
      expect(plan.mode).toBe("map-reduce");
    });
  });

  describe("direct full-transcript inclusion when fitting budget", () => {
    it("returns mode full and coverage full for a 25,000-token transcript in a 45,000-token budget", () => {
      // 100 segments with ~250 tokens (~1000 chars) each -> 25,000 tokens / 100,000 chars
      const segments = Array.from({ length: 100 }, (_, i) => ({
        start: i * 60,
        duration: 55,
        text: `Segment ${i}: Discussion of scientific finding number ${i} with substantial detailed analysis.`,
      }));

      const plan = planVideoContext({
        segments,
        query: "Key points",
        sourceBudgetTokens: 45000,
      });

      expect(plan.mode).toBe("full");
      expect(plan.coverage).toBe("full");
      expect(plan.content).toContain("[00:00]");
      expect(plan.content).toContain(`Segment 99`);
    });
  });

  describe("whole-transcript semantic retrieval for unbounded factual queries", () => {
    it("retrieves late-video evidence across entire transcript even when paused at early currentTime", () => {
      const plantSegment = {
        start: 6300, // 1h 45m
        duration: 60,
        text: "The speaker discusses plants producing chemical signaling networks across mycelial connections.",
      };
      const segments = [
        ...longTranscript,
        plantSegment,
      ];

      const plan = planVideoContext({
        segments,
        query: "What did the speaker say about plants?",
        currentTime: 1100, // 18:20
        sourceBudgetTokens: 700,
      });

      expect(plan.mode).toBe("retrieval");
      expect(plan.coverage).toBe("chunks");
      expect(plan.content).toContain("plants producing chemical signaling");
      expect(plan.content).toContain("[1:45:00]");
    });
  });

  describe("bounded retrieval for explicit localized queries", () => {
    it("preserves bounded window for 'around 18:20' query", () => {
      const plan = planVideoContext({
        segments: longTranscript,
        query: "What happened around 18:20 in the lecture?",
        sourceBudgetTokens: 700,
      });
      expect(plan.mode).toBe("timestamp");
      expect(plan.coverage).toBe("window");
      expect(plan.content).toContain("[18:");
    });

    it("preserves bounded window for 'what did he just say' at playback position", () => {
      const plan = planVideoContext({
        segments: longTranscript,
        query: "what did he just say?",
        currentTime: 1200,
        sourceBudgetTokens: 700,
      });
      expect(plan.mode).toBe("playback");
      expect(plan.coverage).toBe("window");
      expect(plan.content).toContain("[20:00]");
    });

    it("preserves bounded window when user provides an explicit text selection", () => {
      const plan = planVideoContext({
        segments: longTranscript,
        query: "Explain this",
        selection: "quantum entanglement and non-local interactions",
        sourceBudgetTokens: 700,
      });
      expect(plan.mode).toBe("retrieval");
      expect(plan.coverage).toBe("chunks");
      expect(plan.content).toContain("quantum");
    });
  });
});
