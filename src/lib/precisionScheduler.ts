/**
 * Plethora Precision scheduler — Algorithm Arena (TypeScript mirror).
 *
 * Browser/PWA mirror of `src-tauri/src/algorithms/precision/`. Five-model
 * weighted ensemble (M1–M5):
 *
 * Pipeline:
 *   ensemble = (6·M1 + 14·M2 + 45·M3 + 25·M4 + 10·M5) / 100
 *   adjusted = ln(1 - FI/100) / ln(0.9) · ensemble
 *   interval = clamp(round(clamp(adjusted, 0.7, 44530)), 1, 44530)
 */

import {
  currentDayFromCe,
  DEFAULT_M2_ITEM_STATE,
  DEFAULT_M3_ITEM_STATE,
  freshPrecisionCollectionState,
  observeArena,
  reviewM2,
  reviewM3,
  roundTiesEven,
  type ArenaWeights,
  type M2ItemState,
  type M3ItemState,
  type PrecisionCollectionState,
} from './precisionCollection';
import { fsrs, type FSRSState } from 'ts-fsrs';

export type { PrecisionCollectionState } from './precisionCollection';
export { freshPrecisionCollectionState, currentDayFromCe } from './precisionCollection';

// =============================================================================
// CONSTANTS
// =============================================================================

export const STABILITY_MAX = 44530.0;
const STABILITY_CAP = 0.7;

// Ensemble weights — immediates in FUN_00af4580 [ASM]
// Finalization — FUN_00cf5b50
const FI_ONE = 1.0;
const FI_DIV = 100.0;
const FORGET_BASE = 0.9;
const CLAMP_HI = 44530.0;
const CLAMP_LO = 0.7;
const INT_HI = 44530;
const INT_LO = 1;

// Dispersal — FUN_00cf5100
const DISP_EXP_A = -0.191;
const DISP_MULT_A = 0.76;
const DISP_EXP_B = -0.42;
const DISP_MULT_B = 3.0;
const DISP_RAND_EXP = 1.6;
const DISP_THRESH = 0.5;

// Post-lapse — FUN_00ce2fe0
const PL_DIV = 100.0;
const PL_SCALE = -5.0;
const PL_TARGET = 9.0;
const PL_JITTER = 0.2;
const PL_LO = 1.0;
const PL_HI = 11.0;

const DEFAULT_FI = 10;

// M4 FSRS kernel — 35 parameters at VA 0x10cad90 [BIN]
const P: readonly number[] = [
  0.9286298950420208,   // [0]  expert1 power-law base
  347.85204578386566,   // [1]  mixture: S denom
  0.30270230764837086,  // [2]  mixture: D denom w1
  0.4078726801204931,   // [3]  mixture: D denom w2
  767.8438603670941,    // [4]  mixture: S denom w3
  7.894742385544259,    // [5]  init_s default
  4.08242569493503,     // [6]  init_s[0]
  1.996431220980246,    // [7]  init_s[1]
  9.170585471775675,    // [8]  init_s[2]
  1.1425608073008684,   // [9]  init_s[3]
  17.65771045770738,    // [10] init_s[4]
  77.77877780253718,    // [11] init_s[5]
  0.5921926894783989,   // [12] init_d default
  0.6895479373487655,   // [13] init_d[0]
  0.6472785530963361,   // [14] init_d[1]
  0.4208423230793679,   // [15] init_d[2]
  0.5186353666458963,   // [16] init_d[3]
  0.27244747048223983,  // [17] init_d[4]
  0.3261492383691367,   // [18] init_d[5]
  1.680034668443124,    // [19] lapse base scale
  5.928185533585771,    // [20] lapse S weight denom
  2.0150955428514656,   // [21] lapse S multiplier
  0.2555216135743039,   // [22] lapse retrov denom
  1.9926553104343092,   // [23] lapse retrov multiplier
  95.04137758278812,    // [24] difficulty S weight denom
  42.21989471200275,    // [25] recall blend high
  3.1089639864486682,   // [26] recall blend low
  1.3558071518966488,   // [27] recall base factor
  0.9250460852489478,   // [28] recall hard bonus base
  0.8538692150895362,   // [29] recall hard bonus weight
  0.9559110660552212,   // [30] recall hard bonus ratio denom
  -0.6915519353695037,  // [31] recall time exponent
  1.0037797256248404,   // [32] recall signal D coefficient
  1.393910494789472,    // [33] recall signal offset
  0.12374729387559685,  // [34] recall grade multiplier
];

// Embedded .text constants [BIN]
const DAT_ZERO = 0.0;
const DAT_ONE = 1.0;
const DAT_0_9 = 0.9;
const DAT_2_0 = 2.0;
const DAT_DECAY = 0.10536051565782628;
const LOG2_09 = Math.log(0.9) / Math.log(2.0);

// =============================================================================
// HELPERS
// =============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sigmoidRatio(x: number, y: number): number {
  const s = x + y;
  return s === 0 ? 0 : x / s;
}

function delphiExp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  return Math.exp(x);
}

function delphiPow(base: number, exp: number): number {
  if (base > 0) return delphiExp(exp * Math.log(base));
  return 0;
}

function signFlip(v: number): number {
  return -v;
}

// =============================================================================
// TYPES
// =============================================================================

export interface PrecisionState {
  version: number;
  stability: number;
  difficulty: number;
  repetition: number;
  lapses: number;
  interval: number;
  last_quality: number;
  algorithm_branch?: number;
  retrov?: number;
  s_factor?: number;
  multiplier?: number;
  m1_state?: M1ItemState;
  m1_history?: M1HistoryPoint | null;
  m2_state?: M2ItemState;
  m3_state?: M3ItemState;
  slot_stabilities?: [number, number, number, number, number] | null;
  m5_memory?: { stability: number; difficulty: number } | null;
  post_lapse_family?: number;
  lapse_ordinal?: number;
}

export interface PrecisionReviewResult {
  state: PrecisionState;
  interval_days: number;
  retrievability: number;
  model_intervals: [number, number, number, number, number];
}

export interface PrecisionPreviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface M1ItemState {
  last_review_day: number;
  previous_interval: number;
  repetitions: number;
  lapses: number;
}

interface M1HistoryPoint {
  factor: number;
  stability: number;
}

const DEFAULT_M1_STATE: M1ItemState = {
  last_review_day: -1, previous_interval: 0, repetitions: 0, lapses: 0,
};

const DEFAULT_M2_STATE = DEFAULT_M2_ITEM_STATE;
const DEFAULT_M3_STATE = DEFAULT_M3_ITEM_STATE;

// =============================================================================
// M4: FSRS 35-PARAM KERNEL (25%) — FUN_00af9420 [C][ASM][BIN]
// =============================================================================

function expert1(p0: number, t: number, s: number): number {
  if (!(DAT_ZERO < p0 && DAT_ZERO < s)) return 0;
  const expPow = Math.log(p0 / DAT_0_9) / Math.log(DAT_2_0);
  const ratio = s / (s + t);
  return p0 * delphiPow(ratio, expPow);
}

function expert2(t: number, s: number): number {
  if (s <= 0) return 0;
  const shifted = t / s + 1;
  if (!(DAT_ZERO < shifted)) return 0;
  return delphiPow(shifted, LOG2_09);
}

function expert3(t: number, s: number): number {
  if (!(DAT_ZERO < s)) return 0;
  const ratio = t / s;
  return delphiExp(signFlip(ratio) * DAT_DECAY);
}

function expertMixture(t: number, s: number, d: number, p: readonly number[]): number {
  const e1 = expert1(p[0], t, s);
  const e2 = expert2(t, s);
  const e3 = expert3(t, s);
  const sWeight = sigmoidRatio(s, p[1]);
  const dWeight1 = sigmoidRatio(d, p[2]);
  const dWeight2 = sigmoidRatio(d, p[3]);
  const sWeight3 = sigmoidRatio(s, p[4]);
  const w1 = ((DAT_ONE - sWeight) + dWeight1) / DAT_2_0;
  const w2 = ((DAT_ONE - sWeight) + dWeight2) / DAT_2_0;
  const w3 = sWeight3;
  const wSum = w1 + w2 + w3;
  return wSum !== 0 ? (w1 * e1 + w2 * e2 + w3 * e3) / wSum : 0;
}

function difficultyUpdate(d: number, s: number, a: number, grade: number, p: readonly number[]): number {
  const w = sigmoidRatio(s, p[24]);
  const target = grade > 2 ? DAT_ONE : DAT_ZERO;
  const dNew = w * d + (DAT_ONE - w) * (d - (target - a));
  return clamp(dNew, 0, 1);
}

function lapseStability(d: number, s: number, a: number, p: readonly number[]): number {
  const base = (DAT_ONE - d) * p[19] + DAT_ONE;
  const w = sigmoidRatio(s, p[20]);
  const mult = w * p[21] + DAT_ONE;
  const retro = sigmoidRatio(DAT_ONE - a, p[22]);
  return base * mult + retro * p[23] + DAT_ONE;
}

function recallStability(d: number, s: number, a: number, t: number, grade: number, p: readonly number[]): number {
  const sMin = Math.max(s, t);
  const hardBonus = (t < s && s > 0)
    ? p[28] + p[29] * sigmoidRatio(t / s, p[30])
    : DAT_ONE;
  const timeFactor = sMin > 0 ? delphiPow(sMin, p[31]) : 0;
  const innerRs = p[32] * (DAT_ONE - d) + p[33];
  const recallSignal = delphiExp(signFlip(innerRs) * a);
  const gradeFactor = (grade - 4) * p[34] + DAT_ONE;
  const blend = p[26] + (DAT_ONE - d) * (p[25] - p[26]);
  const inner = p[27] + (blend - p[27]) * timeFactor * recallSignal * gradeFactor;
  return sMin * hardBonus * inner;
}

interface KernelResult { s_new: number; d_new: number; a: number; }

function reviewKernel(t: number, grade: number, d: number, s: number, p: readonly number[] = P): KernelResult {
  const a = expertMixture(t, s, d, p);
  const dNew = difficultyUpdate(d, s, a, grade, p);
  const sNew = grade < 3 ? lapseStability(dNew, s, a, p) : recallStability(dNew, s, a, t, grade, p);
  return { s_new: sNew, d_new: dNew, a };
}

function initNewItem(grade: number): [number, number] {
  const g = clamp(grade, 0, 5) | 0;
  return [P[6 + g], P[13 + g]];
}

// =============================================================================
// M5: ANALYTIC STABILITY (10%) — FUN_00ce6c70 → ce71b0 [C][ASM][BIN]
// =============================================================================

function model5(t: number, grade: number, sOld: number): number {
  const retrov = Math.pow((t / sOld) * 0.2345679012 + 1, -0.5);
  const idx = grade < 3 ? 0 : grade === 3 ? 1 : grade === 4 ? 2 : 3;
  const scale = clamp((7.1949 - Math.exp(0.5345 * 3)) + 1, 1, 10);
  const depth = -1.4604 * ([1, 2, 3, 4][idx] - 3);
  const blend = sOld + depth * (10 - sOld) / 9;
  const sNew = clamp(0.0046 * scale + 0.9954 * blend, 1, 10);

  if (idx === 0) {
    const product = Math.pow(sNew, -0.11)
      * (Math.pow(sOld + 1, 0.29605) - 1)
      * Math.exp(2.2698 * (1 - retrov)) * 1.9395;
    return clamp(product, 0.1, sOld);
  }
  const gate1 = idx === 1 ? 0.2315 : 1;
  const gate2 = idx === 3 ? 2.9898 : 1;
  const inner = (11 - sNew) * Math.pow(sOld, -0.1192)
    * (Math.exp(1.01925 * (1 - retrov)) - 1) * gate1 * gate2
    * Math.exp(1.54575) + 1;
  return sOld * inner;
}

function personalizedModel5(
  parameters: number[] | null,
  memory: PrecisionState['m5_memory'],
  elapsedDays: number,
  grade: number,
): { stability: number; memory: NonNullable<PrecisionState['m5_memory']> } | null {
  if (!parameters?.length || !parameters.every(Number.isFinite)) return null;
  try {
    const nativeParameters = Array.from(new Float32Array(parameters));
    const engine = fsrs({ w: nativeParameters, request_retention: 0.9, enable_fuzz: false });
    const prior: FSRSState | null = memory
      ? { stability: Math.fround(memory.stability), difficulty: Math.fround(memory.difficulty) }
      : null;
    const rating = grade < 3 ? 1 : grade === 3 ? 2 : grade === 4 ? 3 : 4;
    const next = engine.next_state(prior, Math.max(0, Math.round(elapsedDays)), rating);
    const stability = Math.fround(next.stability);
    const difficulty = Math.fround(next.difficulty);
    if (!Number.isFinite(stability) || stability <= 0) return null;
    return {
      stability,
      memory: { stability, difficulty },
    };
  } catch {
    return null;
  }
}

// =============================================================================
// M1: LEGACY SCHEDULER (6%) — FUN_00d43e00 [C][BIN]
// =============================================================================

const TARGET_R = 0.9;

function freshFactor(prevInterval: number, reps: number): number {
  if (reps < 3) return 2.5;
  const value = Math.pow(prevInterval / 6, 1 / (reps - 2));
  return clamp(value, 1.3, 2.5);
}

function adjustFactorForGrade(factor: number, grade: number): number {
  if (grade < 3) return factor;
  const dist = 5 - grade;
  const adj = 0.1 - dist * (dist * 0.02 + 0.08);
  return clamp(factor + adj, 1.3, 2.5);
}

interface M1ReviewResult {
  interval: number;
  usedInterval: number;
  nextItem: M1ItemState;
  nextHistory: M1HistoryPoint;
}

function model1(item: M1ItemState, today: number, grade: number, history: M1HistoryPoint | null): M1ReviewResult {
  const rawUsed = today - item.last_review_day;
  if (item.previous_interval !== 0 && rawUsed < -1) {
    throw new Error(`UsedInterval < -1 (today=${today}, last_review_day=${item.last_review_day})`);
  }
  const used = item.previous_interval !== 0 ? Math.max(1, rawUsed) : 1;
  const factor = history ? history.factor : freshFactor(item.previous_interval, item.repetitions);
  const stability = history
    ? history.stability
    : (item.repetitions >= 2 && item.previous_interval >= 1 ? item.previous_interval : 1);
  const stab = Math.max(1, stability);

  const [reps, lapses] = grade >= 3
    ? [Math.min(65535, item.repetitions + 1), item.lapses]
    : [1, item.repetitions === 0 ? 0 : Math.min(65535, item.lapses + 1)];

  const interval = reps === 1 ? 1 : reps === 2 ? Math.max(6, used) : roundTiesEven(Math.max(used, used * factor));
  const adjustedFactor = adjustFactorForGrade(factor, grade);

  return {
    interval,
    usedInterval: used,
    nextItem: { last_review_day: today, previous_interval: 0, repetitions: reps, lapses },
    nextHistory: { factor: adjustedFactor, stability: interval },
  };
}

// =============================================================================
// ENSEMBLE + FINALIZATION — FUN_00cf4d50 / cf5b50 / cf5100 / ce2fe0 [C][BIN]
// =============================================================================

function ensembleStability(weights: ArenaWeights, m1: number, m2: number, m3: number, m4: number, m5: number): number {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return m3;
  return (weights[0] * roundTiesEven(m1) + weights[1] * roundTiesEven(m2)
    + weights[2] * m3 + weights[3] * m4 + weights[4] * m5) / total;
}

function retentionFactor(fi: number): number {
  return Math.log(FI_ONE - fi / FI_DIV) / Math.log(FORGET_BASE);
}

function dispersal(adjusted: number): number {
  const dVar4 = 1 - delphiPow(adjusted, DISP_EXP_A) * DISP_MULT_A;
  const dVar5 = delphiPow(adjusted, DISP_EXP_B) * DISP_MULT_B + 1;
  const p = Math.pow(Math.random(), DISP_RAND_EXP);
  const factor = Math.random() <= DISP_THRESH ? dVar5 - 1 : dVar4 - 1;
  return adjusted + factor * p * adjusted;
}

function postLapse(adjusted: number, priorityPercent: number, deterministic: boolean): number {
  const xr = clamp(priorityPercent / PL_DIV, 0, 1);
  const f = 1 - Math.exp(xr * PL_SCALE);
  let base = adjusted + f * (PL_TARGET - adjusted);
  if (deterministic) return clamp(base, PL_LO, PL_HI);
  // Box-Muller jitter
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  base += base * PL_JITTER * gauss;
  return clamp(base, PL_LO, PL_HI);
}

function minGrowthGuard(interval: number, usedInterval: number): number {
  const used = Math.max(1, usedInterval);
  if (used >= 1461) return interval;
  const floorRatio = Math.max(used < 70 ? delphiPow(used, -0.1) * 1.7 : 1.1, 1.1);
  if (interval / used < floorRatio) {
    return Math.min(INT_HI, roundTiesEven(used * floorRatio + 0.5));
  }
  return interval;
}

function finalize(
  ensembleVal: number,
  fi: number,
  postLapseMode: boolean,
  deterministic = false,
  postLapsePriority = 0,
  usedInterval = 1,
  minGrowth = false,
): number {
  const adjusted = retentionFactor(fi) * ensembleVal;
  let raw: number;
  if (postLapseMode) {
    raw = postLapse(adjusted, postLapsePriority, deterministic);
  } else {
    raw = deterministic ? adjusted : dispersal(adjusted);
  }
  raw = clamp(raw, CLAMP_LO, CLAMP_HI);
  let interval = clamp(roundTiesEven(raw), INT_LO, INT_HI);
  if (minGrowth) interval = minGrowthGuard(interval, usedInterval);
  return interval;
}

// =============================================================================
// RATING → GRADE
// =============================================================================

function ratingToGrade(rating: number): number {
  switch (rating) {
    case 1: return 0; // Again
    case 2: return 3; // Hard
    case 3: return 4; // Good
    case 4: return 5; // Easy
    default: return clamp(rating, 0, 5) | 0;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

const DEFAULT_STATE: PrecisionState = {
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
  m1_state: { ...DEFAULT_M1_STATE },
  m1_history: null,
  m2_state: { ...DEFAULT_M2_STATE },
  m3_state: { ...DEFAULT_M3_STATE },
  slot_stabilities: null,
  m5_memory: null,
  post_lapse_family: 0,
  lapse_ordinal: 0,
};

export function parsePrecisionState(algorithmState?: string): PrecisionState {
  if (algorithmState) {
    try {
      const parsed = JSON.parse(algorithmState) as Partial<PrecisionState>;
      if (parsed && typeof parsed.stability === "number" && typeof parsed.difficulty === "number") {
        const parsedState: PrecisionState = {
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
          m1_state: { ...DEFAULT_M1_STATE, ...(parsed.m1_state ?? {}) },
          m1_history: parsed.m1_history ?? null,
          m2_state: { ...DEFAULT_M2_STATE, ...(parsed.m2_state ?? {}) },
          m3_state: { ...DEFAULT_M3_STATE, ...(parsed.m3_state ?? {}) },
          slot_stabilities: parsed.slot_stabilities ?? null,
          m5_memory: parsed.m5_memory ?? null,
          post_lapse_family: parsed.post_lapse_family ?? 0,
          lapse_ordinal: parsed.lapse_ordinal ?? 0,
        };
        // Builds before collection parity stored browser days from Unix epoch;
        // native uses Chrono's num_days_from_ce. Migrate only realistic Unix
        // day values so synthetic parity fixtures such as day 0 stay intact.
        for (const model of [parsedState.m1_state, parsedState.m2_state, parsedState.m3_state]) {
          if (model && model.last_review_day >= 10_000 && model.last_review_day < 100_000) {
            model.last_review_day += 719_163;
          }
        }
        return parsedState;
      }
    } catch {
      // fall through to default
    }
  }
  return { ...DEFAULT_STATE, m1_state: { ...DEFAULT_M1_STATE }, m2_state: { ...DEFAULT_M2_STATE }, m3_state: { ...DEFAULT_M3_STATE } };
}

export function precisionRetrievability(stability: number, elapsedDays: number): number {
  if (!Number.isFinite(stability) || stability <= 0) return 0;
  return Math.pow(0.9, Math.max(0, elapsedDays) / stability);
}

export function recallRetrievabilityToBucket(value: number): number {
  return clamp(Math.round(Math.exp(value * Math.log(20))), 1, 20);
}

export function difficultyToIndex(d: number): number {
  if (d < 0) return 10;
  if (d > 1) return 10;
  return Math.round(d * 19) + 1;
}

export interface PrecisionExecutionOptions {
  collection?: PrecisionCollectionState;
  today?: number;
  forgettingIndex?: number;
  commit?: boolean;
  postLapsePriority?: number;
  random?: () => number;
}

/** Review a Precision item using the native-equivalent 5-model ensemble. */
export function precisionReview(
  currentState: PrecisionState,
  rating: number,
  elapsedDays: number,
  _intervalMatrix?: Float64Array,
  _countMatrix?: Uint32Array,
  pureM4?: boolean,
  nativeGrade?: number,
  deterministic = false,
  options: PrecisionExecutionOptions = {},
): PrecisionReviewResult {
  const state = parsePrecisionState(JSON.stringify(currentState));
  const grade = nativeGrade == null ? ratingToGrade(rating) : clamp(nativeGrade, 0, 5) | 0;
  const t = Math.max(0, elapsedDays);
  const s = state.stability;
  const d = state.difficulty;
  const fi = options.forgettingIndex ?? DEFAULT_FI;
  const today = options.today ?? currentDayFromCe();
  const collection = options.collection ?? freshPrecisionCollectionState();
  const commit = options.commit ?? false;

  const m4Parameters = collection.m4_params?.length === 35
    && collection.m4_params.every(Number.isFinite) ? collection.m4_params : P;
  const m4Result = reviewKernel(t, grade, d, s, m4Parameters);
  const m4 = m4Result.s_new;

  const personalizedM5 = personalizedModel5(collection.fsrs_params, state.m5_memory, t, grade);
  const m5 = personalizedM5?.stability ?? model5(t, grade, s);

  // M1: legacy scheduler (6%)
  const m1Result = model1(
    state.m1_state ?? DEFAULT_M1_STATE,
    today,
    grade,
    state.m1_history ?? null,
  );
  const m1 = m1Result.interval;

  const m2Result = reviewM2(
    state.m2_state ?? DEFAULT_M2_STATE,
    collection.m2_optimizer,
    today,
    grade,
    fi,
    commit,
    options.random,
  );
  const m2 = m2Result.stability;

  const m3Result = reviewM3(
    state.m3_state ?? DEFAULT_M3_STATE,
    collection.m3_matrices,
    today,
    grade,
    commit,
  );
  const m3 = m3Result.stability;

  const ensemble = pureM4 ? m4 : ensembleStability(collection.arena.weights, m1, m2, m3, m4, m5);

  const preRepetitions = state.m3_state?.repetitions ?? 0;
  const preLapses = state.m3_state?.lapses ?? 0;
  const postLapseFamily = grade < 3 ? 1 : Math.min(65535, preRepetitions + 1);
  const lapseOrdinal = grade < 3
    ? preRepetitions === 0 ? 0 : Math.min(65535, preLapses + 1)
    : Math.min(65535, preLapses);
  const postLapseMode = lapseOrdinal !== 0 && postLapseFamily === 1;
  const finalInterval = finalize(
    ensemble,
    fi,
    postLapseMode,
    deterministic,
    options.postLapsePriority,
    m1Result.usedInterval,
    postLapseFamily > 1,
  );
  const modelIntervals = [m1, m2, m3, m4, m5].map((stability) =>
    finalize(
      stability,
      fi,
      postLapseMode,
      true,
      options.postLapsePriority,
      m1Result.usedInterval,
      postLapseFamily > 1,
    ),
  ) as [number, number, number, number, number];

  // Schedule with the pre-review weights, then train weights for the next
  // review, matching the native review order.
  if (commit && state.slot_stabilities) {
    observeArena(collection.arena, state.slot_stabilities, elapsedDays, grade >= 3);
  }

  // Update M1 state
  const nextM1 = { ...m1Result.nextItem, previous_interval: finalInterval };
  const nextM1History = { ...m1Result.nextHistory, stability: finalInterval };
  const nextM2 = { ...m2Result.next_item, previous_interval: finalInterval };
  const nextM3 = { ...m3Result.next_item, previous_interval: finalInterval };

  const newState: PrecisionState = {
    version: state.version,
    stability: m4Result.s_new,
    difficulty: m4Result.d_new,
    repetition: grade >= 3 ? state.repetition + 1 : 0,
    lapses: grade < 3 ? state.lapses + 1 : state.lapses,
    interval: finalInterval,
    last_quality: state.last_quality,
    algorithm_branch: state.algorithm_branch,
    retrov: m4Result.a,
    s_factor: state.s_factor,
    multiplier: state.multiplier,
    m1_state: nextM1,
    m1_history: nextM1History,
    m2_state: nextM2,
    m3_state: nextM3,
    slot_stabilities: [m1, m2, m3, m4, m5],
    m5_memory: personalizedM5?.memory ?? state.m5_memory ?? null,
    post_lapse_family: postLapseFamily,
    lapse_ordinal: lapseOrdinal,
  };

  return {
    state: newState,
    interval_days: finalInterval,
    retrievability: m4Result.a,
    model_intervals: modelIntervals,
  };
}

export function precisionPreviewGradeResults(
  currentState: PrecisionState,
  elapsedDays: number,
  pureM4?: boolean,
  collection?: PrecisionCollectionState,
  today?: number,
): PrecisionReviewResult[] {
  return Array.from({ length: 6 }, (_, grade) =>
    precisionReview(
      currentState,
      grade,
      elapsedDays,
      undefined,
      undefined,
      pureM4,
      grade,
      true,
      { collection, today, commit: false },
    ),
  );
}

export function precisionPreviewIntervals(
  currentState: PrecisionState,
  elapsedDays: number,
  pureM4?: boolean,
  collection?: PrecisionCollectionState,
  today?: number,
): PrecisionPreviewIntervals {
  const grades = precisionPreviewGradeResults(currentState, elapsedDays, pureM4, collection, today);
  return {
    again: grades[0].interval_days,
    hard: grades[3].interval_days,
    good: grades[4].interval_days,
    easy: grades[5].interval_days,
  };
}

/** Kept for backward API compatibility — no longer used by the ensemble. */
export function precisionRecordReview(
  _stability: number,
  _difficulty: number,
  _repetition: number,
  _intervalUsed: number,
  _intervalMatrix: Float64Array,
  _countMatrix: Uint32Array,
): void {
  // No-op: the ensemble's M3 model handles matrix updates internally.
}
