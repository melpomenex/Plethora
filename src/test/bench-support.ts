/**
 * Shared helpers for benchmark suites (`*.bench.ts`).
 *
 * Benchmarks must be deterministic (see openspec/changes/
 * add-performance-benchmark-gate): inputs are built from a seeded PRNG, never
 * `Math.random()`, and input size/shape never derives from the clock. That way
 * two runs of the same file measure the same work and differ only by
 * measurement noise.
 */

/**
 * Deterministic 32-bit PRNG (mulberry32).
 *
 * Returns a function that yields values in [0, 1). Same seed → same sequence,
 * on every platform, forever.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Default iteration count for the noise anchor. Tuned so a single `runAnchor()`
 * call takes a couple of milliseconds on a typical machine — long enough that
 * Tinybench's timing is meaningful, short enough that the whole bench suite
 * stays fast. If a class of runner turns out to be much faster/slower, widen
 * this and re-record baselines.
 */
export const ANCHOR_ITERATIONS = 200_000;

/**
 * The noise anchor workload: a fixed, deterministic mix of integer and string
 * work whose cost is a proxy for "how fast is this machine right now".
 *
 * Every benchmark run includes exactly one benchmark named `noise-anchor`
 * (see src/anchor.bench.ts) that calls this function. The gate compares
 * dimensionless cost ratios `anchorHz / benchHz` instead of raw milliseconds,
 * so a runner that is 2× slower lowers both numbers and the ratio is unchanged.
 *
 * The loop is deliberately allocation-light (no per-iteration string building)
 * and every intermediate feeds the returned value, so the engine cannot
 * optimize the loop away.
 */
export function runAnchor(iterations: number = ANCHOR_ITERATIONS): number {
  let acc = 0;
  let str = 0;
  const seed = "noise-anchor-benchmark";
  for (let i = 0; i < iterations; i += 1) {
    acc = Math.imul(acc + i, 0x9e3779b1) >>> 0;
    acc ^= acc >>> 16;
    str = (str * 31 + seed.charCodeAt(i % seed.length)) >>> 0;
    acc = Math.imul(acc ^ str, 0x85ebca6b) >>> 0;
  }
  // Both accumulators are folded into the return value so the caller can
  // consume the result and the loop cannot be elided as dead code.
  return (acc + str) >>> 0;
}
