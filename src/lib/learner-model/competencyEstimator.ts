/**
 * Pure, deterministic 5-dimension Competency Estimator (Phase 1B).
 *
 * Implements the exact algorithm specified in
 * `openspec/changes/establish-persistent-learner-model/design.md` §3:
 * 1. Filtering: excludes invalidated, unverified, null-score, and (optionally) AI-excluded records;
 *    strictly restricts `reading_progress` and `extract_created` to `exposure` only.
 * 2. Per-observation adjustments: hint discounting, short-term cramming discount for `retention`,
 *    dimension-specific recency decay with 0.15 floor.
 * 3. Correlated-card / same-group harmonic damping `w / (k+1)^0.85` capped at `1.5 * max_k(w)`.
 * 4. Posterior estimate, confidence, explicit `unknown` / `insufficient_evidence`, and
 *    deterministic `uncertaintyReasons`.
 */

import {
  ALL_COMPETENCY_DIMENSIONS,
  COMPETENCY_POLICY_VERSION,
  type CompetencyDimension,
  type CompetencyEvidenceRecord,
  type CompetencyStatus,
  type ConceptCompetencyProfile,
  type DimensionProjection,
  type EstimateCompetencyOptions,
  type LearnerCompetencyDeclaration,
} from "../../types/learnerModel";

const MS_PER_DAY = 86_400_000;

export const DIMENSION_HALF_LIFE_DAYS: Record<CompetencyDimension, number> = {
  exposure: 90,
  comprehension: 120,
  retention: 45,
  application: 120,
  transfer: 180,
};

export const RECENCY_DECAY_FLOOR = 0.15;
export const CORRELATION_DAMPING_EXPONENT = 0.85;
export const GROUP_WEIGHT_CAP_MULTIPLIER = 1.5;

const EXPOSURE_ONLY_SOURCE_KINDS = new Set<string>([
  "reading_progress",
  "extract_created",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseTimestampMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function utcDayKey(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso.slice(0, 10);
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Hint discounting factor: max(0.25, 1.0 - 0.25 * hintLevel).
 */
export function computeHintDiscount(hintLevel: number): number {
  const normalizedHints = Math.max(0, Number.isFinite(hintLevel) ? hintLevel : 0);
  return Math.max(0.25, 1.0 - 0.25 * normalizedHints);
}

/**
 * Short-term cramming discount for retention FSRS reviews when elapsedDays < 1.0:
 * d_delay = 0.20 + 0.80 * max(0, elapsedDays).
 */
export function computeRetentionDelayDiscount(
  dimension: CompetencyDimension,
  sourceKind: CompetencyEvidenceRecord["sourceKind"],
  elapsedDays: number | null,
): number {
  if (
    dimension === "retention" &&
    sourceKind === "fsrs_review" &&
    elapsedDays !== null &&
    Number.isFinite(elapsedDays) &&
    elapsedDays < 1.0
  ) {
    return 0.2 + 0.8 * Math.max(0, elapsedDays);
  }
  return 1.0;
}

/**
 * Dimension-specific recency decay with floor 0.15:
 * r = max(0.15, 2^(-ageDays / halfLifeDays)).
 */
export function computeRecencyDecay(
  dimension: CompetencyDimension,
  ageDays: number,
): number {
  const halfLife = DIMENSION_HALF_LIFE_DAYS[dimension];
  const nonNegativeAge = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0);
  return Math.max(RECENCY_DECAY_FLOOR, Math.pow(2, -nonNegativeAge / halfLife));
}

interface WeightedObservation {
  record: CompetencyEvidenceRecord;
  score: number;
  rawWeight: number;
  effectiveWeight: number;
  ageDays: number;
  occurredMs: number;
}

/**
 * Deterministic 5D competency estimator for a single dimension.
 */
export function estimateDimensionCompetency(
  records: readonly CompetencyEvidenceRecord[],
  nowIso: string,
  options?: EstimateCompetencyOptions,
): DimensionProjection {
  const dimension: CompetencyDimension =
    options?.dimension ?? records[0]?.dimension ?? "comprehension";
  const policyVersion = options?.policyVersion ?? COMPETENCY_POLICY_VERSION;
  const excludeAiExcluded = Boolean(options?.excludeAiExcluded);
  const nowMs = parseTimestampMs(nowIso);
  const halfLifeDays = DIMENSION_HALF_LIFE_DAYS[dimension];

  // Step 1: Filtering
  const activeRecords = records.filter((record) => {
    if (record.dimension !== dimension) return false;
    if (record.isInvalidated) return false;
    if (!record.isVerified) return false;
    if (excludeAiExcluded && record.isAiExcluded) return false;
    if (record.observedScore === null || !Number.isFinite(record.observedScore)) {
      return false;
    }
    if (!Number.isFinite(record.baseWeight) || record.baseWeight <= 0) {
      return false;
    }
    // Epistemic rule: reading_progress / extract_created ONLY contribute to exposure
    if (dimension !== "exposure" && EXPOSURE_ONLY_SOURCE_KINDS.has(record.sourceKind)) {
      return false;
    }
    return true;
  });

  if (activeRecords.length === 0) {
    return {
      dimension,
      status: "unknown",
      estimate: null,
      confidence: 0,
      effectiveWeight: 0,
      rawEvidenceCount: 0,
      independentGroups: 0,
      distinctDays: 0,
      uncertaintyReasons: ["no_evidence"],
      evidenceIds: [],
      lastEvidenceAt: null,
      policyVersion,
    };
  }

  // Step 2: Per-observation adjustments
  const observationsByGroup = new Map<string, WeightedObservation[]>();
  const distinctDaySet = new Set<string>();

  for (const record of activeRecords) {
    const occurredMs = parseTimestampMs(record.occurredAt);
    const ageDays = Math.max(0, (nowMs - occurredMs) / MS_PER_DAY);
    const baseWeight = clamp(record.baseWeight, 0, 2.0);
    const score = clamp(record.observedScore!, 0, 1.0);
    const hintDiscount = computeHintDiscount(record.hintLevel);
    const delayDiscount = computeRetentionDelayDiscount(
      dimension,
      record.sourceKind,
      record.elapsedDays,
    );
    const recencyDecay = computeRecencyDecay(dimension, ageDays);
    const rawWeight = baseWeight * hintDiscount * delayDiscount * recencyDecay;

    const groupKey = record.cardFamilyId ?? record.evidenceGroupId;
    const list = observationsByGroup.get(groupKey) ?? [];
    list.push({
      record,
      score,
      rawWeight,
      effectiveWeight: 0,
      ageDays,
      occurredMs,
    });
    observationsByGroup.set(groupKey, list);
    distinctDaySet.add(utcDayKey(record.occurredAt));
  }

  // Step 3: Correlated-card / same-group harmonic damping with 1.5 * max_k(w_raw) cap
  const dampedObservations: WeightedObservation[] = [];

  for (const groupObs of observationsByGroup.values()) {
    groupObs.sort((a, b) => {
      if (b.occurredMs !== a.occurredMs) return b.occurredMs - a.occurredMs;
      return a.record.id.localeCompare(b.record.id);
    });

    let maxRawWeight = 0;
    let groupDampedSum = 0;

    for (let k = 0; k < groupObs.length; k += 1) {
      const obs = groupObs[k];
      if (obs.rawWeight > maxRawWeight) {
        maxRawWeight = obs.rawWeight;
      }
      const damped = obs.rawWeight / Math.pow(k + 1, CORRELATION_DAMPING_EXPONENT);
      obs.effectiveWeight = damped;
      groupDampedSum += damped;
    }

    const groupCap = GROUP_WEIGHT_CAP_MULTIPLIER * maxRawWeight;
    if (groupDampedSum > groupCap && groupDampedSum > 0) {
      const scale = groupCap / groupDampedSum;
      for (const obs of groupObs) {
        obs.effectiveWeight *= scale;
      }
    }

    dampedObservations.push(...groupObs);
  }

  // Deterministic global ordering (most recent first)
  dampedObservations.sort((a, b) => {
    if (b.occurredMs !== a.occurredMs) return b.occurredMs - a.occurredMs;
    return a.record.id.localeCompare(b.record.id);
  });

  // Step 4: Posterior estimate, confidence, uncertainty reasons, and status classification
  let totalEffectiveWeight = 0;
  let weightedScoreSum = 0;
  let allStale = true;

  for (const obs of dampedObservations) {
    totalEffectiveWeight += obs.effectiveWeight;
    weightedScoreSum += obs.effectiveWeight * obs.score;
    if (obs.ageDays <= halfLifeDays) {
      allStale = false;
    }
  }

  const estimate =
    totalEffectiveWeight > 0 ? clamp(weightedScoreSum / totalEffectiveWeight, 0, 1) : null;
  const independentGroups = observationsByGroup.size;
  const distinctDays = distinctDaySet.size;
  const rawEvidenceCount = dampedObservations.length;

  const baseConfidence = 1 - Math.exp(-totalEffectiveWeight / 2.0);
  const confidence =
    dimension === "exposure"
      ? clamp(baseConfidence, 0, 1)
      : clamp(
          baseConfidence *
            Math.min(1.0, independentGroups / 2.0) *
            Math.min(1.0, distinctDays / 2.0),
          0,
          1,
        );

  const uncertaintyReasons: string[] = [];
  if (dimension === "exposure") {
    if (totalEffectiveWeight < 0.5) {
      uncertaintyReasons.push("low_effective_weight");
    }
  } else {
    if (totalEffectiveWeight < 1.0) {
      uncertaintyReasons.push("low_effective_weight");
    }
    if (independentGroups < 2) {
      uncertaintyReasons.push("single_evidence_group");
    }
    if (
      (dimension === "retention" || dimension === "comprehension") &&
      distinctDays < 2
    ) {
      uncertaintyReasons.push("single_day_only");
    }
  }
  if (allStale) {
    uncertaintyReasons.push("stale_evidence");
  }

  let status: CompetencyStatus;
  if (estimate === null) {
    status = "unknown";
  } else if (dimension === "exposure" && totalEffectiveWeight < 0.5) {
    status = "insufficient_evidence";
  } else if (
    dimension !== "exposure" &&
    (totalEffectiveWeight < 0.75 ||
      (independentGroups === 1 && rawEvidenceCount >= 2 && totalEffectiveWeight < 1.2))
  ) {
    status = "insufficient_evidence";
  } else if (estimate < 0.5) {
    status = "needs_attention";
  } else if (estimate < 0.8 || confidence < 0.6) {
    status = "developing";
  } else {
    status = "demonstrated";
  }

  return {
    dimension,
    status,
    estimate,
    confidence,
    effectiveWeight: totalEffectiveWeight,
    rawEvidenceCount,
    independentGroups,
    distinctDays,
    uncertaintyReasons,
    evidenceIds: dampedObservations.map((o) => o.record.id),
    lastEvidenceAt: dampedObservations[0]?.record.occurredAt ?? null,
    policyVersion,
  };
}

/**
 * Projects a complete 5-dimension competency profile for a concept.
 * Learner self-declarations are preserved separately and NEVER merged into
 * demonstrated dimension estimates.
 */
export function projectConceptProfile(
  conceptId: string,
  evidence: readonly CompetencyEvidenceRecord[],
  declaration: LearnerCompetencyDeclaration | null,
  nowIso: string,
  options?: {
    conceptName?: string;
    excludeAiExcluded?: boolean;
    policyVersion?: string;
  },
): ConceptCompetencyProfile {
  const conceptEvidence = evidence.filter((r) => r.conceptId === conceptId);
  const excludeAiExcluded = Boolean(options?.excludeAiExcluded);

  const dimensions = {} as Record<CompetencyDimension, DimensionProjection>;
  for (const dim of ALL_COMPETENCY_DIMENSIONS) {
    dimensions[dim] = estimateDimensionCompetency(conceptEvidence, nowIso, {
      dimension: dim,
      excludeAiExcluded,
      policyVersion: options?.policyVersion,
    });
  }

  const activeVisibleEvidence = conceptEvidence.filter(
    (r) =>
      !r.isInvalidated &&
      r.isVerified &&
      r.observedScore !== null &&
      (!excludeAiExcluded || !r.isAiExcluded),
  );

  return {
    conceptId,
    conceptName: options?.conceptName ?? conceptId,
    dimensions,
    selfDeclaration: declaration ? { ...declaration } : null,
    containsLocalOnlyEvidence: activeVisibleEvidence.some((r) => r.isLocalOnly),
    containsAiExcludedEvidence: activeVisibleEvidence.some((r) => r.isAiExcluded),
  };
}
