import { describe, expect, it } from "vitest";
import { classifyPerformanceFromRealtimeFactor } from "../benchmark/defaultProviderConfig";
import { BENCHMARK_FIXTURES } from "../benchmark/fixtures";
import { runTranscriptionBenchmark, type BenchmarkProvider } from "../benchmark/harness";

describe("runTranscriptionBenchmark", () => {
  it("measures wall time and segment count with mock providers", async () => {
    const providers: BenchmarkProvider[] = [
      {
        id: "mock-fast",
        transcribe: async (fixture) => ({
          text: fixture.referenceText ?? "mock transcript",
          segmentCount: 3,
        }),
      },
      {
        id: "mock-slow",
        transcribe: async (fixture) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            text: `${fixture.referenceText ?? "mock"} with edits`,
            segmentCount: 5,
          };
        },
      },
    ];

    const suite = await runTranscriptionBenchmark(
      providers,
      BENCHMARK_FIXTURES.slice(0, 1),
      { suiteName: "mock-suite" },
    );

    expect(suite.name).toBe("mock-suite");
    expect(suite.results).toHaveLength(2);
    expect(suite.results[0]?.providerId).toBe("mock-fast");
    expect(suite.results[0]?.segmentCount).toBe(3);
    expect(suite.results[0]?.wer).toBe(0);
    expect(suite.results[1]?.providerId).toBe("mock-slow");
    expect(suite.results[1]?.wallTimeMs).toBeGreaterThan(0);
    expect(suite.results[1]?.wer).toBeGreaterThan(0);
  });

  it("classifies realtime factor into performance tiers", () => {
    expect(classifyPerformanceFromRealtimeFactor(0.4)).toBe("excellent");
    expect(classifyPerformanceFromRealtimeFactor(0.9)).toBe("usable");
    expect(classifyPerformanceFromRealtimeFactor(3)).toBe("unsupported");
  });
});
