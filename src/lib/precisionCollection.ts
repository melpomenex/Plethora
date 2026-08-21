/**
 * Collection-wide SM-20 state used by the browser/PWA scheduler.
 *
 * This is a direct TypeScript mirror of the production paths in
 * `src-tauri/src/algorithms/sm20/{model2,model3,arena}.rs`. Keep persisted
 * field names snake_case so a collection can move between IndexedDB and the
 * Tauri SQLite representation without a translation layer.
 */

export type ArenaWeights = [number, number, number, number, number];

export interface M2ItemState {
  last_review_day: number;
  previous_interval: number;
  repetitions: number;
  lapses: number;
  a_factor: number;
  u_factor: number;
}

export interface M2ReviewResult {
  stability: number;
  used_interval: number;
  next_item: M2ItemState;
}

export interface ClassicM2Optimizer {
  matrix: number[][];
  empirical: number[][];
  cell_cases: number[][];
  remembered: number[][][];
  observed: number[][][];
  row_exponent: number[];
  row_weight: number[];
  first_grade: number[];
  first_grade_cases: number[];
  second_grade: number[];
  second_grade_cases: number[];
}

export interface M3ItemState {
  last_review_day: number;
  previous_interval: number;
  repetitions: number;
  lapses: number;
  stability: number;
  difficulty: number;
  previous_stability: number;
  previous_stability_index: number;
  previous_r_index: number;
}

export interface M3ReviewResult {
  stability: number;
  retrievability: number;
  elapsed: number;
  d_blend: number;
  next_item: M3ItemState;
}

export interface M3MatrixState {
  outcome_count: number[];
  outcome_success: number[];
  smoothing_count: number[];
  smoothing_value: number[];
  lapse_observed: number[];
  lapse_remembered: number[];
  first_stage_observed: number[];
  first_stage_remembered: number[];
}

export interface ArenaState {
  weights: ArenaWeights;
  decayed_loss: ArenaWeights;
  decayed_blend_loss: number;
  decayed_baseline_loss?: number;
  decayed_sm19_loss?: number;
  decayed_count: number;
  total_scored: number;
}

export interface PrecisionCollectionState {
  schema_version: 1;
  m2_optimizer: ClassicM2Optimizer;
  m3_matrices: M3MatrixState;
  arena: ArenaState;
  fsrs_params: number[] | null;
  m4_params: number[] | null;
}

/** Backward compatibility alias */
export type SM20CollectionState = PrecisionCollectionState;

export const DEFAULT_M2_ITEM_STATE: M2ItemState = {
  last_review_day: -1,
  previous_interval: 0,
  repetitions: 0,
  lapses: 0,
  a_factor: 3,
  u_factor: 1,
};

export const DEFAULT_M3_ITEM_STATE: M3ItemState = {
  last_review_day: -1,
  previous_interval: 0,
  repetitions: 0,
  lapses: 0,
  stability: 1,
  difficulty: 0.5,
  previous_stability: -1,
  previous_stability_index: 0,
  previous_r_index: 0,
};

const SECOND_GRADE_INIT = [
  4.8, 4.7, 4.6, 4.5, 4.4, 4.3, 4.2, 4.1, 4, 3.95, 3.9, 3.8, 3.74, 3.65,
  3.55, 3.48, 3.39, 3.3,
];
const OUTCOME_CELLS = 21 * 21 * 21;
const LAPSE_CELLS = 20 * 21 * 36;

const clamp = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;

/** Rust f64::round_ties_even / Delphi Round / Python round parity. */
export function roundTiesEven(value: number): number {
  if (!Number.isFinite(value)) return value;
  const lower = Math.floor(value);
  const delta = value - lower;
  if (delta < 0.5) return lower;
  if (delta > 0.5) return lower + 1;
  return Math.abs(lower % 2) === 0 ? lower : lower + 1;
}

const delphiPow = (base: number, exponent: number): number =>
  base > 0 ? Math.exp(exponent * Math.log(base)) : 0;
const sigmoidRatio = (x: number, y: number): number => x + y === 0 ? 0 : x / (x + y);
const signFlip = (value: number): number => -value;

function real48(value: number): number {
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const exponent = Math.floor(Math.log2(absolute));
  let mantissa = roundTiesEven((absolute / 2 ** exponent - 1) * 2 ** 39);
  let adjustedExponent = exponent;
  if (mantissa === 2 ** 39) {
    mantissa = 0;
    adjustedExponent += 1;
  }
  if (adjustedExponent + 129 <= 0) return 0;
  if (adjustedExponent + 129 >= 255) return sign * Number.MAX_VALUE;
  return sign * (1 + mantissa / 2 ** 39) * 2 ** adjustedExponent;
}

function q(value: number): number {
  return clamp(roundTiesEven(value * 1000), 0, 65535) / 1000;
}

const aAxis = (index: number): number => 1.2 + 0.3 * (index - 1);
const aBucket = (factor: number): number =>
  Math.min(20, Math.floor((clamp(factor + 1e-6, 1.2, 10) - 1.2) / 0.3) + 1);
const uValue = (a: number, repetition: number, bin: number): number =>
  repetition === 1 ? bin : bin * (Math.floor(aAxis(a)) / 20) + 1;

function uBucket(a: number, repetition: number, value: number): number {
  const lo = uValue(a, repetition, 1);
  const hi = uValue(a, repetition, 20);
  if (hi === lo) return 1;
  return roundTiesEven((clamp(value, lo, hi) - lo) / (hi - lo) * 19) + 1;
}

function freshOptimum(a: number, repetition: number): number {
  if (repetition === 1) return Math.exp(-0.057 * (a - 1) + 0.91);
  if (repetition === 2) return aAxis(a);
  return (aAxis(a) - 1.2) / (repetition - 1) + 1.2;
}

const matrix2 = (value = 0): number[][] =>
  Array.from({ length: 20 }, () => Array<number>(20).fill(value));
const matrix3 = (): number[][][] =>
  Array.from({ length: 20 }, () => matrix2(0));

export function freshM2Optimizer(): ClassicM2Optimizer {
  const matrix = matrix2();
  const empirical = matrix2();
  for (let a = 1; a <= 20; a += 1) {
    for (let r = 1; r <= 20; r += 1) {
      matrix[a - 1][r - 1] = q(freshOptimum(a, r));
      empirical[a - 1][r - 1] = matrix[a - 1][r - 1];
    }
  }
  return {
    matrix,
    empirical,
    cell_cases: matrix2(),
    remembered: matrix3(),
    observed: matrix3(),
    row_exponent: Array<number>(20).fill(1),
    row_weight: Array<number>(20).fill(1),
    first_grade: Array.from({ length: 20 }, (_, index) =>
      real48(clamp(5.2 - Math.exp(-0.67 * aAxis(index + 1) + 2.4), 0, 5))),
    first_grade_cases: Array<number>(20).fill(1),
    second_grade: SECOND_GRADE_INIT.map(real48),
    second_grade_cases: Array<number>(18).fill(1),
  };
}

export function freshM3Matrices(): M3MatrixState {
  return {
    outcome_count: Array<number>(OUTCOME_CELLS).fill(0),
    outcome_success: Array<number>(OUTCOME_CELLS).fill(0),
    smoothing_count: Array<number>(OUTCOME_CELLS).fill(0),
    smoothing_value: Array<number>(OUTCOME_CELLS).fill(0),
    lapse_observed: Array<number>(LAPSE_CELLS).fill(0),
    lapse_remembered: Array<number>(LAPSE_CELLS).fill(0),
    first_stage_observed: Array<number>(36).fill(0),
    first_stage_remembered: Array<number>(36).fill(0),
  };
}

export function freshArenaState(): ArenaState {
  return {
    weights: [6, 14, 45, 25, 10],
    decayed_loss: [0, 0, 0, 0, 0],
    decayed_blend_loss: 0,
    decayed_baseline_loss: 0,
    decayed_sm19_loss: 0,
    decayed_count: 0,
    total_scored: 0,
  };
}

export function freshPrecisionCollectionState(): PrecisionCollectionState {
  return {
    schema_version: 1,
    m2_optimizer: freshM2Optimizer(),
    m3_matrices: freshM3Matrices(),
    arena: freshArenaState(),
    fsrs_params: null,
    m4_params: null,
  };
}

/** Backward compatibility alias */
export const freshSm20CollectionState = freshPrecisionCollectionState;

export function parsePrecisionCollectionState(value: unknown): PrecisionCollectionState {
  if (!value || typeof value !== 'object') return freshPrecisionCollectionState();
  const input = value as Partial<PrecisionCollectionState>;
  // Old or corrupt partial records are reset component-by-component. The
  // length checks avoid an out-of-bounds scheduler after interrupted writes.
  const m2 = input.m2_optimizer;
  const m3 = input.m3_matrices;
  const arena = input.arena;
  return {
    schema_version: 1,
    m2_optimizer: m2?.matrix?.length === 20 && m2.observed?.length === 20 ? m2 : freshM2Optimizer(),
    m3_matrices: m3?.outcome_count?.length === OUTCOME_CELLS
      && m3.lapse_observed?.length === LAPSE_CELLS ? m3 : freshM3Matrices(),
    arena: arena?.weights?.length === 5 ? sanitizeArenaState(arena) : freshArenaState(),
    fsrs_params: Array.isArray(input.fsrs_params) ? input.fsrs_params : null,
    m4_params: Array.isArray(input.m4_params) ? input.m4_params : null,
  };
}

/** Backward compatibility alias */
export const parseSm20CollectionState = parsePrecisionCollectionState;

function weightedLinear(x: number[], y: number[], weights: number[], plusOne: boolean): [number, number] {
  const w = weights.map((value) => roundTiesEven(value) + (plusOne ? 1 : 1e-5));
  const total = w.reduce((sum, value) => sum + value, 0);
  const meanX = x.reduce((sum, value, index) => sum + value * w[index], 0) / total;
  const meanY = y.reduce((sum, value, index) => sum + value * w[index], 0) / total;
  const variance = x.reduce((sum, value, index) => sum + value * value * w[index], 0) / total - meanX * meanX;
  if (variance === 0) return [0, meanY];
  const covariance = x.reduce((sum, value, index) => sum + value * y[index] * w[index], 0) / total - meanX * meanY;
  const slope = covariance / variance;
  return [slope, meanY - meanX * slope];
}

function fixedInterceptSlope(x: number[], y: number[], weights: number[], intercept: number): number {
  const denominator = x.reduce((sum, value, index) => sum + value * value * weights[index], 0);
  if (denominator === 0) return 0;
  return x.reduce((sum, value, index) => sum + value * weights[index] * (y[index] - intercept), 0) / denominator;
}

function m2Interpolate(optimizer: ClassicM2Optimizer, row: number, repetitionStage: number): number {
  const stage = Math.min(20, repetitionStage);
  const lower = Math.min(20, Math.max(1, Math.min(20, Math.floor(stage))));
  const upper = Math.min(20, lower + 1);
  const left = optimizer.matrix[row - 1][lower - 1];
  const right = optimizer.matrix[row - 1][upper - 1];
  return left + (stage - lower) * (right - left);
}

function m2RepetitionStage(optimizer: ClassicM2Optimizer, used: number, factor: number): number {
  let previous = optimizer.matrix[0][0];
  let current = previous;
  let stage = 2;
  const row = aBucket(factor);
  while (current < used && stage < 20) {
    previous = current;
    current *= optimizer.matrix[row - 1][stage - 1];
    stage += 1;
  }
  const result = stage < 3 || current === previous
    ? 1 : stage - 2 + (used - previous) / (current - previous);
  return clamp(result, 2, 20);
}

function m2ForgettingRate(optimizer: ClassicM2Optimizer, row: number, repetition: number): number {
  const ri = row - 1;
  const ci = repetition - 1;
  if (optimizer.cell_cases[ri][ci] === 0) return -Math.log(0.9) / optimizer.empirical[ri][ci];
  const x: number[] = [];
  const y: number[] = [];
  const weights: number[] = [];
  for (let bin = 1; bin <= 20; bin += 1) {
    const total = optimizer.observed[ri][ci][bin - 1];
    const success = optimizer.remembered[ri][ci][bin - 1];
    x.push(uValue(row, repetition, bin));
    weights.push(total);
    y.push(total === 0 ? 0 : success === 0 ? -3 : Math.max(-3, Math.log(success / total)));
  }
  return -fixedInterceptSlope(x, y, weights, 0);
}

function rebuildM2(optimizer: ClassicM2Optimizer): void {
  const x = Array.from({ length: 20 }, (_, index) => index);
  const y = optimizer.empirical.map((row) => Math.log(Math.max(row[0], 1e-300)));
  const weights = optimizer.cell_cases.map((row) => row[0] + 1);
  const [slope, intercept] = weightedLinear(x, y, weights, true);
  for (let index = 0; index < 20; index += 1) {
    optimizer.matrix[index][0] = q(clamp(Math.exp(slope * index + intercept), 1, 20));
  }
  for (let row = 2; row <= 20; row += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (let repetition = 3; repetition <= 20; repetition += 1) {
      xs.push(Math.log(repetition - 1));
      const optimum = optimizer.empirical[row - 1][repetition - 1];
      ys.push(clamp(optimum <= 1.21 ? -10000 : Math.log(optimum - 1.2), -4, 4));
      ws.push(optimizer.cell_cases[row - 1][repetition - 1]);
    }
    if (!ws.some((value) => value > 0)) ws[ws.length - 1] = 1;
    const exponent = clamp(-fixedInterceptSlope(xs, ys, ws, Math.log(aAxis(row) - 1.2)), 0, 3);
    optimizer.row_exponent[row - 1] = roundTiesEven(exponent * 10000) / 10000;
    optimizer.row_weight[row - 1] = Math.min(60000, ws.reduce((sum, value) => sum + roundTiesEven(value), 0));
  }
  const fitX = [1.2];
  const fitY = [1];
  const fitW = [1];
  for (let row = 2; row <= 20; row += 1) {
    fitX.push(aAxis(row));
    fitY.push(optimizer.row_exponent[row - 1]);
    fitW.push(optimizer.row_weight[row - 1]);
  }
  let [decaySlope, decayIntercept] = weightedLinear(fitX, fitY, fitW, false);
  if (decaySlope < -0.5 || decaySlope > 0.5) {
    const anchor = decaySlope * 3.6 + decayIntercept;
    decaySlope = clamp(decaySlope, -0.5, 0.5);
    decayIntercept = anchor - decaySlope * 3.6;
  }
  for (let row = 2; row <= 20; row += 1) {
    const exponent = clamp(decaySlope * aAxis(row) + decayIntercept, 0, 3);
    for (let repetition = 2; repetition <= 20; repetition += 1) {
      optimizer.matrix[row - 1][repetition - 1] = q((repetition - 1) ** -exponent * (aAxis(row) - 1.2) + 1.2);
    }
  }
}

function recordM2(
  optimizer: ClassicM2Optimizer,
  row: number,
  repetition: number,
  observedU: number,
  remembered: boolean,
  random: () => number,
): void {
  const bin = uBucket(row, repetition, observedU);
  const ri = row - 1;
  const ci = repetition - 1;
  const bi = bin - 1;
  let effectiveRemembered = remembered;
  if (bin === 20 && !remembered) {
    const rate = m2ForgettingRate(optimizer, row, repetition);
    const represented = Math.exp(-rate * uValue(row, repetition, 20));
    const actual = Math.exp(-rate * observedU);
    if (random() < represented - actual) effectiveRemembered = true;
  }
  if (effectiveRemembered) optimizer.remembered[ri][ci][bi] = Math.min(255, optimizer.remembered[ri][ci][bi] + 1);
  optimizer.observed[ri][ci][bi] = Math.min(255, optimizer.observed[ri][ci][bi] + 1);
  if (optimizer.observed[ri][ci][bi] > 250) {
    optimizer.observed[ri][ci][bi] >>= 1;
    optimizer.remembered[ri][ci][bi] >>= 1;
  }
  optimizer.cell_cases[ri][ci] = Math.min(60000, optimizer.cell_cases[ri][ci] + 1);
  const rate = m2ForgettingRate(optimizer, row, repetition);
  let optimum = rate === 0 ? uValue(row, repetition, 20) : -Math.log(0.9) / rate;
  optimum = repetition === 1 ? clamp(optimum, 1, 20) : clamp(optimum, 1.2, aAxis(row));
  optimizer.empirical[ri][ci] = q(optimum);
  rebuildM2(optimizer);
}

function gradeFit(optimizer: ClassicM2Optimizer): [number, number] {
  return weightedLinear(
    Array.from({ length: 18 }, (_, index) => index + 3),
    optimizer.second_grade.map((value) => Math.max(-5, Math.log(Math.max(value, 1e-300)))),
    optimizer.second_grade_cases,
    true,
  );
}

function firstGradeFit(optimizer: ClassicM2Optimizer): [number, number] {
  const [slope, intercept] = weightedLinear(
    Array.from({ length: 20 }, (_, index) => aAxis(index + 1)),
    optimizer.first_grade.map((value) => Math.log(Math.max(5.2 - clamp(value, 0, 5), 1e-300))),
    optimizer.first_grade_cases,
    true,
  );
  return [Math.min(0, slope), intercept];
}

const gradeAt = (value: number, slope: number, intercept: number): number =>
  clamp(Math.exp(clamp(slope * value + intercept, -38, 38)), 0.1, 5);

function newAFactor(
  optimizer: ClassicM2Optimizer,
  item: M2ItemState,
  grade: number,
  used: number,
  observedU: number,
  stage: number,
): [number, number] {
  if (item.repetitions === 0) return [((grade - 4) * 0.3 + 3) * 0.6 + 0.4 * item.a_factor, 10];
  const [slope, intercept] = gradeFit(optimizer);
  const optimum = item.repetitions === 1
    ? optimizer.matrix[Math.min(20, item.lapses + 1) - 1][0]
    : m2Interpolate(optimizer, aBucket(item.a_factor), stage);
  const retrievability = Math.exp(observedU / optimum * Math.log(0.9));
  const predictedFi = clamp((1 - retrievability) * 100, 0.1, 99.5);
  const inferredFi = slope === 0 ? 50 : clamp((Math.log(Math.max(grade, 0.3)) - intercept) / slope, 0.2, 90);
  const g10 = gradeAt(10, slope, intercept);
  const gPredicted = gradeAt(predictedFi, slope, intercept);
  let fitted = clamp((
    gradeAt(inferredFi / predictedFi * 10, slope, intercept)
    + gradeAt(inferredFi + 10 - predictedFi, slope, intercept)
    + grade * (g10 / gPredicted)
    + g10 + grade - gPredicted
  ) * 0.25, 0, 5);
  fitted = grade < 3 ? Math.min(fitted, 2.5) : Math.max(fitted, 2.5);
  let nextA: number;
  if (item.repetitions === 1 && item.lapses === 0) {
    const [firstSlope, firstIntercept] = firstGradeFit(optimizer);
    const inferredA = firstSlope === 0 ? 6.9
      : clamp((Math.log(5.2 - fitted) - firstIntercept) / firstSlope, 1.2, 6.9);
    nextA = 0.85 * inferredA + 0.15 * item.a_factor;
  } else if (item.repetitions === 1) {
    nextA = 0.4 * ((grade - 4) * 0.3 + 3) + 0.6 * item.a_factor;
  } else {
    const denominator = Math.log(1 - inferredFi / 100);
    const targetInterval = denominator === 0 ? used : used * Math.log(0.9) / denominator;
    const targetU = targetInterval / used * observedU;
    let row = 20;
    while (row > 0 && m2Interpolate(optimizer, row, stage) >= targetU) row -= 1;
    nextA = 0.4 * aAxis(Math.max(1, row)) + 0.6 * item.a_factor;
  }
  return [nextA, predictedFi];
}

function updateM2GradeGraphs(
  optimizer: ClassicM2Optimizer,
  nextA: number,
  predictedFi: number,
  grade: number,
  oldRepetitions: number,
  oldLapses: number,
): void {
  const index = Math.max(0, Math.min(18, Math.max(1, roundTiesEven(predictedFi))) - 1);
  optimizer.second_grade_cases[index] = Math.min(60000, optimizer.second_grade_cases[index] + 1);
  const count = optimizer.second_grade_cases[index];
  const alpha = 1 / (10 * Math.log(count + 2));
  optimizer.second_grade[index] = real48(optimizer.second_grade[index] * (1 - alpha) + alpha * grade);
  if (oldRepetitions !== 0 && !(oldRepetitions === 1 && oldLapses === 0) && grade < 6) {
    const row = aBucket(nextA) - 1;
    optimizer.first_grade_cases[row] = Math.min(60000, optimizer.first_grade_cases[row] + 1);
    const graphAlpha = oldRepetitions === 2 ? 0.15 : 0.07;
    optimizer.first_grade[row] = real48(clamp(
      (1 - graphAlpha) * optimizer.first_grade[row] + graphAlpha * grade, 0, 5,
    ));
  }
}

function correctEarlyFactor(factor: number, scheduled: number, used: number): [number, number] {
  if (used >= scheduled) return [factor, used];
  const difference = scheduled - used;
  const previous = scheduled - 1;
  const scale = scheduled * 0.4;
  const candidate = (factor - 1) * (previous + scale) / previous;
  const deduction = candidate * difference / (scale + difference);
  const corrected = Math.min(factor, factor - deduction);
  const adjusted = roundTiesEven(scheduled * corrected / factor);
  return [corrected, Math.min(scheduled, Math.max(used, adjusted))];
}

export function reviewM2(
  item: M2ItemState,
  optimizer: ClassicM2Optimizer,
  today: number,
  grade: number,
  forgettingIndex: number,
  commit: boolean,
  random: () => number = Math.random,
): M2ReviewResult {
  // Shallow-copy the optimizer, slicing every mutable nested array so the
  // non-commit path never mutates the caller's optimizer. ClassicM2Optimizer
  // holds three `number[][]` matrices (matrix/empirical/cell_cases) and two
  // `number[][][]` cubes (remembered/observed); recordM2/rebuildM2/
  // updateM2GradeGraphs write through two levels (e.g.
  // working.remembered[ri][ci][bi]), so each row AND each cell of the cubes
  // must be a fresh array. The 1-D scalar fields (row_exponent, row_weight,
  // first_grade*, second_grade*) are sliced once. This is a faithful,
  // allocation-light replacement for the recursive structuredClone walk that
  // previously dominated the per-review hot path.
  const working: ClassicM2Optimizer = commit ? optimizer : {
    matrix: optimizer.matrix.map((row) => row.slice()),
    empirical: optimizer.empirical.map((row) => row.slice()),
    cell_cases: optimizer.cell_cases.map((row) => row.slice()),
    remembered: optimizer.remembered.map((row) => row.map((cell) => cell.slice())),
    observed: optimizer.observed.map((row) => row.map((cell) => cell.slice())),
    row_exponent: optimizer.row_exponent.slice(),
    row_weight: optimizer.row_weight.slice(),
    first_grade: optimizer.first_grade.slice(),
    first_grade_cases: optimizer.first_grade_cases.slice(),
    second_grade: optimizer.second_grade.slice(),
    second_grade_cases: optimizer.second_grade_cases.slice(),
  };
  let used = item.last_review_day < 0 ? 0 : Math.max(1, today - item.last_review_day);
  const remembered = grade >= 3;
  const repetitions = remembered ? Math.min(20, item.repetitions + 1) : 1;
  const lapses = remembered ? Math.min(19, item.lapses)
    : item.repetitions === 0 ? 0 : Math.min(19, item.lapses + 1);
  let stage = 1;
  let observedU = item.u_factor;
  if (item.repetitions !== 0) {
    const scheduled = Math.max(1, item.previous_interval);
    used = Math.max(1, used);
    observedU = used / scheduled * item.u_factor;
    stage = m2RepetitionStage(working, used, item.a_factor);
    const row = item.repetitions === 1 ? Math.min(20, item.lapses + 1) : aBucket(item.a_factor);
    const repetition = item.repetitions === 1 ? 1 : Math.min(20, Math.max(1, roundTiesEven(stage)));
    recordM2(working, row, repetition, observedU, remembered, random);
  }
  const [nextA, predictedFi] = newAFactor(working, item, grade, Math.max(1, used), observedU, stage);
  let adjustedUsed = Math.max(1, used);
  let base: number;
  if (repetitions === 1) {
    base = working.matrix[Math.min(20, lapses + 1) - 1][0];
  } else {
    let factor = m2Interpolate(working, aBucket(nextA), stage + 1);
    [factor, adjustedUsed] = correctEarlyFactor(factor, Math.max(1, item.previous_interval), Math.max(1, used));
    base = Math.max(Math.max(1, item.previous_interval), Math.max(1, used)) * factor;
  }
  const fiFactor = Math.log(1 - forgettingIndex / 100) / Math.log(0.9);
  const stability = Math.max(1, roundTiesEven(base * fiFactor));
  const nextU = repetitions === 1 ? stability : Math.max(1, stability / adjustedUsed);
  if (item.repetitions !== 0) {
    updateM2GradeGraphs(working, nextA, predictedFi, grade, item.repetitions, item.lapses);
  }
  return {
    stability,
    used_interval: used,
    next_item: {
      last_review_day: today,
      previous_interval: 0,
      repetitions,
      lapses,
      a_factor: nextA,
      u_factor: nextU,
    },
  };
}

const matrixOffset = (d: number, s: number, r: number): number =>
  (d - 1) * 441 + (s - 1) * 21 + r - 1;
const lapseOffset = (r: number, stage: number, interval: number): number =>
  (r - 1) * 21 * 36 + (stage - 1) * 36 + interval - 1;
const clampR = (value: number): number => value <= -1 ? 0.995 : value <= 0.005 ? 0.005 : value >= 0.995 ? 0.995 : value;
const clampS = (value: number): number => value <= -1 ? 44530 : value <= 0.7 ? 0.7 : value >= 44530 ? 44530 : value;

export function rIndex(value: number): number {
  return clamp(roundTiesEven(Math.exp(value * Math.log(20))), 1, 20);
}

export function sIndex(value: number): number {
  const d = Math.max(0, clampS(value) - 2);
  let index = roundTiesEven(delphiPow(d, 1 / 2.903969365022566)) + 1;
  index = Math.min(20, index);
  return index === 0 ? 1 : index;
}

export function dIndex(value: number): number {
  return value >= 0 && value <= 1 ? roundTiesEven(value * 19) + 1 : 10;
}

function wlsRegression(xs: number[], ys: number[], counts: number[]): [number, number] {
  let sy = 0; let sx = 0; let sxx = 0; let sxy = 0; let sw = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const weight = roundTiesEven(counts[index]) + 1e-5;
    sy += ys[index] * weight;
    sx += xs[index] * weight;
    sxx += xs[index] * xs[index] * weight;
    sxy += xs[index] * ys[index] * weight;
    sw += weight;
  }
  const xbar = sx / sw;
  const slope = (sxy / sw - xbar * sy / sw) / (sxx / sw - xbar * xbar);
  return [slope, sy / sw - xbar * slope];
}

function buildAxisAndFit(d: number, s: number, intervals: number[], counts: number[]): [number, number, number] {
  const xs: number[] = []; const ys: number[] = []; const weights: number[] = [];
  let total = 0;
  for (let r = 1; r <= 20; r += 1) {
    const axis = Math.log(r) / Math.log(20);
    const off = matrixOffset(d, s, r);
    const count = counts[off];
    total += roundTiesEven(count);
    const prior = count <= 0 ? axis * 0.64 + 0.3 : intervals[off] / count;
    xs.push(axis); ys.push(prior > 0 ? Math.log(prior) : 0); weights.push(count);
  }
  const [slope, intercept] = wlsRegression(xs, ys, weights);
  return [slope, intercept, total];
}

function predictedBlend(old: number, sinc: number, grade: number, reps: number, lapses: number): number {
  const recall = grade >= 3 ? 1 : 0;
  const target = (-(recall - sinc) + 0.1) * 9;
  let weight = reps === 2 && lapses === 0 ? 0.7 : 0.2;
  if ((recall === 1 && old < target) || (recall === 0 && target < old)) weight /= 2;
  return clamp(weight * target + (1 - weight) * old, 0, 1);
}

function stabilityIncrease(old: number, matrix: number, count: number, grade: number, next: number): number {
  const pass = grade >= 3;
  const fail = !pass;
  let wCount = 0.01;
  let wDiff = 200;
  if (pass) {
    if (old <= next) wCount = sigmoidRatio(next / old, 3) * 100;
    wDiff = sigmoidRatio(count, 333) * 1.25;
  }
  if (fail) {
    if (next <= old) wCount = sigmoidRatio(1 - next / old, 1) * 200;
    wDiff = 1;
  }
  return (matrix * (100 + wDiff) + old * 175 + next * wCount) / (wDiff + 100 + 175 + wCount);
}

function roundRatio(value: number, pass: boolean): number {
  if (!pass) return value > 2 ? 2 : value <= 0.5 ? 0.5 : value;
  return value > 20 ? 20 : value <= 0.8 ? 0.8 : value;
}

function intervalAxisValue(index: number): number {
  return Math.max(index, Math.ceil(1.4 ** (index - 12.5)));
}

function forgettingCurveFit(successes: number[], observations: number[], prior: number): number {
  const n = Math.min(successes.length, 35);
  const ratios = Array<number>(35).fill(0);
  let totalSuccess = 0; let totalObserved = 0;
  for (let index = 0; index < n; index += 1) {
    if (observations[index] === 0) ratios[index] = 0.1;
    else {
      ratios[index] = Math.max(0.1, successes[index] / observations[index]);
      totalSuccess += roundTiesEven(successes[index]);
      totalObserved += roundTiesEven(observations[index]);
    }
  }
  if (totalObserved === 0) return prior;
  const overallRaw = totalSuccess / totalObserved;
  if (overallRaw > 0.99) return prior;
  const overall = Math.max(0.1, Math.min(0.9999, overallRaw));
  const xs = Array.from({ length: n }, (_, index) => Math.log(intervalAxisValue(index + 1)));
  const ys = ratios.slice(0, n).map(Math.log);
  let [slope, intercept] = wlsRegression(xs, ys, observations.slice(0, n));
  const target = Math.log(0.9);
  const hi = Math.log(0.9999);
  const lo = Math.log(0.1);
  const priorIntercept = Math.log(delphiPow(prior, 0.07) * 0.9);
  if (hi < intercept) {
    slope = slope * (target - hi) / (target - intercept);
    intercept = hi;
  }
  if (intercept < lo) intercept = lo;
  let minimumSlope = -0.001;
  if (0.9 < overall) minimumSlope = (target - Math.log(overall)) / Math.log(365);
  if (minimumSlope < slope) { intercept = Math.log(overall); slope = minimumSlope; }
  slope = Math.max(-3, slope);
  const dataWeight = sigmoidRatio(totalObserved, 100);
  slope = slope * dataWeight - 0.07 * (1 - dataWeight);
  intercept = intercept * dataWeight + priorIntercept * (1 - dataWeight);
  const fitted = Math.exp((target - intercept) / slope);
  const outputWeight = sigmoidRatio(totalObserved, 50);
  return fitted * outputWeight + prior * (1 - outputWeight);
}

function lapseCellFit(r: number, stage: number, state: M3MatrixState): [number, number] {
  const successes: number[] = []; const observations: number[] = [];
  for (let interval = 1; interval <= 35; interval += 1) {
    const off = lapseOffset(r, stage, interval);
    successes.push(state.lapse_remembered[off]); observations.push(state.lapse_observed[off]);
  }
  return [clamp(forgettingCurveFit(successes, observations, 1), 0.1, 11), observations.reduce((a, b) => a + b, 0)];
}

function lapseNeighbor(retrievability: number, stage: number, state: M3MatrixState): [number, number] {
  const centerR = rIndex(retrievability);
  const centerStage = clamp(stage, 1, 20);
  const neighbors = [[0, 0, 16], [-1, 0, 4], [1, 0, 4], [0, -1, 1], [0, 1, 1]];
  const weighted: Array<[number, number]> = [];
  for (const [dr, ds, multiplier] of neighbors) {
    const r = centerR + dr; const s = centerStage + ds;
    if (r >= 1 && r <= 20 && s >= 1 && s <= 20) {
      const [value, count] = lapseCellFit(r, s, state);
      weighted.push([value, count * multiplier]);
    }
  }
  const total = weighted.reduce((sum, [, count]) => sum + count, 0);
  return total === 0 ? [weighted[0][0], 0]
    : [weighted.reduce((sum, [value, count]) => sum + value * count, 0) / total, total];
}

function intervalCategory(interval: number): number {
  const value = Math.max(1, interval);
  return clamp(Math.min(value, roundTiesEven(Math.log(value) / Math.log(1.4)) + 12), 1, 35);
}

function recordM3Outcome(state: M3MatrixState, d: number, s: number, r: number, grade: number): void {
  const off = matrixOffset(d, s, r);
  state.outcome_count[off] += 1;
  if (grade >= 3) state.outcome_success[off] += 1;
}

function recordPreLapse(
  state: M3MatrixState,
  reps: number,
  lapses: number,
  previousR: number,
  interval: number,
  grade: number,
): void {
  if (reps !== 1) return;
  if (lapses > 0) {
    const off = lapseOffset(clamp(previousR, 1, 20), clamp(lapses, 1, 20), clamp(interval, 1, 36));
    state.lapse_observed[off] += 1;
    if (grade >= 3) state.lapse_remembered[off] += 1;
  } else {
    const off = clamp(interval, 1, 36) - 1;
    state.first_stage_observed[off] += 1;
    if (grade >= 3) state.first_stage_remembered[off] += 1;
  }
}

function w3Path(
  t: number,
  reps: number,
  lapses: number,
  grade: number,
  difficulty: number,
  oldStability: number,
  retrievability: number,
  state: M3MatrixState,
): [number, number] {
  const r = rIndex(retrievability); const s = sIndex(oldStability); const d = dIndex(difficulty);
  const [slope, intercept, total] = buildAxisAndFit(d, s, state.outcome_success, state.outcome_count);
  const sincInterval = clampR(Math.exp(clamp(slope * retrievability + intercept, -38, 38)));
  const newSFromMatrix = clampR(sigmoidRatio(total, 3.5) * sincInterval + (1 - sigmoidRatio(total, 3.5)) * retrievability);
  const dBlend = predictedBlend(difficulty, newSFromMatrix, grade, reps, lapses);
  const estimated = clampS(-Math.log(0.9) * t / -Math.log(newSFromMatrix));
  const newS = stabilityIncrease(oldStability, estimated, total, grade, t);
  let matrixEntry: number;
  if (grade < 3) {
    const stage = roundTiesEven(lapses) + 1;
    const [neighbor, count] = lapseNeighbor(newSFromMatrix, stage, state);
    const prior = delphiPow(newSFromMatrix, 1.8) * 3.5 * Math.exp(stage * -0.27) + 0.6;
    const weight = sigmoidRatio(count, 10);
    matrixEntry = (1 - weight) * prior + weight * neighbor;
  } else {
    const a = 3 + 12 * (1 - dBlend);
    const b = delphiPow(oldStability, -0.08 + dBlend * (-0.35 + 0.08));
    const priorBase = (a - 1) * b + 1;
    const priorInterval = roundRatio(priorBase * Math.exp(-Math.min(600, dBlend * -2 + 2.25) * retrievability), true);
    const off = matrixOffset(dIndex(dBlend), s, r);
    const measurementWeight = t;
    const cap = Math.min(measurementWeight, 1);
    let lo = Math.max(measurementWeight * state.smoothing_value[off], measurementWeight * priorInterval);
    if (lo < newS) lo = newS + cap;
    const weight = sigmoidRatio(state.smoothing_count[off], 300);
    matrixEntry = newS * ((priorInterval + weight * 10 * state.smoothing_value[off]) / (weight * 10 + 1));
    if (lo < matrixEntry) matrixEntry = lo;
    if (matrixEntry < 0.1) matrixEntry = 0.1;
  }
  return [matrixEntry, dBlend];
}

export function reviewM3(
  item: M3ItemState,
  matrices: M3MatrixState,
  today: number,
  grade: number,
  commit: boolean,
): M3ReviewResult {
  // Shallow-copy the matrices: M3MatrixState is a flat bag of `number[]`
  // arrays, and the non-commit path must not mutate the caller's matrices.
  // The only writes land on these 8 arrays (recordM3Outcome, recordPreLapse,
  // and the smoothing update below), so slicing each one is a faithful,
  // allocation-light replacement for the recursive structuredClone walk over
  // ~57k elements. Array.prototype.slice hits V8's copy fast path.
  const working: M3MatrixState = commit ? matrices : {
    outcome_count: matrices.outcome_count.slice(),
    outcome_success: matrices.outcome_success.slice(),
    smoothing_count: matrices.smoothing_count.slice(),
    smoothing_value: matrices.smoothing_value.slice(),
    lapse_observed: matrices.lapse_observed.slice(),
    lapse_remembered: matrices.lapse_remembered.slice(),
    first_stage_observed: matrices.first_stage_observed.slice(),
    first_stage_remembered: matrices.first_stage_remembered.slice(),
  };
  const elapsed = item.last_review_day < 0 ? 0 : Math.max(0, today - item.last_review_day);
  const base = item.previous_interval !== 0 ? Math.max(item.previous_interval, 1) : Math.max(item.stability, 1);
  const retrievability = clampR(Math.exp(Math.log(0.9) * elapsed / base));
  const repetitions = grade >= 3 ? Math.min(65535, item.repetitions + 1) : 1;
  const lapses = grade >= 3 ? item.lapses : item.repetitions > 0 ? Math.min(65535, item.lapses + 1) : item.lapses;
  const oldStability = clampS(item.stability);
  const preD = dIndex(item.difficulty); const preS = sIndex(oldStability); const preR = rIndex(retrievability);
  recordM3Outcome(working, preD, preS, preR, grade);
  recordPreLapse(working, item.repetitions, item.lapses, item.previous_r_index || preR, intervalCategory(elapsed), grade);
  const [stability, dBlend] = w3Path(
    Math.max(elapsed, 1), repetitions, lapses, grade, item.difficulty, oldStability, retrievability, working,
  );
  if (stability > 0 && item.previous_stability_index > 0) {
    const off = matrixOffset(preD, item.previous_stability_index, preR);
    const count = working.smoothing_count[off];
    working.smoothing_value[off] = (working.smoothing_value[off] * count + stability) / (count + 1);
    working.smoothing_count[off] += 1;
  }
  return {
    stability,
    retrievability,
    elapsed,
    d_blend: dBlend,
    next_item: {
      last_review_day: today,
      previous_interval: 0,
      repetitions,
      lapses,
      stability,
      difficulty: dBlend,
      previous_stability: oldStability,
      previous_stability_index: preS,
      previous_r_index: preR,
    },
  };
}

const ARENA_CLAMPS: Array<[number, number]> = [[0.1, 30], [2, 50], [25, 99.9], [15, 95], [0.1, 45]];

function sanitizeArenaState(state: ArenaState): ArenaState {
  const fresh = freshArenaState();
  const validWeights = state.weights.every((value) => Number.isFinite(value) && value >= 0)
    && state.weights.reduce((sum, value) => sum + value, 0) > 0;
  const sourceWeights = validWeights ? state.weights : fresh.weights;
  const total = sourceWeights.reduce((sum, value) => sum + value, 0);
  const validDiagnostics = Number.isFinite(state.decayed_count) && state.decayed_count >= 0;
  return {
    weights: sourceWeights.map((value) => value / total * 100) as ArenaWeights,
    decayed_loss: validDiagnostics ? state.decayed_loss : fresh.decayed_loss,
    decayed_blend_loss: validDiagnostics ? state.decayed_blend_loss : 0,
    decayed_baseline_loss: validDiagnostics ? (state.decayed_baseline_loss ?? state.decayed_sm19_loss ?? 0) : 0,
    decayed_sm19_loss: validDiagnostics ? (state.decayed_baseline_loss ?? state.decayed_sm19_loss ?? 0) : 0,
    decayed_count: validDiagnostics ? state.decayed_count : 0,
    total_scored: Number.isFinite(state.total_scored) ? Math.max(0, Math.trunc(state.total_scored)) : 0,
  };
}

export function observeArena(
  arena: ArenaState,
  slotStabilities: ArenaWeights,
  elapsedDays: number,
  recalled: boolean,
): void {
  if (elapsedDays < 1 || !slotStabilities.every(Number.isFinite)) return;
  const predictions = slotStabilities.map((stability) =>
    clamp(0.9 ** (elapsedDays / Math.max(stability, 0.01)), 0.01, 0.99)) as ArenaWeights;
  const outcome = recalled ? 1 : 0;
  const losses = predictions.map((prediction) =>
    -(outcome * Math.log(prediction) + (1 - outcome) * Math.log(1 - prediction))) as ArenaWeights;
  const totalWeight = arena.weights.reduce((sum, value) => sum + value, 0);
  const blendPrediction = predictions.reduce((sum, value, index) => sum + value * arena.weights[index], 0) / totalWeight;
  const blendLoss = -(outcome * Math.log(blendPrediction) + (1 - outcome) * Math.log(1 - blendPrediction));
  for (let index = 0; index < 5; index += 1) arena.decayed_loss[index] = arena.decayed_loss[index] * 0.995 + losses[index];
  arena.decayed_blend_loss = arena.decayed_blend_loss * 0.995 + blendLoss;
  arena.decayed_baseline_loss = (arena.decayed_baseline_loss ?? 0) * 0.995 + losses[2];
  arena.decayed_sm19_loss = arena.decayed_baseline_loss;
  arena.decayed_count = arena.decayed_count * 0.995 + 1;
  arena.total_scored += 1;
  const errors = predictions.map((prediction) => outcome - prediction);
  const mean = errors.reduce((sum, value) => sum + value, 0) / 5;
  for (let index = 0; index < 5; index += 1) {
    arena.weights[index] *= Math.exp(clamp(mean - errors[index], -0.5, 0.5) * 0.0317);
    arena.weights[index] = clamp(arena.weights[index], ...ARENA_CLAMPS[index]);
  }
  const total = arena.weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < 5; index += 1) arena.weights[index] = arena.weights[index] / total * 100;
}

/** Chrono `Utc::now().date_naive().num_days_from_ce()` parity. */
export function currentDayFromCe(now = new Date()): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000) + 719_163;
}
