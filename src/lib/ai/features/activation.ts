/**
 * Capability-aware activation (F0 task 2.1).
 *
 * Enable All is a PREFERENCE action. It changes only the supported main
 * learning-feature flags, in one settings update, and returns per-feature
 * outcomes. It never touches provider choice, cloud fallback, paid
 * embeddings, freeform vision, the active-recall interaction mode or any
 * consent record, and it never starts a download or an index job.
 */

import {
  ENABLE_ALL_FLAG_KEYS,
  summarizeActivation,
  type ActivationSummary,
} from "./registry";
import type { FeatureId, FeatureReadiness, FeatureStatus } from "./types";

export interface EnableAllPlan {
  /** Flags to write (true only for supported features). */
  readonly updates: Readonly<Record<string, boolean>>;
  /** Per-feature outcome of this activation attempt. */
  readonly outcomes: ReadonlyArray<{
    readonly featureId: FeatureId;
    readonly enabled: boolean;
    readonly status: FeatureStatus;
    /** True when the preference was left as-is because it is unsupported. */
    readonly preserved: boolean;
  }>;
  readonly summary: ActivationSummary;
  /** Features whose preferences were deliberately not changed. */
  readonly preservedFeatureIds: readonly FeatureId[];
}

/**
 * Compute the Enable All plan from the current readiness rows.
 *
 * Unsupported (platform-unavailable) features keep their prior preference.
 * `checking` rows are treated as unsupported for this action: we cannot
 * honestly claim support before the probe completes, and the user can retry.
 */
export function planEnableAll(
  rows: readonly FeatureReadiness[],
  currentFlags: Readonly<Record<string, boolean | undefined>>
): EnableAllPlan {
  const outcomes: Array<{
    featureId: FeatureId;
    enabled: boolean;
    status: FeatureStatus;
    preserved: boolean;
  }> = [];
  const updates: Record<string, boolean> = {};
  const preservedFeatureIds: FeatureId[] = [];

  for (const row of rows) {
    const supported =
      row.status !== "unavailable-platform" && row.status !== "checking";
    if (supported) {
      updates[flagKeyFor(row.featureId)] = true;
      outcomes.push({
        featureId: row.featureId,
        enabled: true,
        status: row.status,
        preserved: false,
      });
    } else {
      preservedFeatureIds.push(row.featureId);
      outcomes.push({
        featureId: row.featureId,
        enabled: currentFlags[flagKeyFor(row.featureId)] === true,
        status: row.status,
        preserved: true,
      });
    }
  }

  // Simulate the resulting enabled set so the summary separates "enabled"
  // from "ready" instead of counting booleans as success.
  const nextRows = rows.map((row) => {
    if (!updates[flagKeyFor(row.featureId)]) return row;
    return {
      ...row,
      enabled: true,
      status: row.status === "disabled" ? "setup-required" : row.status,
    } satisfies FeatureReadiness;
  });

  return {
    updates,
    outcomes,
    summary: summarizeActivation(nextRows),
    preservedFeatureIds,
  };
}

const FEATURE_FLAG: Readonly<Record<FeatureId, string>> = {
  "learn-this": "aiLearnThis",
  "library-rag": "aiLibraryRag",
  "socratic-tutor": "aiSocraticTutor",
  "occlusion-assist": "aiOcclusionAssist",
  "semantic-index": "aiSemanticIndex",
  "answer-assessment": "aiAnswerAssessment",
  "knowledge-relationships": "aiPrerequisites",
  "extract-worthiness": "aiExtractWorthiness",
  "learning-agent": "aiAgent",
  "active-recall": "aiActiveRecall",
};

export function flagKeyFor(featureId: FeatureId): string {
  return FEATURE_FLAG[featureId];
}

/**
 * Build the single settings `features` patch. Only keys this action is
 * allowed to change appear in the patch: unsupported flags, provider choices,
 * consent, freeform vision and recall mode are never present, so a caller
 * cannot accidentally overwrite them.
 */
export function buildEnableAllFeaturesPatch(
  plan: EnableAllPlan,
  currentFlags: Readonly<Record<string, boolean | undefined>>
): Record<string, boolean> {
  void currentFlags;
  const patch: Record<string, boolean> = {};
  for (const key of ENABLE_ALL_FLAG_KEYS) {
    if (plan.updates[key] === true) patch[key] = true;
  }
  // Knowledge's link sub-flag is part of the same supported preference group,
  // but is not a FeatureId of its own.
  const knowledgeOutcome = plan.outcomes.find(
    (outcome) => outcome.featureId === "knowledge-relationships"
  );
  if (knowledgeOutcome && !knowledgeOutcome.preserved) {
    patch.aiConceptLinks = true;
  }
  return patch;
}

/** Human summary key: the UI never says "all set" from a boolean count. */
export function activationSummaryKey(summary: ActivationSummary): string {
  if (summary.ready === summary.total) return "ai.activation.allReady";
  if (summary.ready > 0) return "ai.activation.partial";
  return "ai.activation.needsSetup";
}
