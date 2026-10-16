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
});
