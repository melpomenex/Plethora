/**
 * The noise anchor — MUST be present in every benchmark run.
 *
 * `scripts/check-perf-budget.mjs` refuses to run without a benchmark named
 * exactly `noise-anchor`: it is the in-process yardstick that turns every other
 * benchmark's raw hz into a dimensionless cost ratio (`anchorHz / benchHz`),
 * which is what makes results comparable across machines and CI runner classes.
 *
 * Keep this file dependency-free: it benchmarks `runAnchor()` from
 * src/test/bench-support.ts and nothing else.
 */
import { bench } from "vitest";
import { runAnchor } from "./test/bench-support";

// Consumed result sink: writing the anchor's fold here keeps the call live so
// the engine cannot elide the loop (bench bodies must return void for tsc).
let sink = 0;

bench("noise-anchor", () => {
  sink ^= runAnchor();
});
