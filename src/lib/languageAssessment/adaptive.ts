import {
  ASSESSMENT_DIMENSIONS,
  NON_CEFR_DISCLAIMER,
  PROFICIENCY_BANDS,
  type AssessmentDimension,
  type AssessmentItem,
  type DimensionAdaptiveState,
  type DimensionEstimate,
  type IrtParameters,
  type ProficiencyBand,
} from "./types";

export const THETA_MIN = -3.0;
export const THETA_MAX = 3.0;
export const THETA_GRID_STEP = 0.1;
export const DEFAULT_PRIOR_MEAN = 0.0;
export const DEFAULT_PRIOR_SD = 1.25;
export const DEFAULT_TARGET_SEM = 0.45;
export const DEFAULT_MIN_ITEMS_PER_DIMENSION = 2;

export const THETA_GRID: readonly number[] = Array.from(
  { length: Math.round((THETA_MAX - THETA_MIN) / THETA_GRID_STEP) + 1 },
  (_, index) => Number((THETA_MIN + index * THETA_GRID_STEP).toFixed(2)),
);

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function thetaToScore(theta: number): number {
  const clamped = clamp(theta, THETA_MIN, THETA_MAX);
  return Number((((clamped - THETA_MIN) / (THETA_MAX - THETA_MIN)) * 100).toFixed(1));
}

export function scoreToTheta(score: number): number {
  const clamped = clamp(score, 0, 100);
  return Number((THETA_MIN + (clamped / 100) * (THETA_MAX - THETA_MIN)).toFixed(3));
}

export function thetaToBand(theta: number): ProficiencyBand {
  const clamped = clamp(theta, THETA_MIN, THETA_MAX);
  if (clamped < -2.0) return "A1";
  if (clamped < -1.0) return "A2";
  if (clamped < 0.0) return "B1";
  if (clamped < 1.0) return "B2";
  if (clamped < 2.0) return "C1";
  return "C2";
}

export function bandToTheta(band: ProficiencyBand): number {
  const centers: Record<ProficiencyBand, number> = {
    A1: -2.4,
    A2: -1.5,
    B1: -0.5,
    B2: 0.5,
    C1: 1.5,
    C2: 2.4,
  };
  return centers[band];
}

export function bandIndex(band: ProficiencyBand): number {
  return PROFICIENCY_BANDS.indexOf(band);
}

/**
 * Computes the 1PL/2PL/3PL IRT probability of a positive response at ability theta.
 */
export function irtProbability(theta: number, params: IrtParameters): number {
  const a = Math.max(0.1, params.discrimination);
  const b = clamp(params.difficulty, THETA_MIN - 0.5, THETA_MAX + 0.5);
  const c = clamp(params.guessing ?? 0, 0, 0.35);
  const exponent = clamp(-a * (theta - b), -30, 30);
  const logistic = 1 / (1 + Math.exp(exponent));
  return c + (1 - c) * logistic;
}

/**
 * Computes Fisher information for an item at latent ability theta.
 */
export function fisherInformation(theta: number, params: IrtParameters): number {
  const a = Math.max(0.1, params.discrimination);
  const c = clamp(params.guessing ?? 0, 0, 0.35);
  const p = clamp(irtProbability(theta, params), 1e-6, 1 - 1e-6);
  if (c <= 0) {
    return a * a * p * (1 - p);
  }
  const numerator = a * a * Math.pow(p - c, 2) * (1 - p);
  const denominator = Math.pow(1 - c, 2) * p;
  return denominator > 0 ? numerator / denominator : 0;
}

export function createGaussianPrior(
  mean: number = DEFAULT_PRIOR_MEAN,
  sd: number = DEFAULT_PRIOR_SD,
): readonly number[] {
  const safeSd = Math.max(0.25, sd);
  const unnormalized = THETA_GRID.map((theta) => {
    const z = (theta - mean) / safeSd;
    return Math.exp(-0.5 * z * z);
  });
  return normalizeDistribution(unnormalized);
}

export function normalizeDistribution(weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, value) => acc + (Number.isFinite(value) && value > 0 ? value : 0), 0);
  if (sum <= 0) {
    const uniform = 1 / THETA_GRID.length;
    return THETA_GRID.map(() => uniform);
  }
  return weights.map((value) => (Number.isFinite(value) && value > 0 ? value / sum : 0));
}

export function summarizePosterior(posterior: readonly number[]): { theta: number; sem: number } {
  const normalized = normalizeDistribution(posterior);
  let mean = 0;
  for (let i = 0; i < THETA_GRID.length; i += 1) {
    mean += THETA_GRID[i] * normalized[i];
  }
  let variance = 0;
  for (let i = 0; i < THETA_GRID.length; i += 1) {
    const diff = THETA_GRID[i] - mean;
    variance += diff * diff * normalized[i];
  }
  return {
    theta: Number(clamp(mean, THETA_MIN, THETA_MAX).toFixed(4)),
    sem: Number(Math.max(0.05, Math.sqrt(variance)).toFixed(4)),
  };
}

export function createDimensionAdaptiveState(
  dimension: AssessmentDimension,
  enabled: boolean,
  priorMean: number = DEFAULT_PRIOR_MEAN,
  priorSd: number = DEFAULT_PRIOR_SD,
): DimensionAdaptiveState {
  const posterior = createGaussianPrior(priorMean, priorSd);
  const summary = summarizePosterior(posterior);
  return {
    dimension,
    enabled,
    theta: summary.theta,
    sem: summary.sem,
    posterior,
    answeredItemIds: [],
    skippedItemIds: [],
    sampleCount: 0,
  };
}

/**
 * Updates a dimension's EAP posterior given an observed item and score in [0, 1].
 */
export function updateAbilityEstimate(
  state: DimensionAdaptiveState,
  item: AssessmentItem,
  score: number,
): DimensionAdaptiveState {
  const clampedScore = clamp(score, 0, 1);
  const updatedWeights = THETA_GRID.map((theta, index) => {
    const prior = state.posterior[index] ?? 1 / THETA_GRID.length;
    const p = clamp(irtProbability(theta, item.irt), 1e-6, 1 - 1e-6);
    // Generalized Bernoulli likelihood works identically for binary {0, 1} and fractional rubric scores.
    const logLikelihood = clampedScore * Math.log(p) + (1 - clampedScore) * Math.log(1 - p);
    return prior * Math.exp(logLikelihood);
  });

  const posterior = normalizeDistribution(updatedWeights);
  const { theta, sem } = summarizePosterior(posterior);

  return {
    ...state,
    theta,
    sem,
    posterior,
    answeredItemIds: [...state.answeredItemIds, item.id],
    sampleCount: state.sampleCount + 1,
  };
}

export function semToConfidenceScore(sem: number, sampleCount: number, priorSd: number = DEFAULT_PRIOR_SD): number {
  if (sampleCount <= 0) return 0;
  const safePrior = Math.max(0.25, priorSd);
  const precisionGain = 1 - clamp(sem / safePrior, 0, 1);
  // Blend variance reduction with sample-count support so 1 item cannot falsely claim high confidence.
  const sampleFactor = sampleCount / (sampleCount + 2.5);
  return Number(clamp(0.15 + 0.82 * (0.65 * precisionGain + 0.35 * sampleFactor), 0.05, 0.98).toFixed(3));
}

export function buildDimensionEstimate(
  dimension: AssessmentDimension,
  state: Pick<DimensionAdaptiveState, "theta" | "sem" | "sampleCount" | "enabled">,
  options: {
    minItemsForCalibration?: number;
    priorSd?: number;
    noteSuffix?: string;
  } = {},
): DimensionEstimate {
  const minItems = options.minItemsForCalibration ?? DEFAULT_MIN_ITEMS_PER_DIMENSION;
  const priorSd = options.priorSd ?? DEFAULT_PRIOR_SD;

  if (!state.enabled || state.sampleCount <= 0) {
    return {
      dimension,
      status: "unavailable",
      available: false,
      estimatedLevel: null,
      numericScore: null,
      confidenceScore: 0,
      confidenceInterval: {
        low: 0,
        high: 100,
        minBand: null,
        maxBand: null,
      },
      sampleCount: 0,
      calibrationNote:
        options.noteSuffix ??
        "No observable evidence recorded for this dimension yet; omitted as unavailable.",
      theta: null,
      sem: null,
    };
  }

  const theta = clamp(state.theta, THETA_MIN, THETA_MAX);
  const sem = Math.max(0.05, state.sem);
  const halfWidth = 1.96 * sem;
  const lowTheta = clamp(theta - halfWidth, THETA_MIN, THETA_MAX);
  const highTheta = clamp(theta + halfWidth, THETA_MIN, THETA_MAX);
  const estimatedLevel = thetaToBand(theta);
  const minBand = thetaToBand(lowTheta);
  const maxBand = thetaToBand(highTheta);
  const status = state.sampleCount >= minItems ? "calibrated" : "insufficient-evidence";
  const confidenceScore = semToConfidenceScore(sem, state.sampleCount, priorSd);

  const prefix =
    status === "insufficient-evidence"
      ? `Provisional estimate from ${state.sampleCount} sample(s) (below ${minItems}-sample calibration floor); wide uncertainty range.`
      : `Calibrated from ${state.sampleCount} sample(s) (SEM ${sem.toFixed(2)}).`;

  const calibrationNote = options.noteSuffix
    ? `${prefix} ${options.noteSuffix} Heuristic only; not a CEFR certification.`
    : `${prefix} Heuristic only; not a CEFR certification.`;

  return {
    dimension,
    status,
    available: true,
    estimatedLevel,
    numericScore: thetaToScore(theta),
    confidenceScore,
    confidenceInterval: {
      low: thetaToScore(lowTheta),
      high: thetaToScore(highTheta),
      minBand,
      maxBand,
    },
    sampleCount: state.sampleCount,
    calibrationNote,
    theta: Number(theta.toFixed(3)),
    sem: Number(sem.toFixed(3)),
  };
}

export interface AdaptiveSelectionCriteria {
  targetSem: number;
  minItemsPerDimension: number;
  activeDimensions?: readonly AssessmentDimension[];
}

/**
 * Selects the next highest-information unadministered item across active dimensions
 * that have not yet met the target SEM and minimum item threshold.
 */
export function selectNextAdaptiveItem(
  itemPool: readonly AssessmentItem[],
  dimensionStates: Record<AssessmentDimension, DimensionAdaptiveState>,
  criteria: AdaptiveSelectionCriteria,
): AssessmentItem | null {
  const activeDims = (criteria.activeDimensions ?? ASSESSMENT_DIMENSIONS).filter(
    (dim) => dimensionStates[dim]?.enabled,
  );
  if (activeDims.length === 0) return null;

  const remainingByDim = new Map<AssessmentDimension, AssessmentItem[]>();
  for (const dim of activeDims) {
    const state = dimensionStates[dim];
    const usedIds = new Set([...state.answeredItemIds, ...state.skippedItemIds]);
    const availableItems = itemPool.filter(
      (item) => item.dimension === dim && !usedIds.has(item.id),
    );
    if (availableItems.length > 0) {
      remainingByDim.set(dim, availableItems);
    }
  }

  const candidateDims = activeDims.filter((dim) => (remainingByDim.get(dim)?.length ?? 0) > 0);
  if (candidateDims.length === 0) return null;

  // Prefer dimensions that haven't met minItemsPerDimension or targetSem yet.
  const needyDims = candidateDims.filter((dim) => {
    const st = dimensionStates[dim];
    return st.sampleCount < criteria.minItemsPerDimension || st.sem > criteria.targetSem;
  });
  const selectionPoolDims = needyDims.length > 0 ? needyDims : candidateDims;

  // Pick dimension with lowest sample count first (for balanced coverage), breaking ties by highest SEM.
  selectionPoolDims.sort((a, b) => {
    const sa = dimensionStates[a];
    const sb = dimensionStates[b];
    if (sa.sampleCount !== sb.sampleCount) {
      return sa.sampleCount - sb.sampleCount;
    }
    if (Math.abs(sb.sem - sa.sem) > 1e-6) {
      return sb.sem - sa.sem;
    }
    return ASSESSMENT_DIMENSIONS.indexOf(a) - ASSESSMENT_DIMENSIONS.indexOf(b);
  });

  const chosenDimension = selectionPoolDims[0];
  const candidates = remainingByDim.get(chosenDimension) ?? [];
  const currentTheta = dimensionStates[chosenDimension].theta;

  let bestItem: AssessmentItem | null = null;
  let bestScore = -Infinity;

  for (const item of candidates) {
    const info = fisherInformation(currentTheta, item.irt);
    const distancePenalty = Math.abs(item.irt.difficulty - currentTheta) * 0.01;
    const score = info - distancePenalty;
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestItem;
}

export function allActiveDimensionsConverged(
  dimensionStates: Record<AssessmentDimension, DimensionAdaptiveState>,
  activeDimensions: readonly AssessmentDimension[],
  targetSem: number,
  minItemsPerDimension: number,
): boolean {
  const enabledDims = activeDimensions.filter((dim) => dimensionStates[dim]?.enabled);
  if (enabledDims.length === 0) return true;
  return enabledDims.every((dim) => {
    const st = dimensionStates[dim];
    return st.sampleCount >= minItemsPerDimension && st.sem <= targetSem;
  });
}

export { NON_CEFR_DISCLAIMER };
