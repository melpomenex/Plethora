/**
 * Precision scheduling hot path — repetition scheduling over a fixed grade
 * sequence. The scheduler ensemble runs per grade, per item: it is the
 * tightest loop in the app (see src/lib/precisionScheduler.ts).
 *
 * Determinism: the grade sequence is drawn once from `seededRandom`, elapsed
 * days follow a fixed cycle, and the review runs in deterministic mode with a
 * fixed RNG, so every iteration performs identical work.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import {
  freshPrecisionCollectionState,
  parsePrecisionState,
  precisionReview,
  type PrecisionState,
} from "./precisionScheduler";

const BASE_STATE = parsePrecisionState();
const collection = freshPrecisionCollectionState();

// Fixed grade sequence (1-4, mirroring a realistic review log with the
// occasional lapse), drawn once from the seeded PRNG.
const rng = seededRandom(0x5eed);
const GRADE_SEQUENCE = Array.from({ length: 32 }, () => Math.floor(rng() * 4) + 1);

// One iteration = one full sequential review pass over a fixed number of
// reviews, threading the returned state into the next review exactly like the
// real per-item loop does. Elapsed days cycle 1..30 (daily-ish reviews).
const REVIEWS_PER_ITERATION = 100;

// A fixed "today" in Chrono days-from-CE range (≥ 100_000): parsePrecisionState
// migrates Unix-style day values to CE days by adding 719,163, so a small
// today like 20_000 would be re-migrated mid-run and break the schedule.
const TODAY_CE = 739_163 + 20_000;

function runReviewSequence(): number {
  let state: PrecisionState = BASE_STATE;
  let acc = 0;
  for (let i = 0; i < REVIEWS_PER_ITERATION; i += 1) {
    const grade = GRADE_SEQUENCE[i % GRADE_SEQUENCE.length];
    const result = precisionReview(
      state,
      grade,
      (i % 30) + 1,
      undefined,
      undefined,
      undefined,
      undefined,
      true, // deterministic — no Math.random in finalize/dispersal
      {
        collection,
        today: TODAY_CE,
        commit: false,
        random: () => 0.5, // deterministic M2 noise
      },
    );
    state = result.state;
    acc ^= result.interval_days ^ Math.trunc(result.retrievability * 1_000_000);
  }
  return acc; // consumed so the loop cannot be elided
}

// Consumed result sink: bench bodies must return void for tsc, so the work's
// fold is written here to keep it live (the engine cannot elide the loop).
let sink = 0;

bench(
  "precision-scheduler/review-sequence",
  () => {
    sink ^= runReviewSequence();
  },
  {
    // One iteration is intentionally substantial (~15 ms). The default 500 ms
    // window yields only ~30 samples, which lets GC timing dominate the result.
    // Require a larger sample so the performance gate measures the steady state.
    time: 2_000,
    iterations: 100,
    warmupTime: 500,
  },
);
