/**
 * SM-20 Scheduler Core
 *
 * Line-by-line translation of `sm20_reference.py`, itself reverse-engineered from
 * sm20.exe via Ghidra (75 functions, 44K fully decompiled). The V4 (SM-20 proper)
 * seven-parameter polynomial is the active formula; the Bayesian smoothing core
 * learns from review matrices when supplied by the caller.
 *
 * Native TypeScript implementation for the browser/PWA backend.
 * The Tauri backend uses a matching native Rust implementation under `src-tauri/src/algorithms/sm20.rs`.
 *
 * NOTE: The browser/PWA backend does not persist the Bayesian matrices in v1, so
 * learning accumulates only within a session when matrices are supplied. The
 * Tauri desktop path is the complete implementation (persists matrices to SQLite).
 */

export interface SM20State {
  /**
   * Deprecated: previously selected the interval formula (2/4/6). Now ignored —
   * V4 is always used. Retained for backward-compatible deserialization.
   * @deprecated
   */
  version: number;
  stability: number;
  difficulty: number;
  repetition: number;
  lapses: number;
  interval: number;
  last_quality: number;
  /**
   * Deprecated: previously gated the FSRS-family branch. Now ignored — the
   * FSRS-family code has been removed.
   * @deprecated
   */
  algorithm_branch?: number;
  retrov?: number;
  s_factor?: number;
  multiplier?: number;
}

export interface SM20ReviewResult {
  state: SM20State;
  interval_days: number;
  retrievability: number;
}

const STABILITY_POWER = 2.90396936502257;
const STABILITY_LOWER = -1.0;
const STABILITY_CAP = 0.7;
const STABILITY_MAX = 44530.0;

/** --- Initial Interval constants (FUN_00ce1900) — Bayesian prior --- */
const INIT_STABILITY_SCALE_MAX = 15.0;
const INIT_STABILITY_SCALE_MIN = 3.0;
const INIT_ANCHOR = 1.0;
const INIT_REP_POWER_OFFSET = -0.08;
const INIT_REP_POWER_COEFF = -0.35;
const INIT_BASE_SUB = 1.0;
const INIT_BASE_ADD = 1.0;
const INIT_PENALTY_SLOPE = -2.0;
const INIT_PENALTY_INTERCEPT = 2.25;
const INIT_PENALTY_CLAMP = 600.0;

/** --- Bayesian Core constants (FUN_00ce1250) --- */
const BAYES_PRIOR_WEIGHT = 500.0;
const BAYES_TARGET_WEIGHT_SCALE = 10.0;
const BAYES_NEIGHBOR_WEIGHT_DENOM = 1000.0;
const BAYES_CUBE_WEIGHT = 3.0;
const BAYES_NEUTRAL = 1.0;

/** --- Rounding thresholds (FUN_00ce8dd0) --- */
const ROUND_WIDE_UPPER = 20.0;
const ROUND_WIDE_LOWER = 0.8;
const ROUND_NARROW_UPPER = 2.0;
const ROUND_NARROW_LOWER = 0.5;

/** Matrix dimensions */
const MATRIX_DIM = 21;
const MATRIX_STRIDE_R = MATRIX_DIM * MATRIX_DIM; // 441
const MATRIX_STRIDE_S = MATRIX_DIM; // 21

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function exp2Clamped(x: number): number {
  return Math.pow(2, clamp(x, -38, 38));
}

function sigmoidWeight(x: number, y: number): number {
  const s = x + y;
  return s === 0 ? 0 : x / s;
}

export function sm20Retrievability(stability: number, elapsedDays: number): number {
  if (!Number.isFinite(stability) || stability <= 0) {
    return 0;
  }
  return Math.pow(0.9, Math.max(0, elapsedDays) / stability);
}

/** FUN_00cf7550: Validate and clamp stability. */
function stabilityPretransform(s: number): number {
  if (!Number.isFinite(s)) return STABILITY_MAX;
  if (s <= STABILITY_LOWER) return s;
  if (s < STABILITY_CAP) return STABILITY_CAP;
  if (s <= STABILITY_MAX) return s;
  return STABILITY_MAX;
}

/** FUN_00cf6fd0: floor(D * 19) + 1, result in [1, 10]. D<0 returns index 10. */
function difficultyToIndex(d: number): number {
  if (d < 0) return 10;
  return Math.min(10, Math.floor(d * 19) + 1);
}

/** FUN_00cf7330: Convert stability to matrix index in [1, 20]. */
function stabilityToIndex(s: number): number {
  const st = stabilityPretransform(s);
  const diff = Math.max(0, st - 2.0);
  const result = Math.pow(diff, 1.0 / STABILITY_POWER);
  return clamp(Math.floor(result) + 1, 1, 20);
}

/** FUN_00cf7420: Convert stability INDEX to transformed value. */
function stabilityToTransformed(sIdx: number): number {
  return Math.pow(sIdx - 1, STABILITY_POWER) + 2.0;
}

/** FUN_00cf7250: floor(exp2(R * 20)), clamped to [0, 20]. */
function _retrievabilityToIndex(r: number): number {
  return clamp(Math.floor(Math.pow(2, r * 20)), 0, 20);
}

/** FUN_00cf73d0: D / 20.0 */
function difficultyToFraction(dIdx: number): number {
  return dIdx / 20.0;
}

/** FUN_00cf71c0: (R - 1) / 19 */
function repetitionToFraction(r: number): number {
  return (r - 1) / 19.0;
}

/** FUN_00ce8dd0: Clamp interval to threshold range. */
function applyRounding(interval: number, flags: number): number {
  const [upper, lower] = flags >= 4 || (flags & 2) !== 0
    ? [ROUND_WIDE_UPPER, ROUND_WIDE_LOWER]
    : [ROUND_NARROW_UPPER, ROUND_NARROW_LOWER];

  if (interval > upper) return upper;
  if (interval <= lower && Math.abs(interval - lower) > 1e-15) return lower;
  return interval;
}

/** FUN_00ccd8e0: Version 4 interval (SM-20 proper).
 *  Its output is a stability-increase multiplier (SInc), not an absolute interval. */
function intervalV4(p1: number, p2: number, p3: number, p4: number, p5: number, _p6: number, p7: number): number {
  return (p3 * p5 + 1.0) * (p1 * p7 + p2) + p4;
}

/** FUN_00ce1900: Bayesian prior — initial interval per matrix cell. */
function intervalInitial(repFraction: number, stabilityTransformed: number, difficultyFraction: number): number {
  const scale = INIT_STABILITY_SCALE_MIN
    + (INIT_STABILITY_SCALE_MAX - INIT_STABILITY_SCALE_MIN) * (INIT_ANCHOR - repFraction);
  const power = INIT_REP_POWER_OFFSET + repFraction * (INIT_REP_POWER_COEFF - INIT_REP_POWER_OFFSET);
  const base = (scale - INIT_BASE_SUB) * Math.pow(stabilityTransformed, power) + INIT_BASE_ADD;
  const penalty = Math.min(INIT_PENALTY_CLAMP, repFraction * INIT_PENALTY_SLOPE + INIT_PENALTY_INTERCEPT);
  const exponent = -penalty * difficultyFraction;
  const result = base * exp2Clamped(exponent);
  return Math.max(1.0, applyRounding(result, 4));
}

function matrixFlatIndex(r: number, s: number, d: number): number {
  return r * MATRIX_STRIDE_R + s * MATRIX_STRIDE_S + d;
}

/** FUN_00ce1250: Bayesian 3×3×3 neighbor smoothing. */
function bayesianSmooth(
  rIdx: number,
  sIdx: number,
  dIdx: number,
  intervalMatrix: Float64Array,
  countMatrix: Uint32Array,
): number {
  const repFraction = rIdx / 19.0;
  const stabTransformed = Math.pow(sIdx > 0 ? sIdx : 0, STABILITY_POWER) + 2.0;
  const diffFraction = (dIdx + 1) / 20.0;
  const prior = intervalInitial(repFraction, stabTransformed, diffFraction);

  const targetIdx = matrixFlatIndex(rIdx, sIdx, dIdx);
  const targetInterval = intervalMatrix[targetIdx];
  const targetCount = countMatrix[targetIdx];

  let neighborSum = 0;
  let neighborCount = 0;

  const rLo = Math.max(0, rIdx - 1);
  const rHi = Math.min(MATRIX_DIM, rIdx + 2);
  const sLo = Math.max(0, sIdx - 1);
  const sHi = Math.min(MATRIX_DIM, sIdx + 2);
  const dLo = Math.max(0, dIdx - 1);
  const dHi = Math.min(MATRIX_DIM, dIdx + 2);

  for (let nr = rLo; nr < rHi; nr++) {
    for (let ns = sLo; ns < sHi; ns++) {
      for (let nd = dLo; nd < dHi; nd++) {
        if (nr === 0 || ns === 0 || nd === 0) continue;
        const nIdx = matrixFlatIndex(nr, ns, nd);
        const c = countMatrix[nIdx];
        if (c > 0) {
          neighborSum += intervalMatrix[nIdx] * c;
          neighborCount += c;
        }
      }
    }
  }

  const tw = sigmoidWeight(targetCount, BAYES_PRIOR_WEIGHT) * BAYES_TARGET_WEIGHT_SCALE;
  const nw = sigmoidWeight(neighborCount, BAYES_NEIGHBOR_WEIGHT_DENOM);

  const total = neighborCount + 1;
  const avg = (targetInterval + neighborSum) / total;

  const numerator = prior + targetInterval * tw + avg * nw * BAYES_CUBE_WEIGHT;
  const denominator = tw + BAYES_NEUTRAL + nw * BAYES_CUBE_WEIGHT;

  return denominator === 0 ? prior : numerator / denominator;
}

/** Update matrices after a review (incremental average). */
export function sm20RecordReview(
  stability: number,
  difficulty: number,
  repetition: number,
  intervalUsed: number,
  intervalMatrix: Float64Array,
  countMatrix: Uint32Array,
): void {
  const dIdx = clamp(difficultyToIndex(difficulty) - 1, 0, 19);
  const sIdx = clamp(stabilityToIndex(stability) - 1, 0, 19);
  const rIdx = clamp(repetition > 0 ? repetition - 1 : 0, 0, 19);

  const idx = matrixFlatIndex(rIdx, sIdx, dIdx);
  const oldCount = countMatrix[idx];
  const oldInterval = intervalMatrix[idx];

  countMatrix[idx] = oldCount + 1;
  intervalMatrix[idx] = (oldInterval * oldCount + intervalUsed) / (oldCount + 1);
}

function computeNextInterval(
  stability: number,
  difficulty: number,
  repetition: number,
  intervalMatrix?: Float64Array,
  countMatrix?: Uint32Array,
): number {
  const st = stabilityPretransform(stability);

  const dIdx = clamp(difficultyToIndex(difficulty) - 1, 0, 19);
  const sIdx = clamp(stabilityToIndex(st) - 1, 0, 19);
  const rIdx = clamp(repetition > 0 ? repetition - 1 : 0, 0, 19);

  const stabXform = stabilityToTransformed(stabilityToIndex(st));
  const diffFrac = difficultyToFraction(difficultyToIndex(difficulty));

  // V4 (SM-20 proper) — the only active formula.
  // Parameter mapping verified against sm20_reference.py.
  let sinc: number = intervalV4(diffFrac, stabXform, 0.8, 0.0, 0.9, stabXform, repetition);

  if (intervalMatrix && countMatrix) {
    const targetCount = countMatrix[matrixFlatIndex(rIdx, sIdx, dIdx)];
    if (targetCount > 0) {
      sinc = bayesianSmooth(rIdx, sIdx, dIdx, intervalMatrix, countMatrix);
    }
  }

  // New stability = old × SInc. Correct for V4 per sm20_reference.py:463-465
  // (V4 output is a multiplier, not an absolute interval).
  return clamp(st * sinc, 1.0, STABILITY_MAX);
}

const DEFAULT_STATE: SM20State = {
  version: 4,
  stability: 1.0,
  difficulty: 0.3,
  repetition: 0,
  lapses: 0,
  interval: 1.0,
  last_quality: 0.75,
  algorithm_branch: 0,
  retrov: 0.3,
  s_factor: 1.0,
  multiplier: 1.0,
};

export function parseSm20State(algorithmState?: string): SM20State {
  if (algorithmState) {
    try {
      const parsed = JSON.parse(algorithmState) as Partial<SM20State>;
      if (parsed && typeof parsed.stability === "number" && typeof parsed.difficulty === "number") {
        return {
          version: parsed.version ?? 4,
          stability: parsed.stability,
          difficulty: parsed.difficulty,
          repetition: parsed.repetition ?? 0,
          lapses: parsed.lapses ?? 0,
          interval: parsed.interval ?? Math.max(1.0, parsed.stability),
          last_quality: parsed.last_quality ?? 0.75,
          algorithm_branch: parsed.algorithm_branch ?? 0,
          retrov: parsed.retrov ?? parsed.difficulty,
          s_factor: parsed.s_factor ?? 1.0,
          multiplier: parsed.multiplier ?? 1.0,
        };
      }
    } catch {
      // Ignore malformed state and fall back to defaults.
    }
  }
  return { ...DEFAULT_STATE };
}

function ratingToQuality(rating: number): number {
  switch (rating) {
    case 1: return 0.05;
    case 2: return 0.60;
    case 3: return 0.78;
    case 4: return 0.92;
    default: return 0.78;
  }
}

function successMultiplier(rating: number): number {
  switch (rating) {
    case 2: return 0.85;
    case 4: return 1.15;
    default: return 1.0;
  }
}

function nextDifficulty(currentDifficulty: number, quality: number): number {
  return clamp(currentDifficulty + (0.7 - quality) * 0.18, 0.0, 1.0);
}

function lapseInterval(stability: number, lapses: number): number {
  const decayed = Math.max(0.5, stability * 0.35);
  return clamp(decayed / (1.0 + lapses * 0.15), 0.5, 3.0);
}

/**
 * Review an SM-20 item.
 *
 * @param intervalMatrix Optional Bayesian matrix for smoothing. When omitted
 *   (the default for the browser/PWA backend in v1), no smoothing is applied.
 * @param countMatrix    Optional count matrix. Must be supplied alongside
 *   `intervalMatrix` for smoothing/recording to take effect.
 *
 * When matrices are supplied, the successful-recall path records the observation
 * into them (mutating them in place); the caller is responsible for persistence.
 */
export function sm20Review(
  currentState: SM20State,
  rating: number,
  elapsedDays: number,
  intervalMatrix?: Float64Array,
  countMatrix?: Uint32Array,
): SM20ReviewResult {
  const state = parseSm20State(JSON.stringify(currentState));

  const quality = ratingToQuality(rating);
  const ret = sm20Retrievability(state.stability, elapsedDays);

  if (rating <= 1) {
    const lapses = state.lapses + 1;
    const intervalDays = lapseInterval(state.stability, lapses);
    return {
      state: {
        version: state.version,
        stability: clamp(intervalDays, STABILITY_CAP, STABILITY_MAX),
        difficulty: nextDifficulty(state.difficulty, quality),
        repetition: 0,
        lapses,
        interval: intervalDays,
        last_quality: quality,
        algorithm_branch: state.algorithm_branch,
        retrov: state.retrov,
        s_factor: state.s_factor,
        multiplier: state.multiplier,
      },
      interval_days: intervalDays,
      retrievability: ret,
    };
  }

  const repetition = clamp(state.repetition + 1, 1, 20);
  const newStability = computeNextInterval(
    state.stability, state.difficulty, repetition, intervalMatrix, countMatrix,
  );
  const intervalDays = clamp(newStability * successMultiplier(rating), 1.0, STABILITY_MAX);

  // Record the observation into the matrices (successful-recall path).
  if (intervalMatrix && countMatrix) {
    sm20RecordReview(state.stability, state.difficulty, repetition, intervalDays, intervalMatrix, countMatrix);
  }

  return {
    state: {
      version: state.version,
      stability: intervalDays,
      difficulty: nextDifficulty(state.difficulty, quality),
      repetition,
      lapses: state.lapses,
      interval: intervalDays,
      last_quality: quality,
      algorithm_branch: state.algorithm_branch,
      retrov: state.retrov,
      s_factor: state.s_factor,
      multiplier: state.multiplier,
    },
    interval_days: intervalDays,
    retrievability: ret,
  };
}

export function sm20PreviewIntervals(
  currentState: SM20State,
  elapsedDays: number
): Record<"again" | "hard" | "good" | "easy", number> {
  return {
    again: sm20Review(currentState, 1, elapsedDays).interval_days,
    hard: sm20Review(currentState, 2, elapsedDays).interval_days,
    good: sm20Review(currentState, 3, elapsedDays).interval_days,
    easy: sm20Review(currentState, 4, elapsedDays).interval_days,
  };
}
