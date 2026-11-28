/**
 * Pure, deterministic Learning Goal feasibility engine, policy defaults,
 * and source-link invariants.
 *
 * Matches the specification in
 * `openspec/changes/unify-learning-goals-and-study-plans/design.md`.
 */

import type {
  CompetencyDimension,
  GoalAdjustmentSuggestion,
  GoalDimensionProjection,
  GoalFeasibilityReport,
  GoalFeasibilityStatus,
  GoalSourceKind,
  GoalSourceRole,
  LearningGoal,
  LearningGoalKind,
  LearningGoalPolicy,
  LearningGoalSource,
} from "../../types/learningGoal";

const MS_PER_DAY = 86_400_000;
const DEFAULT_DAILY_MINUTES_BUDGET = 30;
const MAX_SUGGESTED_DAILY_MINUTES = 180;
const DEVELOPING_MIN_REMAINING_FRACTION = 0.15;

export interface GoalConceptFeasibilityInput {
  conceptId: string;
  estimatedMinutesToMaster: number;
  priority?: number;
  dimensions: Partial<Record<CompetencyDimension, GoalDimensionProjection>>;
}

export interface EvaluateGoalFeasibilityInput {
  goal: Pick<
    LearningGoal,
    | "id"
    | "kind"
    | "targetDate"
    | "dailyMinutesBudget"
    | "targetDimensions"
    | "targetMasteryThreshold"
  >;
  conceptStates?: ReadonlyArray<GoalConceptFeasibilityInput>;
  uncompletedReadingMinutes?: number;
  projectedDueReviewMinutes?: number;
  sources?: ReadonlyArray<
    Pick<LearningGoalSource, "sourceId" | "sourceKind" | "sourceRole" | "weight">
  >;
  nowIso?: string;
}

export interface GoalSourceLinkValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Sensible defaults per goal kind. Casual `exploration` goals require only a
 * title, no deadline, and no study plan.
 */
export function getDefaultGoalPolicy(kind: LearningGoalKind): LearningGoalPolicy {
  switch (kind) {
    case "exploration":
      return {
        defaultDimensions: ["exposure", "comprehension"],
        defaultMasteryThreshold: 0.65,
        expectsDeadline: false,
        expectsStudyPlan: false,
        defaultDailyMinutesBudget: null,
        smartFeedsPrimary: false,
        allowZeroDeadline: true,
      };
    case "retention":
      return {
        defaultDimensions: ["retention"],
        defaultMasteryThreshold: 0.85,
        expectsDeadline: false,
        expectsStudyPlan: false,
        defaultDailyMinutesBudget: 20,
        smartFeedsPrimary: false,
        allowZeroDeadline: true,
      };
    case "mastery":
      return {
        defaultDimensions: ["comprehension", "retention", "application"],
        defaultMasteryThreshold: 0.85,
        expectsDeadline: false,
        expectsStudyPlan: true,
        defaultDailyMinutesBudget: 45,
        smartFeedsPrimary: false,
        allowZeroDeadline: true,
      };
    case "deadline":
      return {
        defaultDimensions: ["comprehension", "retention", "application"],
        defaultMasteryThreshold: 0.8,
        expectsDeadline: true,
        expectsStudyPlan: true,
        defaultDailyMinutesBudget: 45,
        smartFeedsPrimary: false,
        allowZeroDeadline: false,
      };
    case "skill":
      return {
        defaultDimensions: ["comprehension", "application", "transfer"],
        defaultMasteryThreshold: 0.8,
        expectsDeadline: false,
        expectsStudyPlan: false,
        defaultDailyMinutesBudget: 30,
        smartFeedsPrimary: false,
        allowZeroDeadline: true,
      };
    case "continuous":
      return {
        defaultDimensions: ["exposure", "comprehension"],
        defaultMasteryThreshold: 0.7,
        expectsDeadline: false,
        expectsStudyPlan: false,
        defaultDailyMinutesBudget: 15,
        smartFeedsPrimary: true,
        allowZeroDeadline: true,
      };
    case "language":
      return {
        defaultDimensions: ["comprehension", "retention", "application"],
        defaultMasteryThreshold: 0.8,
        expectsDeadline: false,
        expectsStudyPlan: false,
        defaultDailyMinutesBudget: 30,
        smartFeedsPrimary: false,
        allowZeroDeadline: true,
      };
  }
}

/**
 * Enforces the Smart Feed boundary: a `smart_feed` source MUST have
 * `sourceRole === "exploration_candidate"` and never auto-creates SRS
 * obligations.
 */
export function validateGoalSourceLink(
  sourceKind: GoalSourceKind,
  sourceRole: GoalSourceRole
): GoalSourceLinkValidation {
  if (sourceKind === "smart_feed" && sourceRole !== "exploration_candidate") {
    return {
      valid: false,
      reason:
        "Smart Feed sources must use sourceRole 'exploration_candidate' and never auto-create SRS review obligations.",
    };
  }
  return { valid: true };
}

export function assertValidGoalSourceLink(
  sourceKind: GoalSourceKind,
  sourceRole: GoalSourceRole
): void {
  const result = validateGoalSourceLink(sourceKind, sourceRole);
  if (!result.valid) {
    throw new Error(result.reason ?? "Invalid learning goal source link");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dimensionRemainingFraction(
  projection: GoalDimensionProjection | undefined,
  threshold: number
): number {
  if (!projection) {
    return 1.0;
  }

  if (
    projection.status === "demonstrated" &&
    projection.estimate !== null &&
    projection.estimate >= threshold
  ) {
    return 0.0;
  }

  if (projection.status === "developing" && projection.estimate !== null) {
    const ratio = clamp(projection.estimate / threshold, 0, 1);
    return Math.max(DEVELOPING_MIN_REMAINING_FRACTION, 1.0 - ratio);
  }

  // unknown, insufficient_evidence, needs_attention, or missing estimate
  return 1.0;
}

/**
 * Deterministically evaluates competency-aware progress and deadline
 * feasibility without mutating any input state, schedules, or sources.
 */
export function evaluateGoalFeasibility(
  input: EvaluateGoalFeasibilityInput
): GoalFeasibilityReport {
  const { goal } = input;
  const evaluatedAt = input.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(evaluatedAt);

  const policy = getDefaultGoalPolicy(goal.kind);
  const targetDimensions =
    goal.targetDimensions.length > 0
      ? goal.targetDimensions
      : policy.defaultDimensions;
  const threshold = clamp(
    goal.targetMasteryThreshold > 0
      ? goal.targetMasteryThreshold
      : policy.defaultMasteryThreshold,
    0.01,
    1.0
  );
  const dailyBudget = Math.max(
    1,
    goal.dailyMinutesBudget ??
      policy.defaultDailyMinutesBudget ??
      DEFAULT_DAILY_MINUTES_BUDGET
  );

  const conceptStates = input.conceptStates ?? [];
  const readingMinutes = Math.max(0, input.uncompletedReadingMinutes ?? 0);
  const reviewMinutes = Math.max(0, input.projectedDueReviewMinutes ?? 0);
  const sources = input.sources ?? [];

  // 1. Competency-aware remaining concept effort
  let totalConceptEffort = 0;
  let remainingConceptEffort = 0;
  let priorMasteredConceptCount = 0;

  const dimensionGapTotals = new Map<CompetencyDimension, number>();
  for (const dim of targetDimensions) {
    dimensionGapTotals.set(dim, 0);
  }

  const unmasteredConcepts: Array<{
    conceptId: string;
    priority: number;
    remainingMinutes: number;
  }> = [];

  for (const concept of conceptStates) {
    const estimated = Math.max(0, concept.estimatedMinutesToMaster);
    totalConceptEffort += estimated;

    let dimFractionSum = 0;
    let allDimensionsMastered = true;

    for (const dim of targetDimensions) {
      const frac = dimensionRemainingFraction(concept.dimensions[dim], threshold);
      dimFractionSum += frac;
      dimensionGapTotals.set(dim, (dimensionGapTotals.get(dim) ?? 0) + frac);
      if (frac > 0) {
        allDimensionsMastered = false;
      }
    }

    const meanFraction = dimFractionSum / targetDimensions.length;
    const conceptRemaining = estimated * meanFraction;
    remainingConceptEffort += conceptRemaining;

    if (allDimensionsMastered) {
      priorMasteredConceptCount += 1;
    } else {
      unmasteredConcepts.push({
        conceptId: concept.conceptId,
        priority: concept.priority ?? 50,
        remainingMinutes: conceptRemaining,
      });
    }
  }

  // 2. Total remaining effort
  const remainingConceptMinutes = Math.round(remainingConceptEffort);
  const remainingReadingMinutes = Math.round(readingMinutes);
  const projectedReviewMinutes = Math.round(reviewMinutes);
  const remainingMinutes =
    remainingConceptMinutes + remainingReadingMinutes + projectedReviewMinutes;

  const progressRatio =
    totalConceptEffort > 0
      ? clamp(1 - remainingConceptEffort / totalConceptEffort, 0, 1)
      : conceptStates.length > 0
        ? clamp(priorMasteredConceptCount / conceptStates.length, 0, 1)
        : 0;

  // 3. Unbounded (no deadline)
  if (!goal.targetDate) {
    return {
      goalId: goal.id,
      status: "unbounded",
      remainingMinutes,
      remainingConceptMinutes,
      remainingReadingMinutes,
      projectedReviewMinutes,
      availableMinutes: null,
      daysRemaining: null,
      requiredDailyMinutes: null,
      utilizationRatio: null,
      progressRatio,
      priorMasteredConceptCount,
      totalConceptCount: conceptStates.length,
      recommendations: [],
      uncertaintyReasons: [],
      evaluatedAt,
    };
  }

  const targetMs = Date.parse(goal.targetDate);
  const daysRemaining = Number.isNaN(targetMs)
    ? 0
    : Math.max(0, Math.ceil((targetMs - nowMs) / MS_PER_DAY));
  const availableMinutes = daysRemaining * dailyBudget;

  // 4. Honest insufficient_data check: deadline is set, but zero workload/concept/source info
  const hasWorkloadData =
    conceptStates.length > 0 || readingMinutes > 0 || reviewMinutes > 0;
  if (!hasWorkloadData) {
    return {
      goalId: goal.id,
      status: "insufficient_data",
      remainingMinutes: 0,
      remainingConceptMinutes: 0,
      remainingReadingMinutes: 0,
      projectedReviewMinutes: 0,
      availableMinutes,
      daysRemaining,
      requiredDailyMinutes: null,
      utilizationRatio: null,
      progressRatio: 0,
      priorMasteredConceptCount: 0,
      totalConceptCount: 0,
      recommendations: [],
      uncertaintyReasons: [
        "No linked concepts, reading workload, or projected review workload available to estimate deadline feasibility.",
      ],
      evaluatedAt,
    };
  }

  // 5. Deadline classification
  let status: GoalFeasibilityStatus;
  let requiredDailyMinutes: number;
  let utilizationRatio: number;

  if (daysRemaining === 0 && remainingMinutes > 0) {
    status = "infeasible";
    requiredDailyMinutes = remainingMinutes;
    utilizationRatio = Number.POSITIVE_INFINITY;
  } else if (remainingMinutes === 0) {
    status = "on_track";
    requiredDailyMinutes = 0;
    utilizationRatio = 0;
  } else {
    requiredDailyMinutes = Math.ceil(remainingMinutes / daysRemaining);
    utilizationRatio = remainingMinutes / Math.max(1, availableMinutes);

    if (utilizationRatio <= 0.8) {
      status = "on_track";
    } else if (utilizationRatio <= 1.05) {
      status = "tight";
    } else if (utilizationRatio <= 1.4) {
      status = "at_risk";
    } else {
      status = "infeasible";
    }
  }

  // 6. Non-mutating adjustment recommendations for at_risk / infeasible goals
  const recommendations: GoalAdjustmentSuggestion[] = [];
  if (status === "at_risk" || status === "infeasible") {
    const suggestedDaily = Math.min(
      MAX_SUGGESTED_DAILY_MINUTES,
      Math.max(dailyBudget, requiredDailyMinutes)
    );
    recommendations.push({
      kind: "increase_daily_budget",
      summary: `Increase daily study budget from ${dailyBudget} min/day to ${suggestedDaily} min/day.`,
      suggestedDailyMinutesBudget: suggestedDaily,
    });

    const neededDays = Math.ceil(remainingMinutes / Math.max(1, dailyBudget * 0.8));
    const suggestedTargetDate = new Date(
      nowMs + neededDays * MS_PER_DAY
    ).toISOString();
    recommendations.push({
      kind: "extend_deadline",
      summary: `Extend deadline by ${Math.max(1, neededDays - daysRemaining)} day(s) to reach an on-track pace at ${dailyBudget} min/day.`,
      suggestedTargetDate,
    });

    const deferrableSourceIds = sources
      .filter((s) => s.sourceRole === "supplemental")
      .map((s) => s.sourceId);
    const deferrableConceptIds =
      unmasteredConcepts.length > 1
        ? [...unmasteredConcepts]
            .sort(
              (a, b) =>
                a.priority - b.priority || b.remainingMinutes - a.remainingMinutes
            )
            .slice(0, Math.max(1, Math.floor(unmasteredConcepts.length / 2)))
            .map((c) => c.conceptId)
        : [];

    if (deferrableSourceIds.length > 0 || deferrableConceptIds.length > 0) {
      recommendations.push({
        kind: "narrow_scope",
        summary:
          "Defer supplemental sources or lower-priority concepts to reduce required workload without deleting content.",
        deferrableSourceIds:
          deferrableSourceIds.length > 0 ? deferrableSourceIds : undefined,
        deferrableConceptIds:
          deferrableConceptIds.length > 0 ? deferrableConceptIds : undefined,
      });
    }

    if (conceptStates.length > 0 && targetDimensions.length > 0) {
      const rankedWeakest = [...targetDimensions]
        .map((dim) => ({
          dim,
          avgGap: (dimensionGapTotals.get(dim) ?? 0) / conceptStates.length,
        }))
        .filter((entry) => entry.avgGap > 0.25)
        .sort((a, b) => b.avgGap - a.avgGap)
        .slice(0, 2)
        .map((entry) => entry.dim);

      if (rankedWeakest.length > 0) {
        recommendations.push({
          kind: "focus_weakest_dimensions",
          summary: `Prioritize weakest target dimensions (${rankedWeakest.join(", ")}) for highest mastery gain per minute.`,
          focusDimensions: rankedWeakest,
        });
      }
    }
  }

  return {
    goalId: goal.id,
    status,
    remainingMinutes,
    remainingConceptMinutes,
    remainingReadingMinutes,
    projectedReviewMinutes,
    availableMinutes,
    daysRemaining,
    requiredDailyMinutes,
    utilizationRatio,
    progressRatio,
    priorMasteredConceptCount,
    totalConceptCount: conceptStates.length,
    recommendations,
    uncertaintyReasons: [],
    evaluatedAt,
  };
}
