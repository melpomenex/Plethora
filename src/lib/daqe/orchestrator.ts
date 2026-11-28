/**
 * Pure, deterministic, offline-first heterogeneous DAQE learning orchestrator.
 *
 * Implements the TypeScript orchestration pipeline for `extend-daqe-learning-orchestration`:
 * - Deduplicates heterogeneous candidates across providers by canonical `dedupeKey`
 *   while merging `goalReferences` without double-counting priority signals.
 * - Scores candidates using documented normalized `[0, 1]` factors parameterized by
 *   a `SessionFocusProfile`, treating absent signals honestly as `null` ("unavailable")
 *   rather than fabricating zeros.
 * - Preserves `orderingMode: "strict_manual"` without adaptive weight overrides.
 * - Packs activities into a `SessionTimeBudget` (5..120m, custom number, or `"unlimited"`)
 *   with single-deadline diversity capping and due-retention starvation prevention.
 * - Produces deterministic `RecommendationExplanation` ("Why am I seeing this?")
 *   derived solely from actual factor contributions (zero LLM fabrication).
 * - Produces a non-coercive `OverloadAdvisorReport` that never mutates FSRS schedules.
 * - Enforces privacy boundaries: preserves `isLocalOnly` / `isAiExcluded` items locally
 *   with `cloudAiAllowed: false` and strictly rejects any Health Vault inputs.
 */

import type { GoalFeasibilityStatus } from "../../types/learningGoal";

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export const SESSION_FOCUS_PROFILES = [
  "balanced",
  "free_exploration",
  "memory_retention",
  "exam_prep",
  "deep_study",
  "custom",
] as const;

export type SessionFocusProfile = (typeof SESSION_FOCUS_PROFILES)[number];

export type SessionTimeBudget = 5 | 15 | 30 | 60 | 120 | number | "unlimited";

export const CANDIDATE_PROVIDER_KINDS = [
  "srs_due_pool",
  "learning_goals",
  "guided_trails",
  "remediation",
  "exam_prep",
  "smart_feeds",
  "pinned",
  "continue_reading",
] as const;

export type CandidateProviderKind = (typeof CANDIDATE_PROVIDER_KINDS)[number];

export type LearningActivityKind =
  | "srs_review"
  | "incremental_read"
  | "study_workspace"
  | "guided_reading"
  | "remediation"
  | "practice_check"
  | "exam_attempt"
  | "exploration_feed"
  | "pinned_item"
  | "continue_reading";

export type OrderingMode = "strict_manual" | "adaptive";

export const SCORING_FACTOR_KEYS = [
  "srsUrgency",
  "goalAlignment",
  "deadlinePressure",
  "knowledgeGap",
  "prerequisiteReadiness",
  "userPriority",
  "interest",
  "durationFit",
] as const;

export type ScoringFactorKey = (typeof SCORING_FACTOR_KEYS)[number];

export type FocusProfileWeights = Record<ScoringFactorKey, number>;

export interface GoalReference {
  goalId: string;
  goalTitle?: string;
  /** Optional goal priority in [0, 1] or canonical scale; used for context only. */
  goalPriority?: number;
  /** Optional feasibility status of this goal. */
  feasibilityStatus?: GoalFeasibilityStatus;
}

/**
 * Normalized `[0, 1]` scoring signals for a candidate.
 * Absent signals MUST be `null` or `undefined` — they are treated as
 * `"unavailable"` and renormalized out rather than fabricated as `0`.
 */
export interface CandidateSignals {
  srsUrgency?: number | null;
  goalAlignment?: number | null;
  deadlinePressure?: number | null;
  knowledgeGap?: number | null;
  prerequisiteReadiness?: number | null;
  userPriority?: number | null;
  interest?: number | null;
  durationFit?: number | null;
  /** Optional negative penalty in [0, 1] for topic repetition. */
  interleavePenalty?: number | null;
  /** Optional negative penalty in [0, 1] for recent skips/postponements. */
  frictionPenalty?: number | null;
}

export interface DaqeActivityCandidate {
  id: string;
  /** Canonical deduplication key (e.g. `flashcard:123`, `document:abc`). */
  dedupeKey: string;
  title: string;
  providerKind: CandidateProviderKind;
  activityKind: LearningActivityKind;
  /** Estimated duration in minutes (positive number). */
  estimatedMinutes: number;
  /** Normalized scoring signals; absent fields are `null` / `undefined`. */
  signals: CandidateSignals;
  /** Explicit user manual priority (higher = earlier in `strict_manual` mode). */
  manualPriority?: number | null;
  /** Optional ISO timestamp when this item is due (read-only; never mutated). */
  dueAt?: string | null;
  /** Optional FSRS retrievability in [0, 1] (read-only; never mutated). */
  retrievability?: number | null;
  /** Optional topic / cluster key used for lightweight interleaving. */
  topicKey?: string | null;
  /** Active Learning Goals referencing this candidate. */
  goalReferences?: readonly GoalReference[];
  /** Whether the user explicitly pinned this candidate. */
  isPinned?: boolean;
  /** Whether this candidate is new/exploration material (eligible for pause-new relief). */
  isNewMaterial?: boolean;
  /** Privacy boundary: local-only content stays local and never leaves the device. */
  isLocalOnly?: boolean;
  /** Privacy boundary: AI-excluded content must never be sent to cloud AI. */
  isAiExcluded?: boolean;
  /** Optional source domain marker; `"health_vault"` is strictly rejected. */
  sourceDomain?: string;
  /** Explicit Health Vault flag; strictly rejected if `true`. */
  isHealthVault?: boolean;
}

export interface GoalDeadlineContext {
  goalId: string;
  title: string;
  feasibilityStatus: GoalFeasibilityStatus;
  requiredDailyMinutes?: number | null;
  remainingMinutes?: number | null;
  daysRemaining?: number | null;
}

export interface DaqeOrchestrationInput {
  candidates: readonly DaqeActivityCandidate[];
  focusProfile: SessionFocusProfile;
  timeBudgetMinutes: SessionTimeBudget;
  orderingMode?: OrderingMode;
  /** Custom factor weights used when `focusProfile === "custom"`. */
  customWeights?: Partial<FocusProfileWeights>;
  /** Rolling 7-day average daily study minutes for overload calibration. */
  rollingDailyStudyMinutes?: number | null;
  /** Active goal deadline summaries for overload & deadline balancing. */
  goals?: readonly GoalDeadlineContext[];
  /** Optional explicit goal filter (e.g. user selected `focus_single_deadline`). */
  focusedGoalId?: string | null;
  /** Optional maximum number of items to pack into `selected`. */
  maxItems?: number | null;
  /** Optional share cap [0.25, 1.0] for any single goal when multiple goals compete. Default 0.65. */
  maxSingleGoalShare?: number;
  /** Optional minimum budget share [0, 0.6] reserved for critical due retention. Default 0.30. */
  retentionReserveShare?: number;
}

export interface FactorContribution {
  key: ScoringFactorKey;
  label: string;
  state: "measured" | "defaulted" | "unavailable";
  normalizedValue: number | null;
  /** Base weight from the active focus profile. */
  weight: number;
  /** Weight after honest renormalization over available factors. */
  effectiveWeight: number;
  signedContribution: number;
}

export interface RecommendationExplanation {
  providerKind: CandidateProviderKind;
  sourceProviders: CandidateProviderKind[];
  focusProfile: SessionFocusProfile;
  orderingMode: OrderingMode;
  primaryReason: string;
  secondaryReasons: string[];
  factors: FactorContribution[];
  totalScore: number;
  /** Always `false`: explanations are deterministically derived from factor math, never an LLM. */
  llmGenerated: false;
}

export interface MergedActivityCandidate extends DaqeActivityCandidate {
  /** All providers that surfaced this canonical `dedupeKey`. */
  sourceProviders: CandidateProviderKind[];
  /** Deduplicated goal references merged across duplicate candidates. */
  goalReferences: GoalReference[];
  /** Number of raw candidate entries collapsed into this canonical record. */
  mergedCount: number;
  /** `false` whenever `isLocalOnly` or `isAiExcluded` is set. */
  cloudAiAllowed: boolean;
}

export interface RankedActivityItem {
  candidate: MergedActivityCandidate;
  rank: number;
  score: number;
  availableFactorCount: number;
  explanation: RecommendationExplanation;
  cloudAiAllowed: boolean;
}

export type OverloadTriggerKind =
  | "srs_backlog_overload"
  | "deadline_crunch"
  | "budget_mismatch";

export type OverloadSuggestionKind =
  | "pause_new_material"
  | "defer_low_priority"
  | "focus_retention_triage"
  | "focus_single_deadline"
  | "keep_as_is";

export interface OverloadSuggestion {
  kind: OverloadSuggestionKind;
  label: string;
  description: string;
  /** Candidate IDs suggested for optional deferral (never auto-applied). */
  deferrableCandidateIds?: string[];
  /** Goal ID suggested when `kind === "focus_single_deadline"`. */
  targetGoalId?: string;
}

export interface OverloadAdvisorReport {
  isOverloaded: boolean;
  triggers: OverloadTriggerKind[];
  totalDueRetentionMinutes: number;
  totalUrgentDeadlineMinutes: number;
  totalDemandMinutes: number;
  sessionCapacityMinutes: number | null;
  dailyCapacityMinutes: number;
  deferrableCandidateIds: string[];
  suggestions: OverloadSuggestion[];
  /** Always `false`: overload advisor never mutates FSRS schedules or due dates. */
  mutatedSrsState: false;
  /** Always `false`: all relief actions are strictly opt-in advisories. */
  coercive: false;
}

export interface OrchestrationPrivacySummary {
  /** IDs of Health Vault inputs that were strictly rejected before scoring. */
  rejectedHealthVaultIds: string[];
  /** Number of local-only items preserved in local orchestration. */
  localOnlyItemCount: number;
  /** Number of AI-excluded items preserved in local orchestration. */
  aiExcludedItemCount: number;
  /** `false` if any ranked item is `isLocalOnly` or `isAiExcluded`. */
  planCloudAiAllowed: boolean;
  /** Always `true`: orchestration runs 100% locally with zero network/AI dependency. */
  offlineCapable: true;
  /** Always `false`: zero AI providers are invoked. */
  aiProviderUsed: false;
}

export interface DaqeOrchestrationPlan {
  focusProfile: SessionFocusProfile;
  orderingMode: OrderingMode;
  effectiveWeights: FocusProfileWeights;
  timeBudgetMinutes: SessionTimeBudget;
  /** Total estimated minutes of all `selected` items. */
  packedMinutes: number;
  /** Minutes exceeding a finite budget when the minimum single item exceeds the budget. */
  budgetOverflowMinutes: number;
  /** Deduplicated, scored, and deterministically ordered candidates. */
  ranked: RankedActivityItem[];
  /** Subset of `ranked` packed into the requested `timeBudgetMinutes`. */
  selected: RankedActivityItem[];
  /** Ranked candidates not packed into `selected` (e.g. exceeded budget or cap). */
  deferred: RankedActivityItem[];
  /** Number of duplicate raw candidates collapsed by `dedupeKey`. */
  deduplicatedCount: number;
  overload: OverloadAdvisorReport;
  privacy: OrchestrationPrivacySummary;
}

// ---------------------------------------------------------------------------
// Documented focus profile weight vectors
// ---------------------------------------------------------------------------

const FACTOR_LABELS: Record<ScoringFactorKey, string> = {
  srsUrgency: "SRS urgency",
  goalAlignment: "Goal alignment",
  deadlinePressure: "Deadline pressure",
  knowledgeGap: "Knowledge gap",
  prerequisiteReadiness: "Prerequisite readiness",
  userPriority: "User priority",
  interest: "Interest & novelty",
  durationFit: "Duration fit",
};

/**
 * Documented normalized weight vectors for the 6 Session Focus Profiles.
 * Every built-in vector sums to `1.0`.
 */
export const FOCUS_PROFILE_WEIGHTS: Readonly<Record<SessionFocusProfile, Readonly<FocusProfileWeights>>> = {
  balanced: {
    srsUrgency: 0.25,
    goalAlignment: 0.20,
    deadlinePressure: 0.14,
    knowledgeGap: 0.14,
    prerequisiteReadiness: 0.07,
    userPriority: 0.08,
    interest: 0.06,
    durationFit: 0.06,
  },
  free_exploration: {
    srsUrgency: 0.06,
    goalAlignment: 0.10,
    deadlinePressure: 0.00,
    knowledgeGap: 0.04,
    prerequisiteReadiness: 0.04,
    userPriority: 0.14,
    interest: 0.50,
    durationFit: 0.12,
  },
  memory_retention: {
    srsUrgency: 0.48,
    goalAlignment: 0.08,
    deadlinePressure: 0.06,
    knowledgeGap: 0.14,
    prerequisiteReadiness: 0.04,
    userPriority: 0.10,
    interest: 0.02,
    durationFit: 0.08,
  },
  exam_prep: {
    srsUrgency: 0.14,
    goalAlignment: 0.18,
    deadlinePressure: 0.30,
    knowledgeGap: 0.22,
    prerequisiteReadiness: 0.06,
    userPriority: 0.05,
    interest: 0.00,
    durationFit: 0.05,
  },
  deep_study: {
    srsUrgency: 0.08,
    goalAlignment: 0.26,
    deadlinePressure: 0.08,
    knowledgeGap: 0.20,
    prerequisiteReadiness: 0.14,
    userPriority: 0.10,
    interest: 0.04,
    durationFit: 0.10,
  },
  custom: {
    srsUrgency: 0.25,
    goalAlignment: 0.20,
    deadlinePressure: 0.14,
    knowledgeGap: 0.14,
    prerequisiteReadiness: 0.07,
    userPriority: 0.08,
    interest: 0.06,
    durationFit: 0.06,
  },
};

const DEFAULT_DAILY_STUDY_MINUTES = 45;
const DEFAULT_MAX_SINGLE_GOAL_SHARE = 0.65;
const DEFAULT_RETENTION_RESERVE_SHARE = 0.30;
const CRITICAL_RETRIEVABILITY_THRESHOLD = 0.75;
const CRITICAL_SRS_URGENCY_THRESHOLD = 0.60;
const INTERLEAVE_LOOKAHEAD = 8;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isAvailableNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePositiveMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 1;
  return minutes;
}

function compareNullableIsoAsc(a: string | null | undefined, b: string | null | undefined): number {
  const aHas = typeof a === "string" && a.length > 0;
  const bHas = typeof b === "string" && b.length > 0;
  if (aHas && bHas) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (aHas) return -1;
  if (bHas) return 1;
  return 0;
}

function compareStringsAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Resolve normalized weights summing to `1.0` for the given profile.
 * When `profile === "custom"`, merges `customWeights` over `balanced` defaults
 * and normalizes non-negative entries.
 */
export function resolveProfileWeights(
  profile: SessionFocusProfile,
  customWeights?: Partial<FocusProfileWeights>,
): FocusProfileWeights {
  const base = FOCUS_PROFILE_WEIGHTS[profile] ?? FOCUS_PROFILE_WEIGHTS.balanced;
  const raw: FocusProfileWeights = {
    srsUrgency: base.srsUrgency,
    goalAlignment: base.goalAlignment,
    deadlinePressure: base.deadlinePressure,
    knowledgeGap: base.knowledgeGap,
    prerequisiteReadiness: base.prerequisiteReadiness,
    userPriority: base.userPriority,
    interest: base.interest,
    durationFit: base.durationFit,
  };

  if (profile === "custom" && customWeights) {
    for (const key of SCORING_FACTOR_KEYS) {
      const override = customWeights[key];
      if (isAvailableNumber(override)) {
        raw[key] = Math.max(0, override);
      }
    }
  }

  let total = 0;
  for (const key of SCORING_FACTOR_KEYS) {
    total += raw[key];
  }
  if (total <= 0) {
    return { ...FOCUS_PROFILE_WEIGHTS.balanced };
  }

  return {
    srsUrgency: raw.srsUrgency / total,
    goalAlignment: raw.goalAlignment / total,
    deadlinePressure: raw.deadlinePressure / total,
    knowledgeGap: raw.knowledgeGap / total,
    prerequisiteReadiness: raw.prerequisiteReadiness / total,
    userPriority: raw.userPriority / total,
    interest: raw.interest / total,
    durationFit: raw.durationFit / total,
  };
}

// ---------------------------------------------------------------------------
// Privacy boundary: Health Vault rejection
// ---------------------------------------------------------------------------

const HEALTH_VAULT_PATTERN = /(?:^|[:/_-])health[_-]?vault(?:$|[:/_-])|health\/health\.db/i;

/**
 * Returns `true` if a candidate originates from the isolated Health Vault.
 * Health Vault items are strictly forbidden from entering learning orchestration.
 */
export function isHealthVaultCandidate(candidate: DaqeActivityCandidate): boolean {
  if (candidate.isHealthVault === true) return true;
  if (
    typeof candidate.sourceDomain === "string" &&
    HEALTH_VAULT_PATTERN.test(candidate.sourceDomain)
  ) {
    return true;
  }
  if (HEALTH_VAULT_PATTERN.test(candidate.dedupeKey)) return true;
  if (HEALTH_VAULT_PATTERN.test(candidate.id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Deduplication (without double-counting priority signals)
// ---------------------------------------------------------------------------

function maxNullableSignal(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const aOk = isAvailableNumber(a);
  const bOk = isAvailableNumber(b);
  if (aOk && bOk) return Math.max(clamp01(a), clamp01(b));
  if (aOk) return clamp01(a);
  if (bOk) return clamp01(b);
  return null;
}

function minNullableUnit(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const aOk = isAvailableNumber(a);
  const bOk = isAvailableNumber(b);
  if (aOk && bOk) return Math.min(clamp01(a), clamp01(b));
  if (aOk) return clamp01(a);
  if (bOk) return clamp01(b);
  return null;
}

function maxNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const aOk = isAvailableNumber(a);
  const bOk = isAvailableNumber(b);
  if (aOk && bOk) return Math.max(a, b);
  if (aOk) return a;
  if (bOk) return b;
  return null;
}

function mergeGoalReferences(
  existing: readonly GoalReference[],
  incoming: readonly GoalReference[] | undefined,
): GoalReference[] {
  if (!incoming || incoming.length === 0) {
    return existing.slice();
  }
  const byGoalId = new Map<string, GoalReference>();
  for (const ref of existing) {
    byGoalId.set(ref.goalId, { ...ref });
  }
  for (const ref of incoming) {
    const prev = byGoalId.get(ref.goalId);
    if (!prev) {
      byGoalId.set(ref.goalId, { ...ref });
    } else {
      byGoalId.set(ref.goalId, {
        goalId: ref.goalId,
        goalTitle: prev.goalTitle ?? ref.goalTitle,
        goalPriority: maxNullableNumber(prev.goalPriority, ref.goalPriority) ?? undefined,
        feasibilityStatus: prev.feasibilityStatus ?? ref.feasibilityStatus,
      });
    }
  }
  return Array.from(byGoalId.values()).sort((a, b) => compareStringsAsc(a.goalId, b.goalId));
}

/**
 * Deduplicate candidates by canonical `dedupeKey`.
 *
 * - Merges `goalReferences` and `sourceProviders` deterministically.
 * - Never sums or double-counts priority/scoring signals (takes canonical max).
 * - Preserves the strictest privacy flags (`isLocalOnly`, `isAiExcluded`).
 * - Never mutates input candidates.
 */
export function deduplicateCandidates(
  candidates: readonly DaqeActivityCandidate[],
): { merged: MergedActivityCandidate[]; deduplicatedCount: number } {
  const groups = new Map<string, DaqeActivityCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.dedupeKey;
    const list = groups.get(key);
    if (list) {
      list.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }

  const merged: MergedActivityCandidate[] = [];
  let deduplicatedCount = 0;

  for (const group of groups.values()) {
    if (group.length > 1) {
      deduplicatedCount += group.length - 1;
      // Sort group deterministically so merge output does not depend on input order.
      group.sort((a, b) => {
        const pDiff = (b.manualPriority ?? -Infinity) - (a.manualPriority ?? -Infinity);
        if (pDiff !== 0) return pDiff;
        const dueDiff = compareNullableIsoAsc(a.dueAt, b.dueAt);
        if (dueDiff !== 0) return dueDiff;
        return compareStringsAsc(a.id, b.id);
      });
    }

    const primary = group[0];
    const providerSet = new Set<CandidateProviderKind>([primary.providerKind]);
    let goalReferences = mergeGoalReferences([], primary.goalReferences);
    let isPinned = Boolean(primary.isPinned);
    let isLocalOnly = Boolean(primary.isLocalOnly);
    let isAiExcluded = Boolean(primary.isAiExcluded);
    let isNewMaterial = Boolean(primary.isNewMaterial);
    let manualPriority: number | null = isAvailableNumber(primary.manualPriority)
      ? primary.manualPriority
      : null;
    let dueAt: string | null = primary.dueAt ?? null;
    let retrievability: number | null = isAvailableNumber(primary.retrievability)
      ? clamp01(primary.retrievability)
      : null;
    let topicKey: string | null = primary.topicKey ?? null;
    let estimatedMinutes = normalizePositiveMinutes(primary.estimatedMinutes);

    const signals: CandidateSignals = {
      srsUrgency: isAvailableNumber(primary.signals.srsUrgency)
        ? clamp01(primary.signals.srsUrgency)
        : null,
      goalAlignment: isAvailableNumber(primary.signals.goalAlignment)
        ? clamp01(primary.signals.goalAlignment)
        : null,
      deadlinePressure: isAvailableNumber(primary.signals.deadlinePressure)
        ? clamp01(primary.signals.deadlinePressure)
        : null,
      knowledgeGap: isAvailableNumber(primary.signals.knowledgeGap)
        ? clamp01(primary.signals.knowledgeGap)
        : null,
      prerequisiteReadiness: isAvailableNumber(primary.signals.prerequisiteReadiness)
        ? clamp01(primary.signals.prerequisiteReadiness)
        : null,
      userPriority: isAvailableNumber(primary.signals.userPriority)
        ? clamp01(primary.signals.userPriority)
        : null,
      interest: isAvailableNumber(primary.signals.interest)
        ? clamp01(primary.signals.interest)
        : null,
      durationFit: isAvailableNumber(primary.signals.durationFit)
        ? clamp01(primary.signals.durationFit)
        : null,
      interleavePenalty: isAvailableNumber(primary.signals.interleavePenalty)
        ? clamp01(primary.signals.interleavePenalty)
        : null,
      frictionPenalty: isAvailableNumber(primary.signals.frictionPenalty)
        ? clamp01(primary.signals.frictionPenalty)
        : null,
    };

    for (let i = 1; i < group.length; i += 1) {
      const next = group[i];
      providerSet.add(next.providerKind);
      goalReferences = mergeGoalReferences(goalReferences, next.goalReferences);
      isPinned = isPinned || Boolean(next.isPinned);
      isLocalOnly = isLocalOnly || Boolean(next.isLocalOnly);
      isAiExcluded = isAiExcluded || Boolean(next.isAiExcluded);
      isNewMaterial = isNewMaterial && Boolean(next.isNewMaterial);
      manualPriority = maxNullableNumber(manualPriority, next.manualPriority);
      if (compareNullableIsoAsc(next.dueAt, dueAt) < 0) {
        dueAt = next.dueAt ?? null;
      }
      retrievability = minNullableUnit(retrievability, next.retrievability);
      if (!topicKey && next.topicKey) {
        topicKey = next.topicKey;
      }
      estimatedMinutes = Math.min(estimatedMinutes, normalizePositiveMinutes(next.estimatedMinutes));

      // Canonical max per signal — never additive, preventing multi-goal double counting.
      signals.srsUrgency = maxNullableSignal(signals.srsUrgency, next.signals.srsUrgency);
      signals.goalAlignment = maxNullableSignal(signals.goalAlignment, next.signals.goalAlignment);
      signals.deadlinePressure = maxNullableSignal(
        signals.deadlinePressure,
        next.signals.deadlinePressure,
      );
      signals.knowledgeGap = maxNullableSignal(signals.knowledgeGap, next.signals.knowledgeGap);
      signals.prerequisiteReadiness = maxNullableSignal(
        signals.prerequisiteReadiness,
        next.signals.prerequisiteReadiness,
      );
      signals.userPriority = maxNullableSignal(signals.userPriority, next.signals.userPriority);
      signals.interest = maxNullableSignal(signals.interest, next.signals.interest);
      signals.durationFit = maxNullableSignal(signals.durationFit, next.signals.durationFit);
      signals.interleavePenalty = maxNullableSignal(
        signals.interleavePenalty,
        next.signals.interleavePenalty,
      );
      signals.frictionPenalty = maxNullableSignal(
        signals.frictionPenalty,
        next.signals.frictionPenalty,
      );
    }

    const sourceProviders = Array.from(providerSet).sort(compareStringsAsc);
    const cloudAiAllowed = !isLocalOnly && !isAiExcluded;

    merged.push({
      id: primary.id,
      dedupeKey: primary.dedupeKey,
      title: primary.title,
      providerKind: primary.providerKind,
      activityKind: primary.activityKind,
      estimatedMinutes,
      signals,
      manualPriority,
      dueAt,
      retrievability,
      topicKey,
      goalReferences,
      isPinned,
      isNewMaterial,
      isLocalOnly,
      isAiExcluded,
      sourceDomain: primary.sourceDomain,
      isHealthVault: false,
      sourceProviders,
      mergedCount: group.length,
      cloudAiAllowed,
    });
  }

  return { merged, deduplicatedCount };
}

// ---------------------------------------------------------------------------
// Scoring & Deterministic Explainability
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic duration-fit score when the candidate did not supply
 * one explicitly AND the user requested a finite session budget.
 * Returns `null` when budget is `"unlimited"` (honestly unavailable).
 */
function deriveDefaultDurationFit(
  estimatedMinutes: number,
  timeBudgetMinutes: SessionTimeBudget,
  focusProfile: SessionFocusProfile,
): number | null {
  if (timeBudgetMinutes === "unlimited" || !Number.isFinite(timeBudgetMinutes) || timeBudgetMinutes <= 0) {
    return null;
  }
  const ratio = estimatedMinutes / timeBudgetMinutes;
  if (focusProfile === "deep_study") {
    // Deep study prefers sustained blocks (~25%–75% of budget) over tiny 1m fragments.
    if (ratio > 1) return clamp01(1 / (1 + (ratio - 1) * 2));
    if (ratio >= 0.25 && ratio <= 0.75) return 1;
    if (ratio < 0.25) return clamp01(0.4 + (ratio / 0.25) * 0.6);
    return clamp01(1 - (ratio - 0.75));
  }
  // Standard profiles prefer items that fit comfortably inside the budget.
  if (ratio <= 0.5) return 1;
  if (ratio <= 1.0) return clamp01(1 - (ratio - 0.5) * 0.5);
  return clamp01(0.5 / ratio);
}

function formatPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function buildDeterministicReason(
  candidate: MergedActivityCandidate,
  factors: FactorContribution[],
  orderingMode: OrderingMode,
  rank: number,
): { primaryReason: string; secondaryReasons: string[] } {
  if (orderingMode === "strict_manual") {
    const priorityLabel = isAvailableNumber(candidate.manualPriority)
      ? `priority ${candidate.manualPriority}`
      : "unprioritized";
    const primaryReason = `Manual priority order (${priorityLabel}, rank #${rank})`;
    const secondaryReasons: string[] = [];
    if (candidate.dueAt) {
      secondaryReasons.push(`Due ${candidate.dueAt}`);
    }
    if (candidate.goalReferences.length > 0) {
      secondaryReasons.push(
        `Linked to ${candidate.goalReferences.map((g) => g.goalTitle ?? g.goalId).join(", ")}`,
      );
    }
    return { primaryReason, secondaryReasons };
  }

  const positiveMeasured = factors
    .filter((f) => f.state !== "unavailable" && f.signedContribution > 0 && f.normalizedValue !== null)
    .sort((a, b) => {
      if (b.signedContribution !== a.signedContribution) {
        return b.signedContribution - a.signedContribution;
      }
      return compareStringsAsc(a.key, b.key);
    });

  if (positiveMeasured.length === 0) {
    return {
      primaryReason: `Included via ${candidate.providerKind} (no scored signals available)`,
      secondaryReasons: [],
    };
  }

  const describeFactor = (factor: FactorContribution): string => {
    const pct = formatPercent(factor.normalizedValue ?? 0);
    switch (factor.key) {
      case "srsUrgency":
        if (isAvailableNumber(candidate.retrievability)) {
          return `Due for review (retrievability ${formatPercent(candidate.retrievability)}, urgency ${pct})`;
        }
        return `High SRS urgency (${pct})`;
      case "goalAlignment":
        if (candidate.goalReferences.length === 1) {
          const g = candidate.goalReferences[0];
          return `Aligned with "${g.goalTitle ?? g.goalId}" (${pct})`;
        }
        if (candidate.goalReferences.length > 1) {
          return `Aligned with ${candidate.goalReferences.length} active goals (${pct})`;
        }
        return `Goal alignment (${pct})`;
      case "deadlinePressure":
        return `Approaching deadline pressure (${pct})`;
      case "knowledgeGap":
        return `Addresses knowledge gap (${pct})`;
      case "prerequisiteReadiness":
        return `Prerequisites ready (${pct})`;
      case "userPriority":
        return `High user priority (${pct})`;
      case "interest":
        return `High interest & exploration fit (${pct})`;
      case "durationFit":
        return `Fits session time budget (${pct})`;
    }
  };

  const top = positiveMeasured[0];
  const second = positiveMeasured[1];
  const primaryReason = second
    ? `${describeFactor(top)} and ${describeFactor(second).toLowerCase()}`
    : describeFactor(top);

  const secondaryReasons = positiveMeasured.slice(2, 4).map(describeFactor);
  if (candidate.mergedCount > 1) {
    secondaryReasons.push(
      `Deduplicated across ${candidate.mergedCount} sources (${candidate.sourceProviders.join(", ")})`,
    );
  }

  return { primaryReason, secondaryReasons };
}

function scoreCandidate(
  candidate: MergedActivityCandidate,
  weights: FocusProfileWeights,
  focusProfile: SessionFocusProfile,
  timeBudgetMinutes: SessionTimeBudget,
  orderingMode: OrderingMode,
): {
  score: number;
  availableFactorCount: number;
  factors: FactorContribution[];
} {
  const rawValues: Record<
    ScoringFactorKey,
    { value: number | null; state: "measured" | "defaulted" | "unavailable" }
  > = {
    srsUrgency: isAvailableNumber(candidate.signals.srsUrgency)
      ? { value: clamp01(candidate.signals.srsUrgency), state: "measured" }
      : { value: null, state: "unavailable" },
    goalAlignment: isAvailableNumber(candidate.signals.goalAlignment)
      ? { value: clamp01(candidate.signals.goalAlignment), state: "measured" }
      : { value: null, state: "unavailable" },
    deadlinePressure: isAvailableNumber(candidate.signals.deadlinePressure)
      ? { value: clamp01(candidate.signals.deadlinePressure), state: "measured" }
      : { value: null, state: "unavailable" },
    knowledgeGap: isAvailableNumber(candidate.signals.knowledgeGap)
      ? { value: clamp01(candidate.signals.knowledgeGap), state: "measured" }
      : { value: null, state: "unavailable" },
    prerequisiteReadiness: isAvailableNumber(candidate.signals.prerequisiteReadiness)
      ? { value: clamp01(candidate.signals.prerequisiteReadiness), state: "measured" }
      : { value: null, state: "unavailable" },
    userPriority: isAvailableNumber(candidate.signals.userPriority)
      ? { value: clamp01(candidate.signals.userPriority), state: "measured" }
      : { value: null, state: "unavailable" },
    interest: isAvailableNumber(candidate.signals.interest)
      ? { value: clamp01(candidate.signals.interest), state: "measured" }
      : { value: null, state: "unavailable" },
    durationFit: isAvailableNumber(candidate.signals.durationFit)
      ? { value: clamp01(candidate.signals.durationFit), state: "measured" }
      : (() => {
          const derived = deriveDefaultDurationFit(
            candidate.estimatedMinutes,
            timeBudgetMinutes,
            focusProfile,
          );
          return derived === null
            ? { value: null, state: "unavailable" }
            : { value: derived, state: "defaulted" };
        })(),
  };

  let availableWeightSum = 0;
  let availableFactorCount = 0;

  for (const key of SCORING_FACTOR_KEYS) {
    if (rawValues[key].state !== "unavailable") {
      availableFactorCount += 1;
      if (weights[key] > 0) {
        availableWeightSum += weights[key];
      }
    }
  }

  let score = 0;
  const factors: FactorContribution[] = [];

  for (const key of SCORING_FACTOR_KEYS) {
    const entry = rawValues[key];
    const baseWeight = weights[key];
    const effectiveWeight =
      entry.state !== "unavailable" && availableWeightSum > 0
        ? baseWeight / availableWeightSum
        : 0;
    const signedContribution =
      orderingMode === "adaptive" && entry.value !== null ? effectiveWeight * entry.value : 0;

    score += signedContribution;

    factors.push({
      key,
      label: FACTOR_LABELS[key],
      state: entry.state,
      normalizedValue: entry.value,
      weight: baseWeight,
      effectiveWeight,
      signedContribution,
    });
  }

  // Apply bounded negative penalties in adaptive mode if explicitly measured.
  if (orderingMode === "adaptive") {
    const interleavePenalty = isAvailableNumber(candidate.signals.interleavePenalty)
      ? clamp01(candidate.signals.interleavePenalty)
      : 0;
    const frictionPenalty = isAvailableNumber(candidate.signals.frictionPenalty)
      ? clamp01(candidate.signals.frictionPenalty)
      : 0;
    score = clamp01(score - 0.12 * interleavePenalty - 0.08 * frictionPenalty);
  } else {
    score = isAvailableNumber(candidate.manualPriority) ? candidate.manualPriority : 0;
  }

  return { score, availableFactorCount, factors };
}

// ---------------------------------------------------------------------------
// Packing: Time Budget, Retention Protection, Diversity Cap, Interleaving
// ---------------------------------------------------------------------------

function isCriticalDueRetention(item: RankedActivityItem): boolean {
  const c = item.candidate;
  const isRetentionKind =
    c.providerKind === "srs_due_pool" || c.activityKind === "srs_review";
  if (!isRetentionKind) return false;
  if (isAvailableNumber(c.retrievability) && c.retrievability < CRITICAL_RETRIEVABILITY_THRESHOLD) {
    return true;
  }
  if (isAvailableNumber(c.signals.srsUrgency) && c.signals.srsUrgency >= CRITICAL_SRS_URGENCY_THRESHOLD) {
    return true;
  }
  return Boolean(c.dueAt);
}

function primaryGoalIdOf(item: RankedActivityItem): string | null {
  const refs = item.candidate.goalReferences;
  return refs.length > 0 ? refs[0].goalId : null;
}

function applyLightweightInterleaving(items: RankedActivityItem[]): RankedActivityItem[] {
  if (items.length <= 2) return items.slice();
  const remaining = items.slice();
  const result: RankedActivityItem[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const prev = result[result.length - 1];
    const prevTopic = prev.candidate.topicKey ?? primaryGoalIdOf(prev);
    let chosenIdx = 0;

    if (prevTopic) {
      const limit = Math.min(remaining.length, INTERLEAVE_LOOKAHEAD);
      for (let i = 0; i < limit; i += 1) {
        const nextTopic = remaining[i].candidate.topicKey ?? primaryGoalIdOf(remaining[i]);
        // Only swap within a modest score band so high-priority items stay near the top.
        const scoreGap = remaining[0].score - remaining[i].score;
        if (nextTopic !== prevTopic && scoreGap <= 0.15) {
          chosenIdx = i;
          break;
        }
      }
    }

    result.push(remaining.splice(chosenIdx, 1)[0]);
  }

  return result;
}

function packSession(
  ranked: RankedActivityItem[],
  input: DaqeOrchestrationInput,
  orderingMode: OrderingMode,
): {
  selected: RankedActivityItem[];
  deferred: RankedActivityItem[];
  packedMinutes: number;
  budgetOverflowMinutes: number;
} {
  if (ranked.length === 0) {
    return { selected: [], deferred: [], packedMinutes: 0, budgetOverflowMinutes: 0 };
  }

  const maxItems =
    isAvailableNumber(input.maxItems) && input.maxItems > 0
      ? Math.floor(input.maxItems)
      : Number.POSITIVE_INFINITY;

  // Unlimited budget: keep all items in ranked order (up to maxItems).
  if (input.timeBudgetMinutes === "unlimited") {
    const selected = ranked.slice(0, maxItems);
    const deferred = ranked.slice(selected.length);
    const packedMinutes = selected.reduce((sum, item) => sum + item.candidate.estimatedMinutes, 0);
    return { selected, deferred, packedMinutes, budgetOverflowMinutes: 0 };
  }

  const budget = Math.max(1, Number.isFinite(input.timeBudgetMinutes) ? input.timeBudgetMinutes : 30);

  // Strict manual mode: strictly preserve manual rank order without diversity/retention overrides.
  if (orderingMode === "strict_manual") {
    const selected: RankedActivityItem[] = [];
    const deferred: RankedActivityItem[] = [];
    let packedMinutes = 0;

    for (const item of ranked) {
      const mins = item.candidate.estimatedMinutes;
      if (selected.length < maxItems && packedMinutes + mins <= budget) {
        selected.push(item);
        packedMinutes += mins;
      } else {
        deferred.push(item);
      }
    }

    let budgetOverflowMinutes = 0;
    if (selected.length === 0 && ranked.length > 0) {
      const first = ranked[0];
      selected.push(first);
      packedMinutes = first.candidate.estimatedMinutes;
      budgetOverflowMinutes = Math.max(0, packedMinutes - budget);
      deferred.splice(0, 1);
    }

    return { selected, deferred, packedMinutes, budgetOverflowMinutes };
  }

  // Adaptive packing with:
  // 1. Due retention starvation prevention (except in free_exploration and exam_prep).
  // 2. Single-goal / single-deadline monopolization cap when multiple goals compete.
  // 3. Second pass to fill unused budget if capped items still fit.
  const selectedIds = new Set<string>();
  const selected: RankedActivityItem[] = [];
  let packedMinutes = 0;

  const distinctGoals = new Set<string>();
  for (const item of ranked) {
    const gid = primaryGoalIdOf(item);
    if (gid) distinctGoals.add(gid);
  }
  const shouldCapSingleGoal =
    !input.focusedGoalId &&
    input.focusProfile !== "exam_prep" &&
    distinctGoals.size > 1;
  const maxSingleGoalShare = clamp01(input.maxSingleGoalShare ?? DEFAULT_MAX_SINGLE_GOAL_SHARE);
  const singleGoalBudgetCap = Math.max(1, budget * Math.max(0.25, maxSingleGoalShare));
  const goalMinutesUsed = new Map<string, number>();

  const tryAdd = (item: RankedActivityItem, enforceGoalCap: boolean): boolean => {
    if (selected.length >= maxItems) return false;
    if (selectedIds.has(item.candidate.id)) return false;
    const mins = item.candidate.estimatedMinutes;
    if (packedMinutes + mins > budget) return false;

    const gid = primaryGoalIdOf(item);
    if (enforceGoalCap && shouldCapSingleGoal && gid) {
      const used = goalMinutesUsed.get(gid) ?? 0;
      if (used > 0 && used + mins > singleGoalBudgetCap) {
        return false;
      }
    }

    selectedIds.add(item.candidate.id);
    selected.push(item);
    packedMinutes += mins;
    if (gid) {
      goalMinutesUsed.set(gid, (goalMinutesUsed.get(gid) ?? 0) + mins);
    }
    return true;
  };

  // Pass 0: Reserve budget share for critical due retention so deadline crunch
  // cannot silently starve long-term memory under balanced/deep_study/memory_retention.
  const shouldReserveRetention =
    input.focusProfile !== "free_exploration" && input.focusProfile !== "exam_prep";
  if (shouldReserveRetention) {
    const reserveShare = clamp01(input.retentionReserveShare ?? DEFAULT_RETENTION_RESERVE_SHARE);
    const reserveBudget = budget * reserveShare;
    let reservedMinutes = 0;
    for (const item of ranked) {
      if (selected.length >= maxItems) break;
      if (!isCriticalDueRetention(item)) continue;
      const mins = item.candidate.estimatedMinutes;
      if (reservedMinutes === 0 && mins <= budget) {
        // Guarantee at least one fitting critical retention item when available.
        if (tryAdd(item, false)) {
          reservedMinutes += mins;
        }
      } else if (reservedMinutes + mins <= reserveBudget) {
        if (tryAdd(item, false)) {
          reservedMinutes += mins;
        }
      }
    }
  }

  // Pass 1: Greedy ranked fill respecting single-goal diversity cap.
  for (const item of ranked) {
    if (selected.length >= maxItems) break;
    tryAdd(item, true);
  }

  // Pass 2: Fill any remaining slack with previously capped items so budget isn't wasted.
  if (selected.length < maxItems && packedMinutes < budget) {
    for (const item of ranked) {
      if (selected.length >= maxItems) break;
      tryAdd(item, false);
    }
  }

  // Fallback: Always include at least 1 top candidate if pool is non-empty.
  let budgetOverflowMinutes = 0;
  if (selected.length === 0 && ranked.length > 0) {
    const first = ranked[0];
    selectedIds.add(first.candidate.id);
    selected.push(first);
    packedMinutes = first.candidate.estimatedMinutes;
    budgetOverflowMinutes = Math.max(0, packedMinutes - budget);
  }

  // Restore primary ranked order, then apply lightweight interleaving unless deep_study.
  selected.sort((a, b) => a.rank - b.rank);
  const orderedSelected =
    input.focusProfile === "deep_study" ? selected : applyLightweightInterleaving(selected);

  const deferred = ranked.filter((item) => !selectedIds.has(item.candidate.id));

  return {
    selected: orderedSelected,
    deferred,
    packedMinutes,
    budgetOverflowMinutes,
  };
}

// ---------------------------------------------------------------------------
// Overload Advisor (Non-Coercive, Read-Only)
// ---------------------------------------------------------------------------

export function evaluateOverloadAdvisor(
  ranked: readonly RankedActivityItem[],
  selected: readonly RankedActivityItem[],
  deferred: readonly RankedActivityItem[],
  input: DaqeOrchestrationInput,
): OverloadAdvisorReport {
  const dailyCapacityMinutes =
    isAvailableNumber(input.rollingDailyStudyMinutes) && input.rollingDailyStudyMinutes > 0
      ? input.rollingDailyStudyMinutes
      : DEFAULT_DAILY_STUDY_MINUTES;

  const sessionCapacityMinutes =
    input.timeBudgetMinutes === "unlimited"
      ? null
      : Math.max(1, Number.isFinite(input.timeBudgetMinutes) ? input.timeBudgetMinutes : 30);

  let totalDueRetentionMinutes = 0;
  let totalUrgentDeadlineMinutes = 0;

  for (const item of ranked) {
    const c = item.candidate;
    if (isCriticalDueRetention(item)) {
      totalDueRetentionMinutes += c.estimatedMinutes;
    }
    if (isAvailableNumber(c.signals.deadlinePressure) && c.signals.deadlinePressure >= 0.65) {
      totalUrgentDeadlineMinutes += c.estimatedMinutes;
    }
  }

  const totalDemandMinutes = totalDueRetentionMinutes + totalUrgentDeadlineMinutes;
  const triggers: OverloadTriggerKind[] = [];

  const srsThreshold = isAvailableNumber(input.rollingDailyStudyMinutes)
    ? dailyCapacityMinutes * 2.0
    : Math.max(90, dailyCapacityMinutes * 2.0);
  if (totalDueRetentionMinutes > srsThreshold) {
    triggers.push("srs_backlog_overload");
  }

  const atRiskGoals = (input.goals ?? []).filter(
    (g) => g.feasibilityStatus === "at_risk" || g.feasibilityStatus === "infeasible",
  );
  if (atRiskGoals.length > 0) {
    triggers.push("deadline_crunch");
  }

  if (
    sessionCapacityMinutes !== null &&
    totalDemandMinutes > 0 &&
    sessionCapacityMinutes < totalDemandMinutes * 0.25
  ) {
    triggers.push("budget_mismatch");
  }

  // Identify lower-priority deferrable candidates (never touching due SRS items).
  const deferrableCandidates = ranked.filter((item) => {
    const c = item.candidate;
    if (c.isPinned) return false;
    if (isCriticalDueRetention(item)) return false;
    if (c.providerKind === "smart_feeds" || c.activityKind === "exploration_feed" || c.isNewMaterial) {
      return true;
    }
    return deferred.some((d) => d.candidate.id === c.id) && (c.signals.deadlinePressure ?? 0) < 0.5;
  });

  const deferrableCandidateIds = deferrableCandidates.map((item) => item.candidate.id);
  const isOverloaded = triggers.length > 0;
  const suggestions: OverloadSuggestion[] = [];

  if (isOverloaded) {
    const hasNewOrExploration = ranked.some(
      (item) =>
        item.candidate.isNewMaterial ||
        item.candidate.providerKind === "smart_feeds" ||
        item.candidate.activityKind === "exploration_feed",
    );

    if (hasNewOrExploration) {
      suggestions.push({
        kind: "pause_new_material",
        label: "Pause new material for this session",
        description:
          "Temporarily hide new and exploration items for this session only without changing FSRS settings.",
      });
    }

    if (deferrableCandidateIds.length > 0) {
      suggestions.push({
        kind: "defer_low_priority",
        label: `Defer ${deferrableCandidateIds.length} lower-priority item(s)`,
        description:
          "Skip lower-priority non-retention candidates for now without altering any review schedules.",
        deferrableCandidateIds,
      });
    }

    if (triggers.includes("srs_backlog_overload") || totalDueRetentionMinutes > 0) {
      suggestions.push({
        kind: "focus_retention_triage",
        label: "Switch to Memory Retention triage",
        description:
          "Focus this session on the most urgent due reviews within your chosen time budget.",
      });
    }

    if (atRiskGoals.length > 0) {
      const mostUrgentGoal = atRiskGoals
        .slice()
        .sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity))[0];
      suggestions.push({
        kind: "focus_single_deadline",
        label: `Focus on "${mostUrgentGoal.title}"`,
        description:
          "Narrow this session to the most urgent at-risk deadline goal while keeping all other schedules intact.",
        targetGoalId: mostUrgentGoal.goalId,
      });
    }

    suggestions.push({
      kind: "keep_as_is",
      label: "Keep session as planned",
      description: `Continue with the current ${selected.length}-item plan without changes.`,
    });
  }

  return {
    isOverloaded,
    triggers,
    totalDueRetentionMinutes,
    totalUrgentDeadlineMinutes,
    totalDemandMinutes,
    sessionCapacityMinutes,
    dailyCapacityMinutes,
    deferrableCandidateIds,
    suggestions,
    mutatedSrsState: false,
    coercive: false,
  };
}

// ---------------------------------------------------------------------------
// Main Orchestrator Entry Point
// ---------------------------------------------------------------------------

/**
 * Orchestrate a heterogeneous learning session purely and deterministically.
 *
 * Guarantees:
 * - Zero mutations to input candidates or FSRS review schedules/due dates.
 * - Identical inputs always produce byte-identical outputs.
 * - 100% offline execution with zero AI provider calls.
 * - Strict Health Vault rejection and local-only/AI-excluded privacy preservation.
 */
export function orchestrateLearningSession(
  input: DaqeOrchestrationInput,
): DaqeOrchestrationPlan {
  const orderingMode: OrderingMode = input.orderingMode ?? "adaptive";
  const effectiveWeights = resolveProfileWeights(input.focusProfile, input.customWeights);

  // 1. Enforce Health Vault boundary before any scoring or deduplication.
  const rejectedHealthVaultIds: string[] = [];
  const permittedCandidates: DaqeActivityCandidate[] = [];

  for (const candidate of input.candidates) {
    if (isHealthVaultCandidate(candidate)) {
      rejectedHealthVaultIds.push(candidate.id);
      continue;
    }
    if (input.focusedGoalId) {
      const matchesGoal = (candidate.goalReferences ?? []).some(
        (ref) => ref.goalId === input.focusedGoalId,
      );
      if (!matchesGoal) continue;
    }
    permittedCandidates.push(candidate);
  }

  // 2. Deduplicate by canonical `dedupeKey` without double-counting priority signals.
  const { merged, deduplicatedCount } = deduplicateCandidates(permittedCandidates);

  // 3. Score every canonical candidate.
  const scoredEntries = merged.map((candidate) => {
    const scored = scoreCandidate(
      candidate,
      effectiveWeights,
      input.focusProfile,
      input.timeBudgetMinutes,
      orderingMode,
    );
    return { candidate, ...scored };
  });

  // 4. Deterministic sorting.
  if (orderingMode === "strict_manual") {
    scoredEntries.sort((a, b) => {
      const aHas = isAvailableNumber(a.candidate.manualPriority);
      const bHas = isAvailableNumber(b.candidate.manualPriority);
      if (aHas && bHas && a.candidate.manualPriority !== b.candidate.manualPriority) {
        return (b.candidate.manualPriority as number) - (a.candidate.manualPriority as number);
      }
      if (aHas !== bHas) return aHas ? -1 : 1;

      const dueDiff = compareNullableIsoAsc(a.candidate.dueAt, b.candidate.dueAt);
      if (dueDiff !== 0) return dueDiff;

      const kindDiff = compareStringsAsc(a.candidate.activityKind, b.candidate.activityKind);
      if (kindDiff !== 0) return kindDiff;

      return compareStringsAsc(a.candidate.id, b.candidate.id);
    });
  } else {
    scoredEntries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dueDiff = compareNullableIsoAsc(a.candidate.dueAt, b.candidate.dueAt);
      if (dueDiff !== 0) return dueDiff;
      const kindDiff = compareStringsAsc(a.candidate.activityKind, b.candidate.activityKind);
      if (kindDiff !== 0) return kindDiff;
      return compareStringsAsc(a.candidate.id, b.candidate.id);
    });
  }

  // 5. Materialize ranked items with deterministic explanations.
  let localOnlyItemCount = 0;
  let aiExcludedItemCount = 0;

  const ranked: RankedActivityItem[] = scoredEntries.map((entry, idx) => {
    const rank = idx + 1;
    if (entry.candidate.isLocalOnly) localOnlyItemCount += 1;
    if (entry.candidate.isAiExcluded) aiExcludedItemCount += 1;

    const { primaryReason, secondaryReasons } = buildDeterministicReason(
      entry.candidate,
      entry.factors,
      orderingMode,
      rank,
    );

    const explanation: RecommendationExplanation = {
      providerKind: entry.candidate.providerKind,
      sourceProviders: entry.candidate.sourceProviders,
      focusProfile: input.focusProfile,
      orderingMode,
      primaryReason,
      secondaryReasons,
      factors: entry.factors,
      totalScore: entry.score,
      llmGenerated: false,
    };

    return {
      candidate: entry.candidate,
      rank,
      score: entry.score,
      availableFactorCount: entry.availableFactorCount,
      explanation,
      cloudAiAllowed: entry.candidate.cloudAiAllowed,
    };
  });

  // 6. Pack into session time budget.
  const { selected, deferred, packedMinutes, budgetOverflowMinutes } = packSession(
    ranked,
    input,
    orderingMode,
  );

  // 7. Run non-coercive overload advisor (strictly read-only).
  const overload = evaluateOverloadAdvisor(ranked, selected, deferred, input);

  const privacy: OrchestrationPrivacySummary = {
    rejectedHealthVaultIds,
    localOnlyItemCount,
    aiExcludedItemCount,
    planCloudAiAllowed: localOnlyItemCount === 0 && aiExcludedItemCount === 0,
    offlineCapable: true,
    aiProviderUsed: false,
  };

  return {
    focusProfile: input.focusProfile,
    orderingMode,
    effectiveWeights,
    timeBudgetMinutes: input.timeBudgetMinutes,
    packedMinutes,
    budgetOverflowMinutes,
    ranked,
    selected,
    deferred,
    deduplicatedCount,
    overload,
    privacy,
  };
}
