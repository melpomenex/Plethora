/**
 * Unified Assessment Evidence Policy & Dimension-Targeted Remediation Engine (Phase 3B).
 *
 * Implements:
 * - 8-purpose Assessment Taxonomy with deterministic policies (`getAssessmentPurposePolicy`).
 * - Dimension-targeted remediation routing (`planDimensionTargetedRemediation`) with
 *   4-stage anti-loop escalation ladder, non-repetition guarantee, and dismissal/override respect.
 * - Transactional grade invalidation impact & clean competency recomputation
 *   (`computeInvalidationImpact`) reusing `estimateDimensionCompetency` without touching
 *   unrelated concepts or FSRS review history.
 */

import {
  estimateDimensionCompetency,
} from "../learner-model/competencyEstimator";
import type {
  CompetencyDimension,
  CompetencyEvidenceRecord,
  ConceptCompetencyProfile,
  DimensionProjection,
} from "../../types/learnerModel";

// ============================================================================
// 1. 8-Purpose Assessment Taxonomy
// ============================================================================

export const ALL_ASSESSMENT_PURPOSES = [
  "diagnostic",
  "formative",
  "retrieval_practice",
  "mastery",
  "mock_exam",
  "summative_exam",
  "practical_skill",
  "self_assessment",
] as const;

export type AssessmentPurpose = (typeof ALL_ASSESSMENT_PURPOSES)[number];

export type AssessmentFeedbackTiming =
  | "immediate"
  | "delayed_after_attempt"
  | "end_of_assessment"
  | "self_revealed";

export interface AssessmentPurposePolicy {
  purpose: AssessmentPurpose;
  feedbackTiming: AssessmentFeedbackTiming;
  hintsAllowed: boolean;
  coachingAllowed: boolean;
  examIsolated: boolean;
  contributesToMastery: boolean;
  evidenceBaseWeight: number;
  targetDimensions: readonly CompetencyDimension[];
  requiresSourceGroundingForMastery: boolean;
}

const ASSESSMENT_PURPOSE_POLICIES: Readonly<
  Record<AssessmentPurpose, AssessmentPurposePolicy>
> = {
  diagnostic: {
    purpose: "diagnostic",
    feedbackTiming: "end_of_assessment",
    hintsAllowed: false,
    coachingAllowed: false,
    examIsolated: false,
    contributesToMastery: true,
    evidenceBaseWeight: 0.75,
    targetDimensions: ["comprehension", "retention", "application"],
    requiresSourceGroundingForMastery: true,
  },
  formative: {
    purpose: "formative",
    feedbackTiming: "immediate",
    hintsAllowed: true,
    coachingAllowed: true,
    examIsolated: false,
    contributesToMastery: true,
    evidenceBaseWeight: 0.5,
    targetDimensions: ["comprehension", "application"],
    requiresSourceGroundingForMastery: true,
  },
  retrieval_practice: {
    purpose: "retrieval_practice",
    feedbackTiming: "delayed_after_attempt",
    hintsAllowed: false,
    coachingAllowed: false,
    examIsolated: false,
    contributesToMastery: true,
    evidenceBaseWeight: 0.85,
    targetDimensions: ["retention"],
    requiresSourceGroundingForMastery: true,
  },
  mastery: {
    purpose: "mastery",
    feedbackTiming: "end_of_assessment",
    hintsAllowed: false,
    coachingAllowed: false,
    examIsolated: true,
    contributesToMastery: true,
    evidenceBaseWeight: 1.3,
    targetDimensions: ["comprehension", "retention", "application"],
    requiresSourceGroundingForMastery: true,
  },
  mock_exam: {
    purpose: "mock_exam",
    feedbackTiming: "end_of_assessment",
    hintsAllowed: false,
    coachingAllowed: false,
    examIsolated: true,
    contributesToMastery: true,
    evidenceBaseWeight: 1.15,
    targetDimensions: ["comprehension", "retention", "application", "transfer"],
    requiresSourceGroundingForMastery: true,
  },
  summative_exam: {
    purpose: "summative_exam",
    feedbackTiming: "end_of_assessment",
    hintsAllowed: false,
    coachingAllowed: false,
    examIsolated: true,
    contributesToMastery: true,
    evidenceBaseWeight: 1.5,
    targetDimensions: ["comprehension", "retention", "application", "transfer"],
    requiresSourceGroundingForMastery: true,
  },
  practical_skill: {
    purpose: "practical_skill",
    feedbackTiming: "delayed_after_attempt",
    hintsAllowed: true,
    coachingAllowed: false,
    examIsolated: false,
    contributesToMastery: true,
    evidenceBaseWeight: 1.25,
    targetDimensions: ["application", "transfer"],
    requiresSourceGroundingForMastery: true,
  },
  self_assessment: {
    purpose: "self_assessment",
    feedbackTiming: "self_revealed",
    hintsAllowed: true,
    coachingAllowed: true,
    examIsolated: false,
    contributesToMastery: false,
    evidenceBaseWeight: 0.0,
    targetDimensions: ["exposure"],
    requiresSourceGroundingForMastery: false,
  },
};

/**
 * Returns the deterministic assessment policy for one of the 8 canonical purposes.
 *
 * Guarantees:
 * - `mock_exam` and `summative_exam` enforce `examIsolated: true`, `hintsAllowed: false`, `coachingAllowed: false`.
 * - `self_assessment` enforces `contributesToMastery: false`.
 */
export function getAssessmentPurposePolicy(
  purpose: AssessmentPurpose,
): AssessmentPurposePolicy {
  const policy = ASSESSMENT_PURPOSE_POLICIES[purpose];
  return {
    ...policy,
    targetDimensions: [...policy.targetDimensions],
  };
}

/**
 * Checks whether an assessment with the given purpose and knowledge policy can
 * contribute demonstrated mastery evidence.
 * `model-only` blueprints and `self_assessment` are strictly excluded.
 */
export function canAssessmentContributeToMastery(
  purpose: AssessmentPurpose,
  knowledgePolicy: "source-grounded" | "model-only" | "hybrid" = "source-grounded",
): boolean {
  if (knowledgePolicy === "model-only") return false;
  return ASSESSMENT_PURPOSE_POLICIES[purpose].contributesToMastery;
}

// ============================================================================
// 2. Dimension-Targeted Remediation & 4-Stage Anti-Loop Escalation Ladder
// ============================================================================

export type RemediationErrorNature =
  | "recall_lapse"
  | "misconception"
  | "procedural_step_failure"
  | "novel_context_failure"
  | "unseen_concept";

export type RemediationActivityType =
  | "spaced_retrieval"
  | "cued_interleaved_recall"
  | "source_grounded_explanation"
  | "socratic_dialogue"
  | "alternative_explanation"
  | "worked_example"
  | "structured_problem_solving"
  | "cross_context_comparison"
  | "novel_synthesis_exercise"
  | "guided_reading_passage"
  | "grounded_overview";

export type EscalationStageName =
  | "targeted_practice"
  | "worked_example_or_socratic"
  | "prerequisite_check_and_alternative_source"
  | "user_override_or_defer";

export type EscalationStageNumber = 1 | 2 | 3 | 4;

export type RemediationUserChoice =
  | "pause_24h"
  | "defer_for_later"
  | "edit_source_or_question"
  | "dismiss_remediation";

export interface RemediationAttemptRecord {
  attemptNumber: number;
  activityType: RemediationActivityType;
  outcome: "failed" | "passed" | "abandoned";
  attemptedAt: string;
}

export interface RemediationPlanInput {
  conceptId: string;
  conceptName: string;
  failedDimension: CompetencyDimension;
  errorNature?: RemediationErrorNature;
  /** Optional description of the specific weak step (e.g. "two-child BST node deletion"). */
  weakStep?: string | null;
  /** Optional 5D competency profile to enrich rationale (e.g. high retention vs weak application). */
  competencyProfile?: ConceptCompetencyProfile | null;
  attemptHistory: readonly RemediationAttemptRecord[];
  /** Maximum remediation attempts before Stage 4 cooldown/override (default: 4). */
  maxAttempts?: number;
  isDismissed?: boolean;
  isOverridden?: boolean;
  dismissReason?: string | null;
  prerequisiteConceptIds?: readonly string[];
  weakPrerequisiteConceptIds?: readonly string[];
  alternativeSourceIds?: readonly string[];
  nowIso?: string;
}

export interface RecommendedRemediationActivity {
  activityType: RemediationActivityType;
  targetDimension: CompetencyDimension;
  focusStep: string | null;
  title: string;
  instructions: string;
  prerequisiteConceptIdsToCheck: string[];
  alternativeSourceIds: string[];
}

export interface RemediationPlanResult {
  conceptId: string;
  targetDimension: CompetencyDimension;
  status: "active" | "cooldown_or_override" | "dismissed" | "overridden";
  escalationStage: EscalationStageNumber;
  escalationStageName: EscalationStageName;
  attemptCount: number;
  maxAttempts: number;
  autoRequeue: boolean;
  cooldownUntil: string | null;
  recommendedActivity: RecommendedRemediationActivity | null;
  userChoices: RemediationUserChoice[];
  rationale: string;
}

export const DEFAULT_MAX_REMEDIATION_ATTEMPTS = 4;
const COOLDOWN_HOURS = 24;

/**
 * Ordered candidate activities per failing dimension, indexed by escalation stage.
 * Guarantees:
 * - `retention` -> spaced retrieval / cued interleaved recall (never generic rereading)
 * - `comprehension` -> source-grounded explanation / Socratic dialogue / alternative explanation (never definition flashcard)
 * - `application` -> structured problem solving / worked example (never definition flashcard)
 * - `transfer` -> cross-context comparison / novel synthesis exercise (never definition flashcard)
 * - `exposure` -> guided reading passage / grounded overview (never flashcard drill)
 */
const DIMENSION_ACTIVITY_LADDER: Readonly<
  Record<CompetencyDimension, readonly [RemediationActivityType, RemediationActivityType, RemediationActivityType]>
> = {
  retention: [
    "spaced_retrieval",
    "cued_interleaved_recall",
    "alternative_explanation",
  ],
  comprehension: [
    "source_grounded_explanation",
    "socratic_dialogue",
    "alternative_explanation",
  ],
  application: [
    "structured_problem_solving",
    "worked_example",
    "alternative_explanation",
  ],
  transfer: [
    "cross_context_comparison",
    "novel_synthesis_exercise",
    "alternative_explanation",
  ],
  exposure: [
    "guided_reading_passage",
    "grounded_overview",
    "alternative_explanation",
  ],
};

function describeActivity(
  activityType: RemediationActivityType,
  conceptName: string,
  weakStep: string | null,
): { title: string; instructions: string } {
  const stepSuffix = weakStep ? ` focusing on ${weakStep}` : "";
  switch (activityType) {
    case "spaced_retrieval":
      return {
        title: `Spaced retrieval: ${conceptName}`,
        instructions: `Practice active recall of ${conceptName}${stepSuffix} with spaced cue prompts (avoid passive rereading).`,
      };
    case "cued_interleaved_recall":
      return {
        title: `Interleaved cued recall: ${conceptName}`,
        instructions: `Recall ${conceptName}${stepSuffix} interleaved with contrasting concepts to strengthen retention cues.`,
      };
    case "source_grounded_explanation":
      return {
        title: `Source-grounded explanation: ${conceptName}`,
        instructions: `Revisit the grounded source explanation for ${conceptName}${stepSuffix} and resolve the underlying misconception.`,
      };
    case "socratic_dialogue":
      return {
        title: `Socratic walkthrough: ${conceptName}`,
        instructions: `Work through targeted Socratic questions on ${conceptName}${stepSuffix} to repair conceptual understanding.`,
      };
    case "alternative_explanation":
      return {
        title: `Alternative explanation & prerequisite check: ${conceptName}`,
        instructions: `Review an alternative explanation for ${conceptName}${stepSuffix} and inspect upstream prerequisites.`,
      };
    case "worked_example":
      return {
        title: `Worked example: ${conceptName}`,
        instructions: `Study a step-by-step worked example of ${conceptName}${stepSuffix}, then complete the faded step.`,
      };
    case "structured_problem_solving":
      return {
        title: `Structured problem-solving: ${conceptName}`,
        instructions: `Execute a rubric-backed practical exercise on ${conceptName}${stepSuffix} targeting the failing procedural step.`,
      };
    case "cross_context_comparison":
      return {
        title: `Cross-context comparison: ${conceptName}`,
        instructions: `Compare how ${conceptName}${stepSuffix} behaves across two contrasting contexts or constraints.`,
      };
    case "novel_synthesis_exercise":
      return {
        title: `Novel synthesis exercise: ${conceptName}`,
        instructions: `Apply ${conceptName}${stepSuffix} to an unfamiliar scenario requiring cross-concept transfer.`,
      };
    case "guided_reading_passage":
      return {
        title: `Guided reading passage: ${conceptName}`,
        instructions: `Read the primary source-grounded passage introducing ${conceptName}${stepSuffix} before practicing recall.`,
      };
    case "grounded_overview":
      return {
        title: `Grounded concept overview: ${conceptName}`,
        instructions: `Review a concise grounded overview of ${conceptName}${stepSuffix} from your local source.`,
      };
  }
}

function addHoursIso(baseIso: string, hours: number): string {
  const ms = Date.parse(baseIso);
  const safeBase = Number.isNaN(ms) ? Date.now() : ms;
  return new Date(safeBase + hours * 3_600_000).toISOString();
}

/**
 * Plans dimension-targeted remediation with a deterministic 4-stage anti-loop
 * escalation ladder.
 */
export function planDimensionTargetedRemediation(
  input: RemediationPlanInput,
): RemediationPlanResult {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_REMEDIATION_ATTEMPTS);
  const attemptCount = input.attemptHistory.length;
  const failedAttempts = input.attemptHistory.filter((a) => a.outcome === "failed");
  const nowIso = input.nowIso ?? new Date().toISOString();
  const weakStep = input.weakStep ?? null;

  // Always respect explicit dismissal or user override immediately
  if (input.isDismissed) {
    return {
      conceptId: input.conceptId,
      targetDimension: input.failedDimension,
      status: "dismissed",
      escalationStage: 4,
      escalationStageName: "user_override_or_defer",
      attemptCount,
      maxAttempts,
      autoRequeue: false,
      cooldownUntil: null,
      recommendedActivity: null,
      userChoices: [],
      rationale: `Remediation for "${input.conceptName}" was dismissed by the learner${input.dismissReason ? ` (${input.dismissReason})` : ""}.`,
    };
  }

  if (input.isOverridden) {
    return {
      conceptId: input.conceptId,
      targetDimension: input.failedDimension,
      status: "overridden",
      escalationStage: 4,
      escalationStageName: "user_override_or_defer",
      attemptCount,
      maxAttempts,
      autoRequeue: false,
      cooldownUntil: null,
      recommendedActivity: null,
      userChoices: [],
      rationale: `Remediation for "${input.conceptName}" was overridden by the learner.`,
    };
  }

  // Stage 4: cap reached -> stop auto-requeue, enforce cooldown, offer explicit choices
  if (failedAttempts.length >= maxAttempts - 1 || attemptCount >= maxAttempts) {
    return {
      conceptId: input.conceptId,
      targetDimension: input.failedDimension,
      status: "cooldown_or_override",
      escalationStage: 4,
      escalationStageName: "user_override_or_defer",
      attemptCount,
      maxAttempts,
      autoRequeue: false,
      cooldownUntil: addHoursIso(nowIso, COOLDOWN_HOURS),
      recommendedActivity: null,
      userChoices: [
        "pause_24h",
        "defer_for_later",
        "edit_source_or_question",
        "dismiss_remediation",
      ],
      rationale: `Reached anti-loop escalation cap (${attemptCount}/${maxAttempts} attempts) for "${input.conceptName}" (${input.failedDimension}). Auto-requeuing paused; choose how to proceed.`,
    };
  }

  // Determine escalation stage (1, 2, or 3) from failed attempts so far
  let escalationStage: EscalationStageNumber;
  let escalationStageName: EscalationStageName;
  if (failedAttempts.length === 0) {
    escalationStage = 1;
    escalationStageName = "targeted_practice";
  } else if (failedAttempts.length === 1) {
    escalationStage = 2;
    escalationStageName = "worked_example_or_socratic";
  } else {
    escalationStage = 3;
    escalationStageName = "prerequisite_check_and_alternative_source";
  }

  // Select candidate activity for this dimension and stage, ensuring we NEVER
  // repeat the exact same failed activity twice in a row.
  const ladder = DIMENSION_ACTIVITY_LADDER[input.failedDimension];
  let selectedActivity: RemediationActivityType = ladder[escalationStage - 1];

  const lastAttempt = input.attemptHistory[input.attemptHistory.length - 1];
  if (
    lastAttempt &&
    lastAttempt.outcome === "failed" &&
    lastAttempt.activityType === selectedActivity
  ) {
    const distinctCandidate = ladder.find(
      (candidate) => candidate !== lastAttempt.activityType,
    );
    if (distinctCandidate) {
      selectedActivity = distinctCandidate;
    }
  }

  const { title, instructions } = describeActivity(
    selectedActivity,
    input.conceptName,
    weakStep,
  );

  const prereqsToCheck =
    escalationStage === 3
      ? [
          ...(input.weakPrerequisiteConceptIds ?? []),
          ...(input.prerequisiteConceptIds ?? []).filter(
            (id) => !(input.weakPrerequisiteConceptIds ?? []).includes(id),
          ),
        ]
      : [];

  const altSources =
    escalationStage === 3 ? [...(input.alternativeSourceIds ?? [])] : [];

  // Build deterministic rationale referencing the failing dimension & contrasting strong dimensions
  const retentionStatus = input.competencyProfile?.dimensions.retention?.status;
  const contrastNote =
    input.failedDimension === "application" &&
    (retentionStatus === "demonstrated" || retentionStatus === "developing")
      ? " Recall/retention is already established, so definition flashcards are skipped in favor of procedural application."
      : "";
  const weakStepNote = weakStep ? ` Targeting weak step: ${weakStep}.` : "";
  const stage3Note =
    escalationStage === 3
      ? ` Escalated to prerequisite check (${prereqsToCheck.length} linked) and alternative source fallback.`
      : "";

  const rationale =
    `Targeted for ${input.failedDimension} (stage ${escalationStage}: ${escalationStageName}).` +
    contrastNote +
    weakStepNote +
    stage3Note;

  return {
    conceptId: input.conceptId,
    targetDimension: input.failedDimension,
    status: "active",
    escalationStage,
    escalationStageName,
    attemptCount,
    maxAttempts,
    autoRequeue: true,
    cooldownUntil: null,
    recommendedActivity: {
      activityType: selectedActivity,
      targetDimension: input.failedDimension,
      focusStep: weakStep,
      title,
      instructions,
      prerequisiteConceptIdsToCheck: prereqsToCheck,
      alternativeSourceIds: altSources,
    },
    userChoices: ["pause_24h", "defer_for_later", "dismiss_remediation"],
    rationale,
  };
}

// ============================================================================
// 3. Transactional Grade Invalidation Impact & Clean Recomputation
// ============================================================================

export interface InvalidationImpactOptions {
  nowIso?: string;
  replacementRecords?: readonly CompetencyEvidenceRecord[];
  invalidationEventId?: string;
  excludeAiExcluded?: boolean;
}

export interface AffectedDimensionRecomputation {
  conceptId: string;
  dimension: CompetencyDimension;
  previousProjection: DimensionProjection;
  recomputedProjection: DimensionProjection;
}

export interface InvalidationImpactResult {
  invalidatedGradeId: string;
  invalidatedEvidenceIds: string[];
  affectedConceptIds: string[];
  affectedPairs: AffectedDimensionRecomputation[];
  untouchedFsrsRecordCount: number;
  updatedEvidenceRecords: CompetencyEvidenceRecord[];
}

/**
 * Identifies all `(conceptId, dimension)` pairs affected by invalidating a grade,
 * marks only that grade's evidence records as invalidated (never touching unrelated
 * concepts or FSRS review history), and recomputes clean projections using
 * `estimateDimensionCompetency`.
 */
export function computeInvalidationImpact(
  invalidatedGradeId: string,
  evidenceRecords: readonly CompetencyEvidenceRecord[],
  options?: InvalidationImpactOptions,
): InvalidationImpactResult {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const invalidationEventId =
    options?.invalidationEventId ?? `invalidate:${invalidatedGradeId}`;
  const replacementRecords = options?.replacementRecords ?? [];
  const excludeAiExcluded = Boolean(options?.excludeAiExcluded);

  const invalidatedEvidenceIds: string[] = [];
  const affectedPairMap = new Map<
    string,
    { conceptId: string; dimension: CompetencyDimension }
  >();
  let untouchedFsrsRecordCount = 0;

  const updatedEvidenceRecords: CompetencyEvidenceRecord[] = evidenceRecords.map(
    (record) => {
      if (record.sourceKind === "fsrs_review") {
        untouchedFsrsRecordCount += 1;
        return { ...record };
      }

      const belongsToGrade = record.sourceRecordId === invalidatedGradeId;
      if (belongsToGrade && !record.isInvalidated) {
        invalidatedEvidenceIds.push(record.id);
        const key = `${record.conceptId}::${record.dimension}`;
        affectedPairMap.set(key, {
          conceptId: record.conceptId,
          dimension: record.dimension,
        });
        return {
          ...record,
          isInvalidated: true,
          invalidatedByEventId: invalidationEventId,
        };
      }

      return { ...record };
    },
  );

  for (const replacement of replacementRecords) {
    updatedEvidenceRecords.push({ ...replacement });
    const key = `${replacement.conceptId}::${replacement.dimension}`;
    affectedPairMap.set(key, {
      conceptId: replacement.conceptId,
      dimension: replacement.dimension,
    });
  }

  const sortedPairs = [...affectedPairMap.values()].sort((a, b) => {
    const conceptCmp = a.conceptId.localeCompare(b.conceptId);
    if (conceptCmp !== 0) return conceptCmp;
    return a.dimension.localeCompare(b.dimension);
  });

  const affectedPairs: AffectedDimensionRecomputation[] = sortedPairs.map(
    ({ conceptId, dimension }) => {
      const beforeRecords = evidenceRecords.filter(
        (r) => r.conceptId === conceptId && r.dimension === dimension,
      );
      const afterRecords = updatedEvidenceRecords.filter(
        (r) => r.conceptId === conceptId && r.dimension === dimension,
      );

      const previousProjection = estimateDimensionCompetency(
        beforeRecords,
        nowIso,
        { dimension, excludeAiExcluded },
      );
      const recomputedProjection = estimateDimensionCompetency(
        afterRecords,
        nowIso,
        { dimension, excludeAiExcluded },
      );

      return {
        conceptId,
        dimension,
        previousProjection,
        recomputedProjection,
      };
    },
  );

  const affectedConceptIds = [
    ...new Set(sortedPairs.map((pair) => pair.conceptId)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    invalidatedGradeId,
    invalidatedEvidenceIds,
    affectedConceptIds,
    affectedPairs,
    untouchedFsrsRecordCount,
    updatedEvidenceRecords,
  };
}
