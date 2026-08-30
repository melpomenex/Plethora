/** Synthetic benchmark fixture metadata — no real audio bytes. */
export interface BenchmarkFixture {
  id: string;
  description: string;
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  referenceText?: string;
}

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = [
  {
    id: "short-en-5s",
    description: "5 second English utterance (synthetic metadata)",
    durationMs: 5_000,
    sampleRate: 16_000,
    channelCount: 1,
    referenceText: "hello world this is a short test clip",
  },
  {
    id: "medium-en-30s",
    description: "30 second English monologue (synthetic metadata)",
    durationMs: 30_000,
    sampleRate: 16_000,
    channelCount: 1,
    referenceText: "the quick brown fox jumps over the lazy dog near the riverbank",
  },
  {
    id: "long-en-60s",
    description: "60 second English session (synthetic metadata)",
    durationMs: 60_000,
    sampleRate: 16_000,
    channelCount: 1,
    referenceText: "benchmark fixtures describe audio duration and reference transcripts only",
  },
] as const;

export function getBenchmarkFixture(id: string): BenchmarkFixture | undefined {
  return BENCHMARK_FIXTURES.find((fixture) => fixture.id === id);
}
