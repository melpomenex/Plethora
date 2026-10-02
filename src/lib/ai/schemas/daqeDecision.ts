/**
 * `DaqeDecision` — structured envelope of the adaptive ranking decision task
 * (`adaptive-queue-ranking` / `queue-decision-model`).
 *
 * One envelope covers all three primitives because they are three questions
 * asked about the same item in one pass. Asking a model three times for three
 * numbers about the same passage triples the latency cost of the ranking path
 * and gives three independent chances to disagree about the same item.
 *
 * Validation fails closed and never produces a partially valid object: a
 * half-classified item is worse than an unclassified one, because the ranker
 * cannot tell the difference between "the model said 0.0" and "the model said
 * nothing useful".
 */

import {
  checkNumber,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

/**
 * Cognitive-load tiers, mirroring `DecisionModelTier` in
 * `src-tauri/src/models/daqe.rs`. The tier's complexity point on the shared 1–5
 * scale is 1 / 3 / 5 respectively.
 */
export const DECISION_TIERS = [
  "surface-skim",
  "medium-analysis",
  "deep-foundational",
] as const;
export type DecisionTier = (typeof DECISION_TIERS)[number];

/** The 1–5 complexity point each tier carries. */
export const TIER_COMPLEXITY: Readonly<Record<DecisionTier, number>> = {
  "surface-skim": 1,
  "medium-analysis": 3,
  "deep-foundational": 5,
};

export interface DaqeDecision {
  /** 0–1: how well this item serves the user's stated goal right now. */
  goalAlignment: number;
  /** 0–1: how cleanly this item decomposes into atomic study material. */
  atomicExtractability: number;
  /** The cognitive-load tier. */
  tier: DecisionTier;
  /** True when the item's prerequisites appear satisfied. */
  prerequisitesMet: boolean;
  /** True when the item looks stale enough to be worth pruning. */
  staleForPruning: boolean;
  reason: string;
}

export const DAQE_DECISION_SCHEMA = {
  name: "DaqeDecision",
  nativeName: "daqeDecision",
  json: JSON.stringify({
    goalAlignment: "0.0-1.0",
    atomicExtractability: "0.0-1.0",
    tier: DECISION_TIERS.join("|"),
    prerequisitesMet: "boolean",
    staleForPruning: "boolean",
    reason: "string",
  }),
} as const;

function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of [${allowed.join("|")}]`);
    return undefined;
  }
  return value as T;
}

function checkBoolean(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
    return undefined;
  }
  return value;
}

export function validateDaqeDecision(output: unknown): ValidationOutcome<DaqeDecision> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const goalAlignment = checkNumber(output.goalAlignment, "goalAlignment", errors, {
    min: 0,
    max: 1,
  });
  const atomicExtractability = checkNumber(
    output.atomicExtractability,
    "atomicExtractability",
    errors,
    { min: 0, max: 1 }
  );
  const tier = checkEnum(output.tier, DECISION_TIERS, "tier", errors);
  const prerequisitesMet = checkBoolean(output.prerequisitesMet, "prerequisitesMet", errors);
  const staleForPruning = checkBoolean(output.staleForPruning, "staleForPruning", errors);
  const reason = checkString(output.reason, "reason", errors, { maxLength: 1000 });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return valid({
    goalAlignment: goalAlignment as number,
    atomicExtractability: atomicExtractability as number,
    tier: tier as DecisionTier,
    prerequisitesMet: prerequisitesMet as boolean,
    staleForPruning: staleForPruning as boolean,
    reason: reason as string,
  });
}

/**
 * The composite `Score` judgement from a validated decision.
 *
 * The rubric is the mean of the two continuous judgements. It is deliberately
 * trivial: the two signals are already independent axes (goal fit vs
 * decomposability), so a weighted blend would encode a preference the product
 * has not expressed. They can be weighted later without a rubric-version bump
 * being wrong in the meantime, because the version is stamped into the cache key.
 */
export function compositeScore(decision: DaqeDecision): number {
  return (decision.goalAlignment + decision.atomicExtractability) / 2;
}