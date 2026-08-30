import { computeCER, computeWER } from "./metrics";
import type { BenchmarkFixture } from "./fixtures";

export interface BenchmarkProviderResult {
  text: string;
  segmentCount: number;
}

export interface BenchmarkProvider {
  readonly id: string;
  transcribe(fixture: BenchmarkFixture): Promise<BenchmarkProviderResult>;
}

export interface BenchmarkResult {
  providerId: string;
  fixtureId: string;
  wallTimeMs: number;
  segmentCount: number;
  audioDurationMs: number;
  realtimeFactor: number;
  referenceText?: string;
  hypothesisText?: string;
  wer?: number;
  cer?: number;
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  startedAt: string;
  completedAt: string;
}

export interface RunTranscriptionBenchmarkOptions {
  suiteName?: string;
}

/**
 * Run a transcription benchmark across providers and synthetic fixtures.
 * Providers are injectable (mock in unit tests).
 */
export async function runTranscriptionBenchmark(
  providers: readonly BenchmarkProvider[],
  fixtures: readonly BenchmarkFixture[],
  options: RunTranscriptionBenchmarkOptions = {},
): Promise<BenchmarkSuite> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkResult[] = [];

  for (const provider of providers) {
    for (const fixture of fixtures) {
      const wallStart = performance.now();
      const providerResult = await provider.transcribe(fixture);
      const wallTimeMs = performance.now() - wallStart;
      const audioDurationMs = fixture.durationMs;
      const realtimeFactor = audioDurationMs > 0 ? wallTimeMs / audioDurationMs : 0;

      const result: BenchmarkResult = {
        providerId: provider.id,
        fixtureId: fixture.id,
        wallTimeMs,
        segmentCount: providerResult.segmentCount,
        audioDurationMs,
        realtimeFactor,
        referenceText: fixture.referenceText,
        hypothesisText: providerResult.text,
      };

      if (fixture.referenceText) {
        result.wer = computeWER(fixture.referenceText, providerResult.text);
        result.cer = computeCER(fixture.referenceText, providerResult.text);
      }

      results.push(result);
    }
  }

  return {
    name: options.suiteName ?? "transcription-benchmark",
    results,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
