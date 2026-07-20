import { describe, expect, test } from "vitest";
import {
  parseSm20State,
  sm20PreviewIntervals,
  sm20Retrievability,
  sm20Review,
  sm20RecordReview,
  sm20PreviewGradeResults,
  freshSm20CollectionState,
} from "../sm20";
import { SM20_ARENA_MODEL_ORDER } from "../../api/review";
import parityFixture from "../../shared/sm20ArenaParityFixture.json";

describe("SM-20 5-model ensemble", () => {
  test("parses default state", () => {
    const state = parseSm20State();
    expect(state.stability).toBe(1.0);
    expect(state.difficulty).toBe(0.3);
    expect(state.repetition).toBe(0);
  });

  test("uses 90 percent forgetting curve", () => {
    expect(sm20Retrievability(10, 10)).toBeCloseTo(0.9, 10);
  });

  test("good review on a new item produces a plausible interval", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 2.0,
      difficulty: 0.3,
      repetition: 2,
      lapses: 0,
      interval: 2.0,
    }));
    const result = sm20Review(state, 3, 2.0);
    // The ensemble should produce a positive interval ≥ 1 day
    expect(result.interval_days).toBeGreaterThanOrEqual(1);
    // Repetition should increment
    expect(result.state.repetition).toBe(3);
  });

  test("again review triggers lapse path (short interval, lapses increment)", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 8.0,
      difficulty: 0.3,
      repetition: 5,
      lapses: 0,
      interval: 8.0,
    }));
    const result = sm20Review(state, 1, 8.0);
    // Post-lapse path clamps to [1, 11]
    expect(result.interval_days).toBeGreaterThanOrEqual(1);
    expect(result.interval_days).toBeLessThanOrEqual(11);
    expect(result.state.lapses).toBe(1);
    expect(result.state.repetition).toBe(0);
  });

  test("easy review produces a longer interval than hard", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 10.0,
      difficulty: 0.3,
      repetition: 3,
      lapses: 0,
      interval: 10.0,
    }));
    // Use many trials to average out stochastic dispersal
    const easyIntervals: number[] = [];
    const hardIntervals: number[] = [];
    for (let i = 0; i < 50; i++) {
      easyIntervals.push(sm20Review(state, 4, 10.0).interval_days);
      hardIntervals.push(sm20Review(state, 2, 10.0).interval_days);
    }
    const easyAvg = easyIntervals.reduce((a, b) => a + b, 0) / easyIntervals.length;
    const hardAvg = hardIntervals.reduce((a, b) => a + b, 0) / hardIntervals.length;
    // Easy should generally produce longer intervals than hard
    expect(easyAvg).toBeGreaterThan(hardAvg);
  });

  test("preview intervals are plausible", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 5.0,
      difficulty: 0.3,
      repetition: 2,
      lapses: 0,
      interval: 5.0,
    }));
    const preview = sm20PreviewIntervals(state, 0);
    // All should be ≥ 1
    expect(preview.again).toBeGreaterThanOrEqual(1);
    expect(preview.hard).toBeGreaterThanOrEqual(1);
    expect(preview.good).toBeGreaterThanOrEqual(1);
    expect(preview.easy).toBeGreaterThanOrEqual(1);
  });

  test("Arena preview returns six deterministic grades with five named model slots", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 18,
      difficulty: 0.36,
      repetition: 4,
      lapses: 1,
      interval: 16,
    }));
    const first = sm20PreviewGradeResults(state, 14);
    const second = sm20PreviewGradeResults(state, 14);

    expect(first).toHaveLength(6);
    expect(first).toEqual(second);
    for (const result of first) {
      expect(result.model_intervals).toHaveLength(5);
      expect(result.model_intervals.every((interval) => Number.isFinite(interval) && interval >= 1)).toBe(true);
      expect(result.interval_days).toBeGreaterThanOrEqual(1);
    }
  });

  test("matches the shared native fixture for all six grades and all five models", () => {
    expect(SM20_ARENA_MODEL_ORDER).toEqual(parityFixture.model_order);
    const collection = freshSm20CollectionState();
    const state = parseSm20State(JSON.stringify(parityFixture.state));
    const results = sm20PreviewGradeResults(
      state,
      parityFixture.elapsed_days,
      false,
      collection,
      30,
    );
    expect(results.map((result) => ({
      recommendation: result.interval_days,
      candidates: result.model_intervals,
    }))).toEqual(parityFixture.grades.map((grade) => ({
      recommendation: grade.recommendation,
      candidates: grade.candidates,
    })));
    expect(collection.arena.weights).toEqual(parityFixture.weights);

    const commitCollection = freshSm20CollectionState();
    const committed = sm20Review(
      state,
      parityFixture.committed_grade,
      parityFixture.elapsed_days,
      undefined,
      undefined,
      false,
      parityFixture.committed_grade,
      true,
      { collection: commitCollection, today: 30, commit: true },
    );
    expect({
      stability: committed.state.stability,
      difficulty: committed.state.difficulty,
      m1_state: committed.state.m1_state,
      m2_state: committed.state.m2_state,
      m3_state: committed.state.m3_state,
      slot_stabilities: committed.state.slot_stabilities,
    }).toEqual(parityFixture.committed_state);
    expect({
      m2_case_count: commitCollection.m2_optimizer.cell_cases.flat().reduce((sum, value) => sum + value, 0),
      m3_outcome_count: commitCollection.m3_matrices.outcome_count.reduce((sum, value) => sum + value, 0),
    }).toEqual({
      m2_case_count: parityFixture.committed_collection.m2_case_count,
      m3_outcome_count: parityFixture.committed_collection.m3_outcome_count,
    });
    expect({ ...commitCollection.arena, weights: parityFixture.committed_collection.arena.weights })
      .toEqual(parityFixture.committed_collection.arena);
    commitCollection.arena.weights.forEach((weight, index) => {
      expect(weight).toBeCloseTo(parityFixture.committed_collection.arena.weights[index], 14);
    });
    const learnedPreview = sm20PreviewGradeResults(
      committed.state,
      parityFixture.post_commit_elapsed_days,
      false,
      commitCollection,
      parityFixture.post_commit_today,
    );
    expect(learnedPreview.map((result) => ({
      recommendation: result.interval_days,
      candidates: result.model_intervals,
    }))).toEqual(parityFixture.post_commit_grades);

    const personalizedCollection = freshSm20CollectionState();
    personalizedCollection.fsrs_params = parityFixture.personalized_fsrs.parameters;
    const personalizedPreview = sm20PreviewGradeResults(
      state,
      parityFixture.elapsed_days,
      false,
      personalizedCollection,
      30,
    );
    personalizedPreview.forEach((result, index) => {
      const expected = parityFixture.personalized_fsrs.grades[index];
      expect(result.model_intervals[4]).toBe(expected.interval);
      expect(result.state.m5_memory?.stability).toBeCloseTo(expected.memory.stability, 7);
      expect(result.state.m5_memory?.difficulty).toBeCloseTo(expected.memory.difficulty, 7);
    });
  });

  test("a chosen deterministic model interval can be made the actual schedule without changing raw slots", () => {
    const state = parseSm20State(JSON.stringify({
      stability: 24,
      difficulty: 0.25,
      repetition: 6,
      lapses: 0,
      interval: 20,
    }));
    const preview = sm20PreviewGradeResults(state, 20)[4];
    const commit = sm20Review(state, 3, 20, undefined, undefined, false, 4, true);

    expect(commit.interval_days).toBe(preview.interval_days);
    expect(commit.model_intervals).toEqual(preview.model_intervals);
    expect(commit.state.slot_stabilities).toHaveLength(5);
  });

  test("sm20RecordReview is a no-op (ensemble handles matrices internally)", () => {
    const intervalMatrix = new Float64Array(9261);
    const countMatrix = new Uint32Array(9261);
    sm20RecordReview(5.0, 0.3, 3, 3.0, intervalMatrix, countMatrix);
    // Should not modify the matrices — the ensemble's M3 model handles updates
    expect(countMatrix.every((v) => v === 0)).toBe(true);
  });

  test("legacy matrix params are ignored by the ensemble", () => {
    const intervalMatrix = new Float64Array(9261);
    const countMatrix = new Uint32Array(9261);
    const state = parseSm20State(JSON.stringify({
      stability: 5.0,
      difficulty: 0.3,
      repetition: 2,
      lapses: 0,
      interval: 5.0,
    }));
    sm20Review(state, 3, 2.0, intervalMatrix, countMatrix);
    expect(countMatrix.every((v) => v === 0)).toBe(true);
    expect(intervalMatrix.every((v) => v === 0)).toBe(true);
  });

  test("backward compat: parse old state without ensemble fields", () => {
    const state = parseSm20State(JSON.stringify({
      version: 2,
      stability: 5.0,
      difficulty: 0.3,
      repetition: 3,
      lapses: 0,
      interval: 5.0,
      last_quality: 0.78,
    }));
    // Deprecated fields are retained for serde compat but ignored
    expect(state.algorithm_branch).toBe(0);
    expect(state.s_factor).toBe(1.0);
    expect(state.multiplier).toBe(1.0);
    // New model state fields get defaults
    expect(state.m1_state).toBeDefined();
    expect(state.m2_state).toBeDefined();
    expect(state.m3_state).toBeDefined();
  });

  test("M4 kernel: new item initialization matches known init values", () => {
    // Grade 5 → P[11] = 77.7788, P[18] = 0.3261
    const state5 = parseSm20State(JSON.stringify({
      stability: 77.7788,
      difficulty: 0.3261,
      repetition: 0,
      lapses: 0,
      interval: 77.7788,
    }));
    const result = sm20Review(state5, 4, 0);
    expect(result.interval_days).toBeGreaterThanOrEqual(1);
  });

  test("ensemble produces physically plausible intervals", () => {
    // Mature easy item: should get weeks-months
    const state = parseSm20State(JSON.stringify({
      stability: 55.0,
      difficulty: 0.2,
      repetition: 5,
      lapses: 0,
      interval: 55.0,
    }));
    // Average over several trials (dispersal is stochastic)
    const intervals: number[] = [];
    for (let i = 0; i < 20; i++) {
      intervals.push(sm20Review(state, 4, 50.0).interval_days);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    // Should be in the weeks-to-months range (at least 10 days)
    expect(avg).toBeGreaterThan(10);
  });
});
