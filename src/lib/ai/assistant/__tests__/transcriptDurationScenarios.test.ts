import { describe, expect, it } from "vitest";
import { resolveVideoSourceContext } from "../contextResolver";
import type { VideoSegment } from "../videoContextPlanner";

function generateTranscript(
  durationSeconds: number,
  segmentInterval = 5,
): { segments: VideoSegment[]; sentinels: { start: string; mid: string; end: string } } {
  const count = Math.max(3, Math.floor(durationSeconds / segmentInterval));
  const sentinels = {
    start: `ALPHA_START_${durationSeconds}S`,
    mid: `BETA_MID_${durationSeconds}S`,
    end: `GAMMA_END_${durationSeconds}S`,
  };

  const midIndex = Math.floor(count / 2);
  const segments: VideoSegment[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * segmentInterval;
    let text = `Regular lecture discussion on scientific topic at ${start}s. `;
    if (i === 0) {
      text += `Key foundation: ${sentinels.start}. `;
    } else if (i === midIndex) {
      text += `Pivotal breakthrough: ${sentinels.mid}. `;
    } else if (i === count - 1) {
      text += `Final synthesis conclusion: ${sentinels.end}. `;
    } else {
      text += "Substantive analysis and experimental observations continuing. ".repeat(6);
    }
    segments.push({ start, duration: segmentInterval, text });
  }

  return { segments, sentinels };
}

describe("Transcript Duration Scenarios (30s to 12h sentinel survival)", () => {
  const mockSummarize = async (text: string, _maxTokens: number) => {
    // A faithful model summarize preserves sentences containing capital identifiers/claims
    const foundSentinels = text.match(/(ALPHA_START_\w+|BETA_MID_\w+|GAMMA_END_\w+)/g) ?? [];
    const timestamps = text.match(/\[\d+:\d+(?::\d+)?\]/g) ?? [];
    const anchor = timestamps[0] ?? "";
    if (foundSentinels.length > 0) {
      return `${anchor} Summary highlighting critical claims: ${foundSentinels.join(", ")}.`;
    }
    return `${anchor} Standard summary of section content covering context points.`;
  };

  const testDurations = [
    { label: "30 seconds", seconds: 30 },
    { label: "5 minutes", seconds: 300 },
    { label: "30 minutes", seconds: 1800 },
    { label: "2 hours", seconds: 7200 },
    { label: "6 hours", seconds: 21600 },
    { label: "12 hours", seconds: 43200 },
  ];

  for (const { label, seconds } of testDurations) {
    it(`preserves first, middle, and last sentinels for ${label} video transcript`, async () => {
      const { segments, sentinels } = generateTranscript(seconds, seconds > 3600 ? 15 : 5);

      const plan = await resolveVideoSourceContext({
        videoId: `vid-${seconds}s`,
        segments,
        query: "What are the key points of this lecture?",
        sourceBudgetTokens: 4000,
        requireCompleteCoverage: true,
        summarize: mockSummarize,
      });

      expect(plan.content).toBeDefined();
      expect(plan.coverage).toMatch(/^(full|hierarchical-full)$/);

      // Verify all 3 sentinels survive into the resolved prompt/synthesis
      expect(plan.content).toContain(sentinels.start);
      expect(plan.content).toContain(sentinels.mid);
      expect(plan.content).toContain(sentinels.end);
    });
  }
});
