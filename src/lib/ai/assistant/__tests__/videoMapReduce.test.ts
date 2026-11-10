import { describe, expect, it, vi } from "vitest";
import { synthesizeWholeVideo } from "../videoMapReduce";
import { longTranscript } from "./fixtures/transcript";
describe("whole-video synthesis", () => {
  it("maps a two-hour recording through its last passage and caches unchanged windows", async () => {
    const summarize = vi.fn(async (text: string) => `${text.match(/\[[^\]]+\]/)?.[0]} ${text.includes("Late finding") ? "Late finding quantum entanglement" : "Classical mechanics"}`);
    const input = { videoId: "two-hours", segments: longTranscript, sourceBudgetTokens: 1400, summarize };
    const content = await synthesizeWholeVideo(input);
    expect(content).toContain("Late finding"); expect(content).toContain("Classical mechanics"); expect(summarize.mock.calls.at(-1)?.[0]).toContain("719");
    const calls = summarize.mock.calls.length;
    expect(await synthesizeWholeVideo(input)).toBe(content); expect(summarize).toHaveBeenCalledTimes(calls);
  });
  it("invalidates summaries after transcript changes or video switches", async () => {
    const summarize = vi.fn(async (text: string) => text);
    const first = [{ start: 0, duration: 10, text: "Source A" }];
    await synthesizeWholeVideo({ videoId: "switch-a", segments: first, sourceBudgetTokens: 100, summarize });
    await synthesizeWholeVideo({ videoId: "switch-b", segments: [{ ...first[0], text: "Source B" }], sourceBudgetTokens: 100, summarize });
    await synthesizeWholeVideo({ videoId: "switch-a", segments: [{ ...first[0], text: "Revised A" }], sourceBudgetTokens: 100, summarize });
    expect(summarize).toHaveBeenCalledTimes(3);
  });

  it("allocates a guaranteed output floor of at least 160 tokens per window on an 80-window transcript", async () => {
    // Generate an 80-window transcript (each segment text > windowChars so each forms a window)
    const segments = Array.from({ length: 80 }, (_, i) => ({
      start: i * 60,
      duration: 55,
      text: `Window ${i} with substantial detailed scientific discourse and explanations. `.repeat(60),
    }));

    const allocatedBudgets: number[] = [];
    const summarize = vi.fn(async (text: string, maxOutputTokens: number) => {
      allocatedBudgets.push(maxOutputTokens);
      return `Summary for ${text.slice(0, 30)}`;
    });

    await synthesizeWholeVideo({
      videoId: "eighty-windows",
      segments,
      sourceBudgetTokens: 1000,
      summarize,
    });

    // In first level, every window summary call must have budget >= 160
    expect(allocatedBudgets.length).toBeGreaterThanOrEqual(80);
    for (const budget of allocatedBudgets) {
      expect(budget).toBeGreaterThanOrEqual(160);
    }
  });

  it("reduces hierarchically in stages of 4 to 6 windows and preserves sentinel facts from first, middle, and last windows", async () => {
    // 24 windows (each segment text > windowChars)
    const segments = Array.from({ length: 24 }, (_, i) => {
      let extra = "";
      if (i === 0) extra = " SENTINEL_FIRST_FACT";
      if (i === 12) extra = " SENTINEL_MIDDLE_FACT";
      if (i === 23) extra = " SENTINEL_LAST_FACT";
      return {
        start: i * 60,
        duration: 55,
        text: `Section ${i} text content. `.repeat(150) + extra,
      };
    });

    const summarize = vi.fn(async (text: string) => {
      const match = [...new Set(text.match(/SENTINEL_[A-Z_]+/g) ?? [])];
      const timestamps = text.match(/\[\d+:\d+\]/g) ?? [];
      return `${timestamps[0] || "[00:00]"} Summary: ${match.join(" ")}`;
    });

    const result = await synthesizeWholeVideo({
      videoId: "sentinel-video",
      segments,
      sourceBudgetTokens: 600,
      summarize,
    });

    expect(result).toContain("SENTINEL_FIRST_FACT");
    expect(result).toContain("SENTINEL_MIDDLE_FACT");
    expect(result).toContain("SENTINEL_LAST_FACT");
  });

  it("incorporates task-aware directives for different action types", async () => {
    const segments = [{ start: 0, duration: 10, text: "Some content here for testing." }];
    const capturedDirectives: string[] = [];

    const summarize = vi.fn(async (_text: string, _maxTokens: number, directive?: string) => {
      if (directive) capturedDirectives.push(directive);
      return "Summary";
    });

    // Test Key points
    await synthesizeWholeVideo({
      videoId: "v-kp",
      segments,
      sourceBudgetTokens: 500,
      query: "Key points",
      summarize,
    });
    expect(capturedDirectives[0]).toContain("main claims");

    // Test Key terms
    await synthesizeWholeVideo({
      videoId: "v-kt",
      segments,
      sourceBudgetTokens: 500,
      query: "Key terms",
      summarize,
    });
    expect(capturedDirectives[1]).toContain("technical terms");

    // Test Analyze argument
    await synthesizeWholeVideo({
      videoId: "v-aa",
      segments,
      sourceBudgetTokens: 500,
      query: "Analyze argument",
      summarize,
    });
    expect(capturedDirectives[2]).toContain("premises, assumptions");

    // Test Flashcards
    await synthesizeWholeVideo({
      videoId: "v-fc",
      segments,
      sourceBudgetTokens: 500,
      query: "Make flashcards",
      summarize,
    });
    expect(capturedDirectives[3]).toContain("atomic facts");
  });

  it("retries transient model failures up to 2 times with exponential backoff", async () => {
    const segments = [{ start: 0, duration: 10, text: "Retry test content" }];
    let attempts = 0;

    const summarize = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Transient network timeout");
      }
      return "Success on attempt 3";
    });

    const result = await synthesizeWholeVideo({
      videoId: "v-retry",
      segments,
      sourceBudgetTokens: 500,
      summarize,
    });

    expect(attempts).toBe(3);
    expect(result).toContain("Success on attempt 3");
  });

  it("reports missing time ranges honestly on permanent partial failure", async () => {
    // 3 segments, each > windowChars (3000 chars) to ensure 3 distinct windows
    const segments = [
      { start: 0, duration: 60, text: "Window 0 content. ".repeat(200) },
      { start: 60, duration: 60, text: "Window 1 content that fails. ".repeat(200) },
      { start: 120, duration: 60, text: "Window 2 content. ".repeat(200) },
    ];

    const summarize = vi.fn(async (text: string) => {
      if (text.includes("Window 1")) {
        throw new Error("Permanent 500 internal server error");
      }
      return `Summary of ${text.slice(0, 15)}`;
    });

    let reportedMissing: Array<{ startSeconds: number; endSeconds: number }> = [];

    const result = await synthesizeWholeVideo({
      videoId: "v-partial-fail",
      segments,
      sourceBudgetTokens: 1000,
      summarize,
      onFailedRanges: (ranges) => {
        reportedMissing = ranges;
      },
    });

    expect(reportedMissing).toHaveLength(1);
    expect(reportedMissing[0].startSeconds).toBe(60);
    expect(result).toContain("Summary unavailable for 01:00–02:00");
  });
});
