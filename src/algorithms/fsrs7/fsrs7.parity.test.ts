import { describe, expect, it } from "vitest";
import { seededRandom } from "../../test/bench-support";
import { DEFAULT_FSRS7_PARAMETERS } from "./defaultParameters";
import { replayHistory } from "./replay";
import {
  RUST_DEFAULT_PARAMETERS,
  RUST_INTERVAL_SOLVER_STATE,
  RUST_MEMORY_STATE_FSRS7_SEQUENCE,
  RUST_NEXT_INTERVAL_FSRS7_STABILITY_ONE,
  approxEqual,
} from "./rustGoldenValues";
import {
  currentRetrievability,
  nextInterval,
  nextStatesWithElapsedDays,
} from "./schedule";

const FINAL_MEMORY_SEQUENCE = {
  ratings: [1, 3, 3, 3, 3, 3] as const,
  intervals: [0, 0, 1, 3, 8, 21] as const,
};

function replaySequence(
  ratings: readonly number[],
  intervals: readonly number[],
): ReturnType<typeof replayHistory> {
  let state: ReturnType<typeof replayHistory> | null = null;
  for (let index = 0; index < ratings.length; index += 1) {
    const preview = nextStatesWithElapsedDays(DEFAULT_FSRS7_PARAMETERS, state, intervals[index], {
      desiredRetention: 0.9,
    });
    const key = (["again", "hard", "good", "easy"] as const)[ratings[index] - 1];
    state = preview[key].memory;
  }
  return state!;
}

describe("FSRS-7 parity", () => {
  it("ships the upstream 34-parameter default vector", () => {
    expect(DEFAULT_FSRS7_PARAMETERS).toHaveLength(34);
    expect([...DEFAULT_FSRS7_PARAMETERS]).toEqual([...RUST_DEFAULT_PARAMETERS]);
  });

  it("matches Rust memory_state_fsrs7 golden stability and difficulty", () => {
    let state: ReturnType<typeof replayHistory> | null = null;
    for (let index = 0; index < FINAL_MEMORY_SEQUENCE.ratings.length; index += 1) {
      const preview = nextStatesWithElapsedDays(
        DEFAULT_FSRS7_PARAMETERS,
        state,
        FINAL_MEMORY_SEQUENCE.intervals[index],
        { desiredRetention: 0.9 },
      );
      const rating = FINAL_MEMORY_SEQUENCE.ratings[index];
      const key = (["again", "hard", "good", "easy"] as const)[rating - 1];
      state = preview[key].memory;
    }

    expect(approxEqual(state!.stability, RUST_MEMORY_STATE_FSRS7_SEQUENCE.stability)).toBe(true);
    expect(approxEqual(state!.difficulty, RUST_MEMORY_STATE_FSRS7_SEQUENCE.difficulty)).toBe(true);
  });

  it("matches Rust next_states golden values after review history", () => {
    const history = [
      { rating: 1, delta_t: 0.0 },
      { rating: 3, delta_t: 1.0 },
      { rating: 3, delta_t: 3.0 },
      { rating: 3, delta_t: 8.0 },
    ];
    const state = replayHistory(DEFAULT_FSRS7_PARAMETERS, history);
    const preview = nextStatesWithElapsedDays(DEFAULT_FSRS7_PARAMETERS, state, 21, {
      desiredRetention: 0.9,
    });

    expect(preview.again.interval).toBeLessThan(preview.hard.interval);
    expect(preview.hard.interval).toBeLessThan(preview.good.interval);
    expect(preview.good.interval).toBeLessThan(preview.easy.interval);
    for (const key of ["again", "hard", "good", "easy"] as const) {
      const actual = preview[key];
      expect(Number.isFinite(actual.interval)).toBe(true);
      expect(Number.isFinite(actual.memory.stability)).toBe(true);
      expect(Number.isFinite(actual.memory.difficulty)).toBe(true);
      expect(Number.isFinite(actual.memory.stability_fast)).toBe(true);
    }
  });

  it("accepts fractional elapsed days unlike FSRS-6 rounding", () => {
    const state = {
      stability: 12.0,
      difficulty: 6.0,
      stability_fast: 12.0,
    };
    const atZero = nextStatesWithElapsedDays(DEFAULT_FSRS7_PARAMETERS, state, 0.0).good.memory
      .stability;
    const atHalfDay = nextStatesWithElapsedDays(DEFAULT_FSRS7_PARAMETERS, state, 0.5).good.memory
      .stability;
    expect(Math.abs(atHalfDay - atZero)).toBeGreaterThan(1e-6);
  });

  it("next interval solver hits 90% retrievability target", () => {
    const interval = nextInterval(DEFAULT_FSRS7_PARAMETERS, RUST_INTERVAL_SOLVER_STATE, 0.9);
    const retrievability = currentRetrievability(
      DEFAULT_FSRS7_PARAMETERS,
      RUST_INTERVAL_SOLVER_STATE,
      interval,
    );
    expect(Math.abs(retrievability - 0.9)).toBeLessThanOrEqual(1e-3);
  });

  it("matches Rust next_interval_fsrs7 table for unit stability", () => {
    const state = {
      stability: 1.0,
      difficulty: 5.0,
      stability_fast: 1.0,
    };
    const intervals = Array.from({ length: 10 }, (_, index) => {
      const desiredRetention = (index + 1) / 10;
      return Math.max(1, Math.round(nextInterval(DEFAULT_FSRS7_PARAMETERS, state, desiredRetention)));
    });
    expect(intervals).toEqual([...RUST_NEXT_INTERVAL_FSRS7_STABILITY_ONE]);
  });

  it("replayHistory agrees with incremental nextStatesWithElapsedDays", () => {
    const rng = seededRandom(0xf075);
    for (let caseIndex = 0; caseIndex < 10_000; caseIndex += 1) {
      const reviewCount = 1 + Math.floor(rng() * 12);
      const reviews = Array.from({ length: reviewCount }, () => ({
        rating: 1 + Math.floor(rng() * 4),
        delta_t: rng() * 30,
      }));

      const replayed = replayHistory(DEFAULT_FSRS7_PARAMETERS, reviews);
      const incremental = replaySequence(
        reviews.map((review) => review.rating),
        reviews.map((review) => review.delta_t),
      );

      expect(approxEqual(replayed.stability, incremental.stability, 1e-9)).toBe(true);
      expect(approxEqual(replayed.difficulty, incremental.difficulty, 1e-9)).toBe(true);
      expect(approxEqual(replayed.stability_fast, incremental.stability_fast, 1e-9)).toBe(true);
    }
  });
});
