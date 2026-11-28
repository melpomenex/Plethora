import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MOTIVATION_PREFERENCES,
  EMPTY_ACTIVITY_METRICS,
  EMPTY_OUTCOME_METRICS,
  EMPTY_XP_LEDGER,
  awardXpIdempotent,
  computeRestDaySafeStreak,
  evaluateMilestonesAndTargets,
  type ActivityMetricsSummary,
  type MotivationPreferences,
  type OutcomeMetricsSummary,
} from "../motivationEngine";
import {
  MOTIVATION_STORAGE_KEY,
  useMotivationStore,
} from "../../../stores/motivationStore";
import {
  _resetLearningEventBusForTests,
  emitLearningEvent,
} from "../../learning-events/learningEventBus";

describe("Motivation Engine (motivationEngine)", () => {
  describe("XP idempotency and anti-spam", () => {
    it("awards XP deterministically and NEVER duplicates XP on duplicate event delivery", () => {
      const input = {
        sourceEventId: "evt-review-101",
        ruleId: "review_committed_v1",
        category: "recall" as const,
        baseXp: 10,
        durationMs: 12_000,
        completed: true,
        awardedAt: "2026-11-28T12:00:00.000Z",
      };

      const first = awardXpIdempotent(EMPTY_XP_LEDGER, input);
      expect(first.awarded).toBe(true);
      expect(first.xpDelta).toBe(10);
      expect(first.ledger.totalXp).toBe(10);
      expect(first.ledger.entries).toHaveLength(1);
      expect(first.entry?.ledgerKey).toBe("evt-review-101:review_committed_v1");

      // Re-delivering the exact same event + rule MUST NOT duplicate XP
      const duplicate = awardXpIdempotent(first.ledger, input);
      expect(duplicate.awarded).toBe(false);
      expect(duplicate.xpDelta).toBe(0);
      expect(duplicate.reason).toBe("duplicate_event");
      expect(duplicate.ledger.totalXp).toBe(10);
      expect(duplicate.ledger.entries).toHaveLength(1);
    });

    it("awards 0 XP for meaningless spam, zero-effort, incomplete, or retracted events", () => {
      const spam = awardXpIdempotent(EMPTY_XP_LEDGER, {
        sourceEventId: "evt-spam",
        ruleId: "review_committed_v1",
        category: "recall",
        baseXp: 10,
        isSpam: true,
        awardedAt: "2026-11-28T12:00:00.000Z",
      });
      expect(spam.awarded).toBe(false);
      expect(spam.xpDelta).toBe(0);
      expect(spam.ledger.totalXp).toBe(0);

      const tooShort = awardXpIdempotent(EMPTY_XP_LEDGER, {
        sourceEventId: "evt-rapid-click",
        ruleId: "reading_progressed_v1",
        category: "reading",
        baseXp: 10,
        durationMs: 500, // below meaningful threshold
        awardedAt: "2026-11-28T12:00:00.000Z",
      });
      expect(tooShort.awarded).toBe(false);
      expect(tooShort.xpDelta).toBe(0);

      const incomplete = awardXpIdempotent(EMPTY_XP_LEDGER, {
        sourceEventId: "evt-incomplete",
        ruleId: "practice_attempted_v1",
        category: "practice",
        baseXp: 15,
        completed: false,
        awardedAt: "2026-11-28T12:00:00.000Z",
      });
      expect(incomplete.awarded).toBe(false);
      expect(incomplete.xpDelta).toBe(0);

      const retracted = awardXpIdempotent(EMPTY_XP_LEDGER, {
        sourceEventId: "evt-retracted",
        ruleId: "review_committed_v1",
        category: "recall",
        baseXp: 10,
        isRetracted: true,
        awardedAt: "2026-11-28T12:00:00.000Z",
      });
      expect(retracted.awarded).toBe(false);
      expect(retracted.xpDelta).toBe(0);
    });
  });

  describe("Rest-day-safe streak calculation", () => {
    it("preserves streaks across configured rest days without incrementing or breaking", () => {
      // 2026-11-28 is Saturday (bit 6 = 64), 2026-11-29 is Sunday (bit 0 = 1)
      // Weekend rest mask: Sun (1) | Sat (64) = 65
      const weekendRestMask = (1 << 0) | (1 << 6);

      // Active Thu Nov 26, Fri Nov 27, skipped Sat Nov 28 & Sun Nov 29 (rest days), active Mon Nov 30
      const activeDates = ["2026-11-26", "2026-11-27", "2026-11-30"];
      const streak = computeRestDaySafeStreak(
        activeDates,
        weekendRestMask,
        0, // zero grace days — purely rest days bridging!
        "2026-11-30",
      );

      expect(streak.currentStreak).toBe(3);
      expect(streak.longestStreak).toBe(3);
      expect(streak.restDaysBridged).toBe(2);
      expect(streak.graceDaysUsedInCurrentStreak).toBe(0);
    });

    it("bridges unplanned missed days within weekly grace budget and resets neutrally when exceeded", () => {
      // Active Mon Nov 23, Tue Nov 24, missed Wed Nov 25 (1 grace day), active Thu Nov 26
      const preserved = computeRestDaySafeStreak(
        ["2026-11-23", "2026-11-24", "2026-11-26"],
        0,
        1,
        "2026-11-26",
      );
      expect(preserved.currentStreak).toBe(3);
      expect(preserved.graceDaysUsedInCurrentStreak).toBe(1);

      // Missing TWO unplanned days in the same week with grace=1 resets cleanly without shaming
      const reset = computeRestDaySafeStreak(
        ["2026-11-23", "2026-11-26"],
        0,
        1,
        "2026-11-26",
      );
      expect(reset.currentStreak).toBe(1);
      expect(reset.statusLabel).not.toMatch(/fail|shame|lost|broke|penalty/i);
    });
  });

  describe("Activity vs Outcome separation & zero mastery inflation", () => {
    it("separates Activity Metrics from Outcome Metrics and prevents XP from inflating mastery", () => {
      const highXpZeroMasteryActivity: ActivityMetricsSummary = {
        minutesStudied: 300,
        pagesRead: 120,
        reviewsCompleted: 500,
        exercisesCompleted: 80,
        xpEarned: 9_999,
        examsTaken: 3,
      };
      const zeroOutcomes: OutcomeMetricsSummary = { ...EMPTY_OUTCOME_METRICS };

      const prefs: MotivationPreferences = {
        ...DEFAULT_MOTIVATION_PREFERENCES,
        enabled: true,
        xpEnabled: true,
        milestonesEnabled: true,
      };

      const result = evaluateMilestonesAndTargets(
        prefs,
        highXpZeroMasteryActivity,
        zeroOutcomes,
        [],
        { nowIso: "2026-11-28T14:00:00.000Z" },
      );

      expect(result.enabled).toBe(true);
      expect(result.activityBand?.xpTotal).toBe(9_999);
      expect(result.outcomeBand?.metrics).toEqual(EMPTY_OUTCOME_METRICS);

      // Activity milestones unlock, but ZERO mastery_outcome milestones unlock from XP alone
      const activityMilestones = result.milestones.filter((m) => m.category === "activity");
      const masteryMilestones = result.milestones.filter(
        (m) => m.category === "mastery_outcome",
      );
      expect(activityMilestones.length).toBeGreaterThan(0);
      expect(masteryMilestones).toHaveLength(0);
    });

    it("unlocks mastery_outcome milestones only from verified outcomes and revokes them if outcomes drop", () => {
      const prefs: MotivationPreferences = {
        ...DEFAULT_MOTIVATION_PREFERENCES,
        enabled: true,
        milestonesEnabled: true,
      };
      const verifiedOutcomes: OutcomeMetricsSummary = {
        competenciesDemonstrated: 5,
        conceptsUnderstood: 3,
        memoryRetainedRatio: 0.9,
        skillsDemonstrated: 2,
        learningGapsResolved: 1,
        proficiencyDemonstrated: 1,
      };

      const achieved = evaluateMilestonesAndTargets(
        prefs,
        EMPTY_ACTIVITY_METRICS,
        verifiedOutcomes,
        [],
        { nowIso: "2026-11-28T14:00:00.000Z" },
      );
      const activeMastery = achieved.milestones.filter(
        (m) => m.category === "mastery_outcome" && m.revokedAt === null,
      );
      expect(activeMastery.length).toBe(4);

      // If evidence is invalidated and outcomes drop, mastery milestones are revoked
      const afterInvalidation = evaluateMilestonesAndTargets(
        prefs,
        EMPTY_ACTIVITY_METRICS,
        EMPTY_OUTCOME_METRICS,
        achieved.milestones,
        { nowIso: "2026-11-29T10:00:00.000Z" },
      );
      expect(afterInvalidation.revokedMilestoneKeys.length).toBe(4);
      expect(
        afterInvalidation.milestones.every(
          (m) => m.category !== "mastery_outcome" || m.revokedAt !== null,
        ),
      ).toBe(true);
    });
  });

  describe("Independent disableability", () => {
    it("returns clean disabled/empty projections when master enabled is false", () => {
      const disabledPrefs: MotivationPreferences = {
        ...DEFAULT_MOTIVATION_PREFERENCES,
        enabled: false,
        xpEnabled: true,
        milestonesEnabled: true,
        celebrationsEnabled: true,
      };

      const result = evaluateMilestonesAndTargets(
        disabledPrefs,
        {
          minutesStudied: 60,
          pagesRead: 60,
          reviewsCompleted: 150,
          exercisesCompleted: 10,
          xpEarned: 500,
          examsTaken: 1,
        },
        {
          competenciesDemonstrated: 5,
          conceptsUnderstood: 5,
          memoryRetainedRatio: 0.92,
          skillsDemonstrated: 3,
          learningGapsResolved: 2,
          proficiencyDemonstrated: 2,
        },
        [],
      );

      expect(result.enabled).toBe(false);
      expect(result.activityBand).toBeNull();
      expect(result.outcomeBand).toBeNull();
      expect(result.milestones).toEqual([]);
      expect(result.celebrations).toEqual([]);
    });

    it("honors individual toggles independently (xpEnabled, targetsEnabled, milestonesEnabled)", () => {
      const prefs: MotivationPreferences = {
        ...DEFAULT_MOTIVATION_PREFERENCES,
        enabled: true,
        xpEnabled: false,
        targetsEnabled: false,
        milestonesEnabled: false,
        celebrationsEnabled: false,
      };

      const result = evaluateMilestonesAndTargets(
        prefs,
        {
          minutesStudied: 60,
          pagesRead: 60,
          reviewsCompleted: 150,
          exercisesCompleted: 10,
          xpEarned: 500,
          examsTaken: 1,
        },
        EMPTY_OUTCOME_METRICS,
        [],
      );

      expect(result.enabled).toBe(true);
      expect(result.activityBand?.xpEnabled).toBe(false);
      expect(result.activityBand?.xpTotal).toBeNull();
      expect(result.activityBand?.targets).toBeNull();
      expect(result.milestones).toEqual([]);
      expect(result.celebrations).toEqual([]);
    });
  });
});

describe("motivationStore & learningEventBus integration", () => {
  beforeEach(() => {
    _resetLearningEventBusForTests();
    useMotivationStore.getState().reset();
  });

  it("subscribes to learningEventBus, awards XP idempotently, and acts as no-op when disabled", () => {
    expect(MOTIVATION_STORAGE_KEY).toBe("plethora.motivation.v1");

    // XP is opt-in (false) by default
    expect(useMotivationStore.getState().preferences.xpEnabled).toBe(false);
    useMotivationStore.getState().setXpEnabled(true);
    const unsub = useMotivationStore.getState().connectLearningEventBus();

    const emitted = emitLearningEvent({
      idempotencyKey: "motivation-test-review-1",
      eventType: "review_committed",
      surface: "review",
      entityKind: "learning_item",
      entityId: "card-99",
      occurredAt: "2026-11-28T13:00:00.000Z",
      payload: { durationMs: 15_000 },
    });

    expect(useMotivationStore.getState().xpLedger.totalXp).toBe(5);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(1);
    expect(useMotivationStore.getState().activeDates).toContain("2026-11-28");

    // Re-delivering the exact same event object directly to recordLearningActivityForMotivation
    // must NOT duplicate XP or review counts
    useMotivationStore.getState().recordLearningActivityForMotivation(emitted.event);
    expect(useMotivationStore.getState().xpLedger.totalXp).toBe(5);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(1);

    // Disabling motivation globally makes further events a complete no-op and hides streaks
    useMotivationStore.getState().setEnabled(false);
    expect(useMotivationStore.getState().getStreak("2026-11-28")).toBeNull();

    emitLearningEvent({
      idempotencyKey: "motivation-test-review-2",
      eventType: "review_committed",
      surface: "review",
      entityKind: "learning_item",
      entityId: "card-100",
      occurredAt: "2026-11-29T13:00:00.000Z",
      payload: { durationMs: 15_000 },
    });
    expect(useMotivationStore.getState().xpLedger.totalXp).toBe(5);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(1);

    unsub();
  });
});
