/**
 * Unified Learning Goals domain types.
 *
 * Implements the composable intent layer above documents, collections,
 * saved queues, concepts, Smart Feeds, and optional Study Plans.
 */

export type CompetencyDimension =
  | "exposure"
  | "comprehension"
  | "retention"
  | "application"
  | "transfer";

export type CompetencyStatus =
  | "unknown"
  | "insufficient_evidence"
  | "needs_attention"
  | "developing"
  | "demonstrated";

export interface GoalDimensionProjection {
  dimension: CompetencyDimension;
  status: CompetencyStatus;
  estimate: number | null;
  confidence?: number;
  lastEvidenceAt?: string | null;
}

export type LearningGoalKind =
  | "exploration"
  | "retention"
  | "mastery"
  | "deadline"
  | "skill"
  | "continuous"
  | "language";

export type LearningGoalStatus = "active" | "paused" | "completed" | "archived";

export type GoalSourceKind =
  | "document"
  | "collection"
  | "saved_queue"
  | "study_plan"
  | "smart_feed"
  | "concept"
  | "tag";

export type GoalSourceRole =
  | "primary"
  | "supplemental"
  | "exploration_candidate";

export type LearningGoalMilestoneStatus = "pending" | "completed" | "skipped";

export interface LearningGoalPolicy {
  defaultDimensions: CompetencyDimension[];
  defaultMasteryThreshold: number;
  expectsDeadline: boolean;
  expectsStudyPlan: boolean;
  defaultDailyMinutesBudget: number | null;
  smartFeedsPrimary: boolean;
  allowZeroDeadline: boolean;
  [key: string]: unknown;
}

export interface LearningGoalSource {
  id: string;
  goalId: string;
  sourceKind: GoalSourceKind;
  sourceId: string;
  sourceRole: GoalSourceRole;
  weight: number;
  addedAt: string;
  label?: string;
  isAiExcluded?: boolean;
}

export interface LearningGoalMilestone {
  id: string;
  goalId: string;
  title: string;
  targetDate: string | null;
  status: LearningGoalMilestoneStatus;
  linkedNodeId: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningGoal {
  id: string;
  title: string;
  description: string | null;
  kind: LearningGoalKind;
  status: LearningGoalStatus;
  priority: number;
  studyPlanId: string | null;
  languageCode: string | null;
  targetDate: string | null;
  dailyMinutesBudget: number | null;
  targetDimensions: CompetencyDimension[];
  targetMasteryThreshold: number;
  policy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sources: LearningGoalSource[];
  milestones: LearningGoalMilestone[];
}

export interface CreateLearningGoalSourceInput {
  sourceKind: GoalSourceKind;
  sourceId: string;
  sourceRole?: GoalSourceRole;
  weight?: number;
  label?: string;
  isAiExcluded?: boolean;
}

export interface CreateLearningGoalInput {
  title: string;
  description?: string | null;
  kind?: LearningGoalKind;
  priority?: number;
  studyPlanId?: string | null;
  languageCode?: string | null;
  targetDate?: string | null;
  dailyMinutesBudget?: number | null;
  targetDimensions?: CompetencyDimension[];
  targetMasteryThreshold?: number;
  policy?: Record<string, unknown>;
  initialSources?: CreateLearningGoalSourceInput[];
}

export interface UpdateLearningGoalInput {
  title?: string;
  description?: string | null;
  priority?: number;
  languageCode?: string | null;
  targetDate?: string | null;
  dailyMinutesBudget?: number | null;
  targetDimensions?: CompetencyDimension[];
  targetMasteryThreshold?: number;
  policy?: Record<string, unknown>;
  status?: LearningGoalStatus;
}

export interface EvolveLearningGoalInput {
  kind?: LearningGoalKind;
  studyPlanId?: string | null;
  targetDate?: string | null;
  dailyMinutesBudget?: number | null;
  targetDimensions?: CompetencyDimension[];
  targetMasteryThreshold?: number;
  languageCode?: string | null;
  policy?: Record<string, unknown>;
}

export type GoalFeasibilityStatus =
  | "unbounded"
  | "on_track"
  | "tight"
  | "at_risk"
  | "infeasible"
  | "insufficient_data";

export type GoalAdjustmentKind =
  | "increase_daily_budget"
  | "extend_deadline"
  | "narrow_scope"
  | "focus_weakest_dimensions";

export interface GoalAdjustmentSuggestion {
  kind: GoalAdjustmentKind;
  summary: string;
  suggestedDailyMinutesBudget?: number;
  suggestedTargetDate?: string;
  deferrableSourceIds?: string[];
  deferrableConceptIds?: string[];
  focusDimensions?: CompetencyDimension[];
}

export interface GoalFeasibilityReport {
  goalId: string;
  status: GoalFeasibilityStatus;
  remainingMinutes: number;
  remainingConceptMinutes: number;
  remainingReadingMinutes: number;
  projectedReviewMinutes: number;
  availableMinutes: number | null;
  daysRemaining: number | null;
  requiredDailyMinutes: number | null;
  utilizationRatio: number | null;
  progressRatio: number;
  priorMasteredConceptCount: number;
  totalConceptCount: number;
  recommendations: GoalAdjustmentSuggestion[];
  uncertaintyReasons: string[];
  evaluatedAt: string;
}

export interface LearningGoalProgressSummary {
  goalId: string;
  progressRatio: number;
  priorMasteredConceptCount: number;
  totalConceptCount: number;
  completedMilestoneCount: number;
  totalMilestoneCount: number;
  sourceCount: number;
  feasibilityStatus: GoalFeasibilityStatus;
  remainingMinutes: number;
  daysRemaining: number | null;
}
