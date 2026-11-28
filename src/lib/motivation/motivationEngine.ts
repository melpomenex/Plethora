/**
 * Strictly optional, non-coercive Motivation Engine.
 *
 * Core design principles:
 * 1. Explicit separation of Activity Metrics (effort & consistency: minutes,
 *    pages, reviews, exercises, XP, exams taken) from Outcome Metrics
 *    (verified mastery: competencies demonstrated, concepts understood,
 *    memory retained ratio, skills demonstrated, learning gaps resolved,
 *    proficiency demonstrated).
 * 2. Deterministic, idempotent XP ledger keyed by `${sourceEventId}:${ruleId}`:
 *    replaying events NEVER duplicates XP, meaningless/zero-effort spam awards
 *    0 XP, and XP NEVER alters or inflates competency/mastery outcomes.
 * 3. Rest-day-safe streaks: configured rest days and weekly grace days bridge
 *    streaks without shaming or coercing learners.
 * 4. Independently disableable: turning off `enabled` or any individual toggle
 *    (`targetsEnabled`, `streaksEnabled`, `xpEnabled`, `milestonesEnabled`,
 *    `celebrationsEnabled`) yields clean disabled/empty projections with zero
 *    intrusive prompts.
 */

import type { LearningEvent } from "../../types/learningEvent";

export interface ActivityMetricsSummary {
  minutesStudied: number;
  pagesRead: number;
  reviewsCompleted: number;
  exercisesCompleted: number;
  xpEarned: number;
  examsTaken: number;
}

export interface OutcomeMetricsSummary {
  competenciesDemonstrated: number;
  conceptsUnderstood: number;
  /** 0..1 retained memory ratio */
  memoryRetainedRatio: number;
  skillsDemonstrated: number;
  learningGapsResolved: number;
  proficiencyDemonstrated: number;
}

export const EMPTY_ACTIVITY_METRICS: ActivityMetricsSummary = {
  minutesStudied: 0,
  pagesRead: 0,
  reviewsCompleted: 0,
  exercisesCompleted: 0,
  xpEarned: 0,
  examsTaken: 0,
};

export const EMPTY_OUTCOME_METRICS: OutcomeMetricsSummary = {
  competenciesDemonstrated: 0,
  conceptsUnderstood: 0,
  memoryRetainedRatio: 0,
  skillsDemonstrated: 0,
  learningGapsResolved: 0,
  proficiencyDemonstrated: 0,
};

export interface MotivationPreferences {
  /** Master switch — when false, all motivational projections are disabled. */
  enabled: boolean;
  targetsEnabled: boolean;
  streaksEnabled: boolean;
  /** Opt-in by default (false) to keep gamification strictly optional. */
  xpEnabled: boolean;
  milestonesEnabled: boolean;
  celebrationsEnabled: boolean;
  dailyMinutesTarget: number;
  weeklyMinutesTarget: number;
  /** Bitmask: bit 0 = Sun (1), bit 1 = Mon (2), ..., bit 6 = Sat (64). */
  restDaysMask: number;
  streakGraceDaysPerWeek: number;
}

export const DEFAULT_MOTIVATION_PREFERENCES: MotivationPreferences = {
  enabled: true,
  targetsEnabled: true,
  streaksEnabled: true,
  xpEnabled: false,
  milestonesEnabled: true,
  celebrationsEnabled: false,
  dailyMinutesTarget: 20,
  weeklyMinutesTarget: 120,
  restDaysMask: 0,
  streakGraceDaysPerWeek: 1,
};

export type XpCategory =
  | "reading"
  | "recall"
  | "practice"
  | "assessment"
  | "synthesis"
  | "consistency";

export interface XpLedgerEntry {
  id: string;
  ledgerKey: string;
  sourceEventId: string;
  ruleId: string;
  xpAmount: number;
  category: XpCategory;
  awardedAt: string;
}

export interface XpLedgerState {
  entries: XpLedgerEntry[];
  /** Lookup map of `${sourceEventId}:${ruleId}` -> XpLedgerEntry for O(1) idempotency. */
  byKey: Record<string, XpLedgerEntry>;
  totalXp: number;
}

export const EMPTY_XP_LEDGER: XpLedgerState = {
  entries: [],
  byKey: {},
  totalXp: 0,
};

export interface AwardXpInput {
  sourceEventId: string;
  ruleId: string;
  category: XpCategory;
  /** Proposed raw XP before validation/clamping. */
  baseXp: number;
  /** Duration of the activity in milliseconds (optional for atomic events). */
  durationMs?: number;
  /** Whether the learning action actually completed. Defaults to true. */
  completed?: boolean;
  /** True when the event was flagged as spam / rapid-click / zero-effort. */
  isSpam?: boolean;
  /** True when the source event was retracted/undone. */
  isRetracted?: boolean;
  /** Optional explicit effort score (<= 0 means zero-effort). */
  effortScore?: number;
  awardedAt: string;
}

export interface AwardXpResult {
  ledger: XpLedgerState;
  entry: XpLedgerEntry | null;
  awarded: boolean;
  xpDelta: number;
  reason: "awarded" | "duplicate_event" | "zero_effort_or_spam" | "invalid_input";
}

const MAX_XP_PER_EVENT = 100;
const MIN_DURATION_MS_FOR_TIMED_ACTIVITY = 3_000;

export function makeXpLedgerKey(sourceEventId: string, ruleId: string): string {
  return `${sourceEventId}:${ruleId}`;
}

/**
 * Deterministically awards XP with strict idempotency keyed by
 * `${sourceEventId}:${ruleId}`.
 *
 * - Duplicate delivery of the same `(sourceEventId, ruleId)` returns the
 *   existing ledger unchanged with `xpDelta: 0` and `awarded: false`.
 * - Zero-effort, incomplete, retracted, or spam events award `0` XP.
 * - Never touches competency or mastery metrics.
 */
export function awardXpIdempotent(
  ledger: XpLedgerState,
  input: AwardXpInput,
): AwardXpResult {
  const sourceEventId = input.sourceEventId?.trim();
  const ruleId = input.ruleId?.trim();

  if (!sourceEventId || !ruleId) {
    return {
      ledger,
      entry: null,
      awarded: false,
      xpDelta: 0,
      reason: "invalid_input",
    };
  }

  const ledgerKey = makeXpLedgerKey(sourceEventId, ruleId);
  const existing = ledger.byKey[ledgerKey];
  if (existing) {
    return {
      ledger,
      entry: existing,
      awarded: false,
      xpDelta: 0,
      reason: "duplicate_event",
    };
  }

  const isCompleted = input.completed !== false;
  const isZeroEffort =
    !isCompleted ||
    Boolean(input.isSpam) ||
    Boolean(input.isRetracted) ||
    (input.effortScore !== undefined && input.effortScore <= 0) ||
    (input.durationMs !== undefined && input.durationMs < MIN_DURATION_MS_FOR_TIMED_ACTIVITY) ||
    !Number.isFinite(input.baseXp) ||
    input.baseXp <= 0;

  if (isZeroEffort) {
    return {
      ledger,
      entry: null,
      awarded: false,
      xpDelta: 0,
      reason: "zero_effort_or_spam",
    };
  }

  const xpAmount = Math.min(MAX_XP_PER_EVENT, Math.max(0, Math.floor(input.baseXp)));
  if (xpAmount <= 0) {
    return {
      ledger,
      entry: null,
      awarded: false,
      xpDelta: 0,
      reason: "zero_effort_or_spam",
    };
  }

  const entry: XpLedgerEntry = {
    id: `xp:${ledgerKey}`,
    ledgerKey,
    sourceEventId,
    ruleId,
    xpAmount,
    category: input.category,
    awardedAt: input.awardedAt,
  };

  const nextLedger: XpLedgerState = {
    entries: [...ledger.entries, entry],
    byKey: {
      ...ledger.byKey,
      [ledgerKey]: entry,
    },
    totalXp: ledger.totalXp + xpAmount,
  };

  return {
    ledger: nextLedger,
    entry,
    awarded: true,
    xpDelta: xpAmount,
    reason: "awarded",
  };
}

export interface StreakComputationResult {
  currentStreak: number;
  longestStreak: number;
  activeDaysCount: number;
  restDaysBridged: number;
  graceDaysUsedInCurrentStreak: number;
  isActiveToday: boolean;
  isRestDayToday: boolean;
  /** Strictly neutral, supportive, non-shaming status label. */
  statusLabel: string;
}

function normalizeDateKey(isoOrDate: string): string | null {
  const trimmed = isoOrDate.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (dateOnly) {
    return dateOnly[1];
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDateKeyUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, deltaDays: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + deltaDays);
  return copy;
}

function getIsoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function isPlannedRestDay(date: Date, restDaysMask: number): boolean {
  const dow = date.getUTCDay(); // 0 = Sun .. 6 = Sat
  return (restDaysMask & (1 << dow)) !== 0;
}

/**
 * Computes a rest-day-safe streak that honors user-configured rest days
 * (`restDaysMask`: bit 0 = Sun .. bit 6 = Sat) and weekly grace days
 * (`graceDaysPerWeek`) without shaming or penalizing rest.
 */
export function computeRestDaySafeStreak(
  activeDates: readonly string[],
  restDaysMask: number,
  graceDaysPerWeek: number,
  todayIso: string,
): StreakComputationResult {
  const todayKey = normalizeDateKey(todayIso);
  if (!todayKey) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      activeDaysCount: 0,
      restDaysBridged: 0,
      graceDaysUsedInCurrentStreak: 0,
      isActiveToday: false,
      isRestDayToday: false,
      statusLabel: "Ready for a fresh start",
    };
  }

  const safeGrace = Math.max(0, Math.floor(graceDaysPerWeek));
  const normalizedActiveSet = new Set<string>();
  for (const raw of activeDates) {
    const key = normalizeDateKey(raw);
    if (key && key <= todayKey) {
      normalizedActiveSet.add(key);
    }
  }

  const todayDate = parseDateKeyUtc(todayKey);
  const isActiveToday = normalizedActiveSet.has(todayKey);
  const isRestDayToday = isPlannedRestDay(todayDate, restDaysMask);

  if (normalizedActiveSet.size === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      activeDaysCount: 0,
      restDaysBridged: 0,
      graceDaysUsedInCurrentStreak: 0,
      isActiveToday: false,
      isRestDayToday,
      statusLabel: isRestDayToday ? "Planned rest day" : "Ready for a fresh start",
    };
  }

  const sortedActiveKeys = Array.from(normalizedActiveSet).sort();
  const earliestActiveKey = sortedActiveKeys[0];

  // Backward scan from today (if today isn't active yet, don't break yesterday's streak)
  let cursor = isActiveToday ? todayDate : addDaysUtc(todayDate, -1);
  let currentStreak = 0;
  let restDaysBridged = 0;
  let graceDaysUsedInCurrentStreak = 0;
  const graceUsedByWeek = new Map<string, number>();

  // Cap scan to earliest active date so we never loop infinitely on full-week rest masks
  let pendingRestDays = 0;
  let pendingGraceDays = 0;

  while (formatDateKeyUtc(cursor) >= earliestActiveKey) {
    const key = formatDateKeyUtc(cursor);
    if (normalizedActiveSet.has(key)) {
      currentStreak += 1;
      restDaysBridged += pendingRestDays;
      graceDaysUsedInCurrentStreak += pendingGraceDays;
      pendingRestDays = 0;
      pendingGraceDays = 0;
    } else if (isPlannedRestDay(cursor, restDaysMask)) {
      pendingRestDays += 1;
    } else {
      const weekKey = getIsoWeekKey(cursor);
      const usedThisWeek = graceUsedByWeek.get(weekKey) ?? 0;
      if (usedThisWeek < safeGrace) {
        graceUsedByWeek.set(weekKey, usedThisWeek + 1);
        pendingGraceDays += 1;
      } else {
        break;
      }
    }
    cursor = addDaysUtc(cursor, -1);
  }

  // Forward scan from earliestActiveKey to todayKey for longestStreak
  let longestStreak = 0;
  let runningStreak = 0;
  const forwardGraceByWeek = new Map<string, number>();
  let fwdCursor = parseDateKeyUtc(earliestActiveKey);

  while (formatDateKeyUtc(fwdCursor) <= todayKey) {
    const key = formatDateKeyUtc(fwdCursor);
    if (normalizedActiveSet.has(key)) {
      runningStreak += 1;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else if (isPlannedRestDay(fwdCursor, restDaysMask)) {
      // Rest day bridges streak without incrementing or resetting
    } else {
      const weekKey = getIsoWeekKey(fwdCursor);
      const used = forwardGraceByWeek.get(weekKey) ?? 0;
      if (used < safeGrace) {
        forwardGraceByWeek.set(weekKey, used + 1);
      } else {
        runningStreak = 0;
      }
    }
    fwdCursor = addDaysUtc(fwdCursor, 1);
  }

  let statusLabel = "Ready for a fresh start";
  if (currentStreak > 0) {
    if (isActiveToday) {
      statusLabel = "Active streak";
    } else if (isRestDayToday) {
      statusLabel = "Planned rest day — streak preserved";
    } else if (graceDaysUsedInCurrentStreak > 0) {
      statusLabel = "Rest / grace day used — streak preserved";
    } else {
      statusLabel = "Streak active";
    }
  } else if (isRestDayToday) {
    statusLabel = "Planned rest day";
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    activeDaysCount: normalizedActiveSet.size,
    restDaysBridged,
    graceDaysUsedInCurrentStreak,
    isActiveToday,
    isRestDayToday,
    statusLabel,
  };
}

export type MilestoneCategory = "consistency" | "activity" | "mastery_outcome";

export interface MotivationMilestone {
  id: string;
  milestoneKey: string;
  category: MilestoneCategory;
  title: string;
  description: string;
  achievedAt: string;
  revokedAt: string | null;
}

export interface TargetProgressProjection {
  dailyMinutesCurrent: number;
  dailyMinutesTarget: number;
  dailyRatio: number;
  dailyCompleted: boolean;
  weeklyMinutesCurrent: number;
  weeklyMinutesTarget: number;
  weeklyRatio: number;
  weeklyCompleted: boolean;
}

export interface MotivationEvaluationResult {
  enabled: boolean;
  /** Strictly separated Activity & Effort band (null if motivation disabled). */
  activityBand: {
    metrics: ActivityMetricsSummary;
    xpEnabled: boolean;
    xpTotal: number | null;
    targets: TargetProgressProjection | null;
  } | null;
  /** Strictly separated Verified Mastery Outcomes band (never inflated by XP). */
  outcomeBand: {
    metrics: OutcomeMetricsSummary;
  } | null;
  milestones: MotivationMilestone[];
  newlyAchievedMilestones: MotivationMilestone[];
  revokedMilestoneKeys: string[];
  celebrations: string[];
}

interface MilestoneRule {
  milestoneKey: string;
  category: MilestoneCategory;
  title: string;
  description: string;
  check: (activity: ActivityMetricsSummary, outcome: OutcomeMetricsSummary) => boolean;
}

const PERSONAL_MILESTONE_RULES: readonly MilestoneRule[] = [
  // Activity / consistency milestones — driven ONLY by activity metrics
  {
    milestoneKey: "activity:first_30_minutes",
    category: "activity",
    title: "30 Minutes of Focused Study",
    description: "Logged 30 minutes of learning activity.",
    check: (activity) => activity.minutesStudied >= 30,
  },
  {
    milestoneKey: "activity:100_reviews",
    category: "activity",
    title: "100 Reviews Completed",
    description: "Completed 100 spaced-repetition reviews.",
    check: (activity) => activity.reviewsCompleted >= 100,
  },
  {
    milestoneKey: "activity:50_pages_read",
    category: "activity",
    title: "50 Pages Read",
    description: "Read 50 pages across your library.",
    check: (activity) => activity.pagesRead >= 50,
  },
  // Mastery outcome milestones — driven STRICTLY by outcome metrics (NEVER XP!)
  {
    milestoneKey: "mastery:first_concept_understood",
    category: "mastery_outcome",
    title: "First Concept Understood",
    description: "Verified understanding of your first concept.",
    check: (_activity, outcome) => outcome.conceptsUnderstood >= 1,
  },
  {
    milestoneKey: "mastery:5_competencies_demonstrated",
    category: "mastery_outcome",
    title: "5 Competencies Demonstrated",
    description: "Demonstrated verified competency across 5 concepts.",
    check: (_activity, outcome) => outcome.competenciesDemonstrated >= 5,
  },
  {
    milestoneKey: "mastery:learning_gap_resolved",
    category: "mastery_outcome",
    title: "Learning Gap Resolved",
    description: "Resolved a diagnosed comprehension gap with verified evidence.",
    check: (_activity, outcome) => outcome.learningGapsResolved >= 1,
  },
  {
    milestoneKey: "mastery:high_retention_85",
    category: "mastery_outcome",
    title: "85% Verified Memory Retention",
    description: "Achieved at least 85% retained memory across evaluated items.",
    check: (_activity, outcome) =>
      outcome.memoryRetainedRatio >= 0.85 && outcome.conceptsUnderstood >= 1,
  },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Evaluates daily/weekly targets and personal milestones while preserving strict
 * separation between Activity Metrics and Outcome Metrics.
 *
 * When `preferences.enabled === false`, returns a clean disabled projection
 * with zero milestones, zero targets, and zero celebrations.
 */
export function evaluateMilestonesAndTargets(
  preferences: MotivationPreferences,
  activitySummary: ActivityMetricsSummary,
  outcomeSummary: OutcomeMetricsSummary,
  existingMilestones: readonly MotivationMilestone[],
  options?: {
    dailyMinutesCurrent?: number;
    weeklyMinutesCurrent?: number;
    nowIso?: string;
  },
): MotivationEvaluationResult {
  if (!preferences.enabled) {
    return {
      enabled: false,
      activityBand: null,
      outcomeBand: null,
      milestones: [],
      newlyAchievedMilestones: [],
      revokedMilestoneKeys: [],
      celebrations: [],
    };
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const dailyCurrent = Math.max(0, options?.dailyMinutesCurrent ?? activitySummary.minutesStudied);
  const weeklyCurrent = Math.max(0, options?.weeklyMinutesCurrent ?? activitySummary.minutesStudied);

  const targets: TargetProgressProjection | null = preferences.targetsEnabled
    ? {
        dailyMinutesCurrent: dailyCurrent,
        dailyMinutesTarget: Math.max(1, preferences.dailyMinutesTarget),
        dailyRatio: clamp01(dailyCurrent / Math.max(1, preferences.dailyMinutesTarget)),
        dailyCompleted: dailyCurrent >= Math.max(1, preferences.dailyMinutesTarget),
        weeklyMinutesCurrent: weeklyCurrent,
        weeklyMinutesTarget: Math.max(1, preferences.weeklyMinutesTarget),
        weeklyRatio: clamp01(weeklyCurrent / Math.max(1, preferences.weeklyMinutesTarget)),
        weeklyCompleted: weeklyCurrent >= Math.max(1, preferences.weeklyMinutesTarget),
      }
    : null;

  const existingByKey = new Map<string, MotivationMilestone>();
  for (const m of existingMilestones) {
    existingByKey.set(m.milestoneKey, m);
  }

  const nextMilestones: MotivationMilestone[] = [];
  const newlyAchievedMilestones: MotivationMilestone[] = [];
  const revokedMilestoneKeys: string[] = [];

  if (preferences.milestonesEnabled) {
    const handledKeys = new Set<string>();

    for (const rule of PERSONAL_MILESTONE_RULES) {
      handledKeys.add(rule.milestoneKey);
      const isMet = rule.check(activitySummary, outcomeSummary);
      const existing = existingByKey.get(rule.milestoneKey);

      if (isMet) {
        if (existing && existing.revokedAt === null) {
          nextMilestones.push(existing);
        } else {
          const achieved: MotivationMilestone = {
            id: existing?.id ?? `ms:${rule.milestoneKey}`,
            milestoneKey: rule.milestoneKey,
            category: rule.category,
            title: rule.title,
            description: rule.description,
            achievedAt: nowIso,
            revokedAt: null,
          };
          nextMilestones.push(achieved);
          newlyAchievedMilestones.push(achieved);
        }
      } else if (existing) {
        // Mastery outcome milestones are revoked if verified outcome evidence drops;
        // historical activity milestones remain intact (effort happened).
        if (rule.category === "mastery_outcome" && existing.revokedAt === null) {
          nextMilestones.push({
            ...existing,
            revokedAt: nowIso,
          });
          revokedMilestoneKeys.push(existing.milestoneKey);
        } else {
          nextMilestones.push(existing);
        }
      }
    }

    // Preserve any custom/pre-existing milestones not covered by built-in rules
    for (const existing of existingMilestones) {
      if (!handledKeys.has(existing.milestoneKey)) {
        nextMilestones.push(existing);
      }
    }
  }

  const celebrations: string[] = [];
  if (preferences.celebrationsEnabled) {
    for (const m of newlyAchievedMilestones) {
      celebrations.push(m.title);
    }
  }

  return {
    enabled: true,
    activityBand: {
      metrics: {
        ...activitySummary,
        // Hide XP total inside activity band when xpEnabled is false
        xpEarned: preferences.xpEnabled ? activitySummary.xpEarned : 0,
      },
      xpEnabled: preferences.xpEnabled,
      xpTotal: preferences.xpEnabled ? activitySummary.xpEarned : null,
      targets,
    },
    outcomeBand: {
      // Outcome metrics are returned verbatim and NEVER modified by XP or activity
      metrics: { ...outcomeSummary },
    },
    milestones: nextMilestones,
    newlyAchievedMilestones,
    revokedMilestoneKeys,
    celebrations,
  };
}

/**
 * Maps a canonical `LearningEvent` into an `AwardXpInput` (or null if the event
 * type is non-effort / administrative / compensating).
 */
export function mapLearningEventToXpInput(event: LearningEvent): AwardXpInput | null {
  if (event.retractedByEventId !== null) {
    return null;
  }

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const durationMs =
    typeof payload.durationMs === "number" ? payload.durationMs : undefined;
  const isSpam = Boolean(payload.isSpam);
  const completed = payload.completed === undefined ? true : Boolean(payload.completed);
  const effortScore =
    typeof payload.effortScore === "number" ? payload.effortScore : undefined;

  switch (event.eventType) {
    case "review_committed":
      return {
        sourceEventId: event.id,
        ruleId: "review_committed_v1",
        category: "recall",
        baseXp: 5,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    case "reading_progressed":
    case "reading_completed":
      return {
        sourceEventId: event.id,
        ruleId: `${event.eventType}_v1`,
        category: "reading",
        baseXp: event.eventType === "reading_completed" ? 20 : 10,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    case "extract_created":
    case "card_created":
      return {
        sourceEventId: event.id,
        ruleId: `${event.eventType}_v1`,
        category: "synthesis",
        baseXp: 8,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    case "guided_check_completed":
    case "practice_attempted":
    case "remediation_completed":
      return {
        sourceEventId: event.id,
        ruleId: `${event.eventType}_v1`,
        category: "practice",
        baseXp: 15,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    case "assessment_submitted":
      return {
        sourceEventId: event.id,
        ruleId: "assessment_submitted_v1",
        category: "assessment",
        baseXp: 25,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    case "session_completed":
      return {
        sourceEventId: event.id,
        ruleId: "session_completed_v1",
        category: "consistency",
        baseXp: 20,
        durationMs,
        completed,
        isSpam,
        effortScore,
        awardedAt: event.occurredAt,
      };
    default:
      return null;
  }
}
