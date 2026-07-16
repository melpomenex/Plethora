import type { StartupFixture } from "./startupFixture";

export type StartupBenchmarkProfile = "desktop" | "boox-palma-2";

export interface StartupDataBenchmarkResult {
  profile: StartupBenchmarkProfile;
  iterations: number;
  p95Ms: number;
  serializedBytes: number;
  documentCount: number;
  learningItemCount: number;
  passes: boolean;
}

const profileTargets: Record<StartupBenchmarkProfile, number> = {
  desktop: 500,
  "boox-palma-2": 1000,
};

/**
 * Run the same bounded loader repeatedly against a deterministic fixture.
 * The loader is injected so a test can use IndexedDB, a native command harness,
 * or a device bridge without making this unit helper environment-specific.
 */
export async function runStartupDataBenchmark<T>(args: {
  fixture: StartupFixture;
  profile: StartupBenchmarkProfile;
  load: (fixture: StartupFixture) => Promise<T>;
  iterations?: number;
  serialize?: (value: T) => string;
}): Promise<StartupDataBenchmarkResult> {
  const durations: number[] = [];
  let serializedBytes = 0;
  const iterations = Math.max(1, args.iterations ?? 5);
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    const result = await args.load(args.fixture);
    durations.push(performance.now() - started);
    if (i === 0) {
      serializedBytes = new TextEncoder().encode(
        args.serialize ? args.serialize(result) : JSON.stringify(result),
      ).byteLength;
    }
  }
  durations.sort((a, b) => a - b);
  const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
  const p95Ms = durations[p95Index] ?? 0;
  return {
    profile: args.profile,
    iterations,
    p95Ms,
    serializedBytes,
    documentCount: args.fixture.documents.length,
    learningItemCount: args.fixture.learningItems.length,
    passes: p95Ms <= profileTargets[args.profile] && serializedBytes <= 256 * 1024,
  };
}
