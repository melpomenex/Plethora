import { describe, expect, it } from "vitest";
import {
  assertValidGoalSourceLink,
  evaluateGoalFeasibility,
  getDefaultGoalPolicy,
  validateGoalSourceLink,
  type EvaluateGoalFeasibilityInput,
} from "../feasibility";
import type { LearningGoal } from "../../../types/learningGoal";

const NOW_ISO = "2026-11-01T00:00:00.000Z";

function makeGoal(
  overrides: Partial<
    Pick<
      LearningGoal,
      | "id"
      | "kind"
      | "targetDate"
      | "dailyMinutesBudget"
      | "targetDimensions"
      | "targetMasteryThreshold"
    >
  > = {}
) {
  return {
    id: "goal-1",
    kind: "deadline" as const,
    targetDate: "2026-11-11T00:00:00.000Z", // 10 days after NOW_ISO
    dailyMinutesBudget: 30,
    targetDimensions: ["comprehension", "retention"] as LearningGoal["targetDimensions"],
    targetMasteryThreshold: 0.8,
    ...overrides,
  };
}

describe("getDefaultGoalPolicy", () => {
  it("keeps casual exploration goals lightweight with no deadline or study plan", () => {
    const policy = getDefaultGoalPolicy("exploration");
    expect(policy.expectsDeadline).toBe(false);
    expect(policy.expectsStudyPlan).toBe(false);
    expect(policy.defaultDailyMinutesBudget).toBeNull();
    expect(policy.allowZeroDeadline).toBe(true);
  });

  it("configures deadline and continuous goal policies appropriately", () => {
    const deadlinePolicy = getDefaultGoalPolicy("deadline");
    expect(deadlinePolicy.expectsDeadline).toBe(true);
    expect(deadlinePolicy.expectsStudyPlan).toBe(true);
    expect(deadlinePolicy.allowZeroDeadline).toBe(false);

    const continuousPolicy = getDefaultGoalPolicy("continuous");
    expect(continuousPolicy.smartFeedsPrimary).toBe(true);
    expect(continuousPolicy.expectsDeadline).toBe(false);
  });
});

describe("validateGoalSourceLink (Smart Feed boundary)", () => {
  it("allows smart_feed ONLY with exploration_candidate role", () => {
    expect(validateGoalSourceLink("smart_feed", "exploration_candidate")).toEqual({
      valid: true,
    });

    const primaryResult = validateGoalSourceLink("smart_feed", "primary");
    expect(primaryResult.valid).toBe(false);
    expect(primaryResult.reason).toContain("exploration_candidate");

    const suppResult = validateGoalSourceLink("smart_feed", "supplemental");
    expect(suppResult.valid).toBe(false);

    expect(() => assertValidGoalSourceLink("smart_feed", "primary")).toThrow(
      /exploration_candidate/
    );
  });

  it("allows primary and supplemental roles on non-smart-feed sources", () => {
    expect(validateGoalSourceLink("document", "primary").valid).toBe(true);
    expect(validateGoalSourceLink("concept", "supplemental").valid).toBe(true);
    expect(validateGoalSourceLink("saved_queue", "primary").valid).toBe(true);
  });
});

describe("evaluateGoalFeasibility", () => {
  it("classifies an exploration goal without a targetDate as unbounded", () => {
    const report = evaluateGoalFeasibility({
      goal: makeGoal({
        id: "goal-explore",
        kind: "exploration",
        targetDate: null,
        dailyMinutesBudget: null,
      }),
      uncompletedReadingMinutes: 90,
      nowIso: NOW_ISO,
    });

    expect(report.status).toBe("unbounded");
    expect(report.daysRemaining).toBeNull();
    expect(report.availableMinutes).toBeNull();
    expect(report.requiredDailyMinutes).toBeNull();
    expect(report.utilizationRatio).toBeNull();
    expect(report.remainingMinutes).toBe(90);
    expect(report.recommendations).toEqual([]);
  });

  it("returns insufficient_data honestly when deadline is set but no workload or concepts exist", () => {
    const report = evaluateGoalFeasibility({
      goal: makeGoal({
        id: "goal-empty-deadline",
        targetDate: "2026-11-11T00:00:00.000Z",
      }),
      conceptStates: [],
      uncompletedReadingMinutes: 0,
      projectedDueReviewMinutes: 0,
      nowIso: NOW_ISO,
    });

    expect(report.status).toBe("insufficient_data");
    expect(report.requiredDailyMinutes).toBeNull();
    expect(report.utilizationRatio).toBeNull();
    expect(report.daysRemaining).toBe(10);
    expect(report.availableMinutes).toBe(300);
    expect(report.uncertaintyReasons.length).toBeGreaterThan(0);
    expect(report.recommendations).toEqual([]);
  });

  it("reuses prior demonstrated competency (0 remaining effort) and credits developing concepts", () => {
    const report = evaluateGoalFeasibility({
      goal: makeGoal({
        targetDate: "2026-11-11T00:00:00.000Z", // 10 days * 30 min = 300 min
        targetDimensions: ["comprehension", "retention"],
        targetMasteryThreshold: 0.8,
      }),
      conceptStates: [
        {
          conceptId: "c-mastered",
          estimatedMinutesToMaster: 120,
          dimensions: {
            comprehension: {
              dimension: "comprehension",
              status: "demonstrated",
              estimate: 0.9,
            },
            retention: {
              dimension: "retention",
              status: "demonstrated",
              estimate: 0.85,
            },
          },
        },
        {
          conceptId: "c-developing",
          estimatedMinutesToMaster: 100,
          dimensions: {
            // 1 - (0.4 / 0.8) = 0.50
            comprehension: {
              dimension: "comprehension",
              status: "developing",
              estimate: 0.4,
            },
            // 1 - (0.76 / 0.8) = 0.05 -> floored to 0.15
            retention: {
              dimension: "retention",
              status: "developing",
              estimate: 0.76,
            },
          },
        },
        {
          conceptId: "c-unknown",
          estimatedMinutesToMaster: 60,
          dimensions: {
            comprehension: {
              dimension: "comprehension",
              status: "unknown",
              estimate: null,
            },
            retention: {
              dimension: "retention",
              status: "needs_attention",
              estimate: 0.2,
            },
          },
        },
      ],
      nowIso: NOW_ISO,
    });

    // c-mastered: 0
    // c-developing: 100 * mean(0.50, 0.15) = 32.5
    // c-unknown: 60 * mean(1.0, 1.0) = 60
    // total remaining = round(92.5) = 93
    expect(report.priorMasteredConceptCount).toBe(1);
    expect(report.totalConceptCount).toBe(3);
    expect(report.remainingConceptMinutes).toBe(93);
    expect(report.remainingMinutes).toBe(93);
    expect(report.status).toBe("on_track");
    expect(report.progressRatio).toBeCloseTo(1 - 92.5 / 280, 4);
  });

  it("classifies on_track, tight, at_risk, and infeasible across exact utilization thresholds", () => {
    // 10 days * 30 min = 300 available minutes
    const base = {
      goal: makeGoal({
        targetDate: "2026-11-11T00:00:00.000Z",
        dailyMinutesBudget: 30,
      }),
      nowIso: NOW_ISO,
    };

    // 240 / 300 = 0.80 -> on_track
    const onTrack = evaluateGoalFeasibility({
      ...base,
      uncompletedReadingMinutes: 240,
    });
    expect(onTrack.status).toBe("on_track");
    expect(onTrack.utilizationRatio).toBeCloseTo(0.8, 5);
    expect(onTrack.recommendations).toEqual([]);

    // 300 / 300 = 1.00 -> tight
    const tight = evaluateGoalFeasibility({
      ...base,
      uncompletedReadingMinutes: 300,
    });
    expect(tight.status).toBe("tight");
    expect(tight.utilizationRatio).toBeCloseTo(1.0, 5);
    expect(tight.recommendations).toEqual([]);

    // 390 / 300 = 1.30 -> at_risk
    const atRisk = evaluateGoalFeasibility({
      ...base,
      uncompletedReadingMinutes: 390,
    });
    expect(atRisk.status).toBe("at_risk");
    expect(atRisk.utilizationRatio).toBeCloseTo(1.3, 5);
    expect(atRisk.recommendations.map((r) => r.kind)).toContain(
      "increase_daily_budget"
    );
    expect(atRisk.recommendations.map((r) => r.kind)).toContain("extend_deadline");

    // 600 / 150 = 4.00 (5 days, 30 min/day) -> infeasible (spec scenario)
    const infeasible = evaluateGoalFeasibility({
      goal: makeGoal({
        id: "goal-3",
        targetDate: "2026-11-06T00:00:00.000Z",
        dailyMinutesBudget: 30,
      }),
      uncompletedReadingMinutes: 400,
      projectedDueReviewMinutes: 200,
      nowIso: NOW_ISO,
    });
    expect(infeasible.status).toBe("infeasible");
    expect(infeasible.daysRemaining).toBe(5);
    expect(infeasible.availableMinutes).toBe(150);
    expect(infeasible.requiredDailyMinutes).toBe(120);
  });

  it("classifies past-due deadline with remaining work as infeasible", () => {
    const report = evaluateGoalFeasibility({
      goal: makeGoal({
        targetDate: "2026-10-30T00:00:00.000Z", // before NOW_ISO
        dailyMinutesBudget: 30,
      }),
      uncompletedReadingMinutes: 60,
      nowIso: NOW_ISO,
    });

    expect(report.status).toBe("infeasible");
    expect(report.daysRemaining).toBe(0);
    expect(report.utilizationRatio).toBe(Number.POSITIVE_INFINITY);
  });

  it("emits non-mutating adjustment suggestions including narrow_scope and focus_weakest_dimensions", () => {
    const input: EvaluateGoalFeasibilityInput = {
      goal: makeGoal({
        id: "goal-heavy",
        targetDate: "2026-11-06T00:00:00.000Z", // 5 days * 30 min = 150 min
        dailyMinutesBudget: 30,
        targetDimensions: ["comprehension", "retention", "application"],
      }),
      conceptStates: [
        {
          conceptId: "c-core",
          estimatedMinutesToMaster: 300,
          priority: 90,
          dimensions: {
            comprehension: {
              dimension: "comprehension",
              status: "demonstrated",
              estimate: 0.9,
            },
            retention: {
              dimension: "retention",
              status: "unknown",
              estimate: null,
            },
            application: {
              dimension: "application",
              status: "unknown",
              estimate: null,
            },
          },
        },
        {
          conceptId: "c-optional",
          estimatedMinutesToMaster: 240,
          priority: 20,
          dimensions: {
            comprehension: {
              dimension: "comprehension",
              status: "developing",
              estimate: 0.5,
            },
            retention: {
              dimension: "retention",
              status: "unknown",
              estimate: null,
            },
            application: {
              dimension: "application",
              status: "insufficient_evidence",
              estimate: null,
            },
          },
        },
      ],
      sources: [
        { sourceId: "doc-1", sourceKind: "document", sourceRole: "primary", weight: 1 },
        {
          sourceId: "doc-bonus",
          sourceKind: "document",
          sourceRole: "supplemental",
          weight: 0.5,
        },
      ],
      nowIso: NOW_ISO,
    };

    const snapshotBefore = JSON.stringify(input);
    const report = evaluateGoalFeasibility(input);
    const snapshotAfter = JSON.stringify(input);

    // Strictly non-mutating
    expect(snapshotAfter).toBe(snapshotBefore);
    expect(report.status).toBe("infeasible");

    const kinds = report.recommendations.map((r) => r.kind);
    expect(kinds).toContain("increase_daily_budget");
    expect(kinds).toContain("extend_deadline");
    expect(kinds).toContain("narrow_scope");
    expect(kinds).toContain("focus_weakest_dimensions");

    const narrow = report.recommendations.find((r) => r.kind === "narrow_scope")!;
    expect(narrow.deferrableSourceIds).toEqual(["doc-bonus"]);
    expect(narrow.deferrableConceptIds).toEqual(["c-optional"]);

    const focus = report.recommendations.find(
      (r) => r.kind === "focus_weakest_dimensions"
    )!;
    expect(focus.focusDimensions).toEqual(["retention", "application"]);

    const budget = report.recommendations.find(
      (r) => r.kind === "increase_daily_budget"
    )!;
    expect(budget.suggestedDailyMinutesBudget).toBeLessThanOrEqual(180);
  });
});
