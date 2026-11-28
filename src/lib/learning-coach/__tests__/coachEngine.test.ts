import { beforeEach, describe, expect, it } from "vitest";
import {
  COACHING_SIGNAL_TYPES,
  DEFAULT_COACH_PREFERENCES,
  containsHealthVaultFields,
  detectCoachingOpportunities,
  type CoachDismissal,
  type CoachPreferences,
  type CoachSnapshot,
} from "../coachEngine";
import {
  LEARNING_COACH_STORAGE_KEY,
  useLearningCoachStore,
} from "../../../stores/learningCoachStore";

const NOW_ISO = "2026-11-28T14:00:00.000Z";

function buildAllTwelveSignalsSnapshot(): CoachSnapshot {
  return {
    examIsolationActive: false,
    approachingExams: [
      {
        examId: "exam-1",
        title: "Distributed Systems Midterm",
        examDateIso: "2026-12-01T14:00:00.000Z", // 3 days away -> urgent
        readinessScore: 0.52,
        weakConceptIds: ["concept-raft", "concept-paxos"],
      },
    ],
    goals: [
      {
        goalId: "goal-deadline",
        title: "Finish Compiler Book",
        targetDateIso: "2026-12-05",
        remainingEffortMinutes: 600,
        availableMinutesAtPace: 300, // 2.0x > 1.25x
        daysSinceLastActivity: 1,
      },
      {
        goalId: "goal-stalled",
        title: "Linear Algebra Mastery",
        daysSinceLastActivity: 10,
      },
    ],
    failedCardClusters: [
      {
        clusterId: "cluster-1",
        conceptId: "concept-eigenvectors",
        conceptName: "Eigenvectors",
        failedCardIds: ["card-1", "card-2", "card-3"],
        maxLapses: 6,
        totalRecentFailures: 11,
      },
    ],
    misunderstoodConcepts: [
      {
        conceptId: "concept-bayes",
        conceptName: "Bayes Theorem",
        comprehensionScore: 0.3,
        unresolvedGap: true,
        isCorePrerequisite: true,
      },
    ],
    reviewBacklog: {
      overdueCount: 120,
      rollingDailyThroughput: 30,
    },
    crossDocumentConnections: [
      {
        connectionId: "conn-1",
        conceptId: "concept-entropy",
        conceptName: "Information Entropy",
        documentIds: ["doc-shannon", "doc-ml"],
      },
    ],
    demonstratedPrerequisites: [
      {
        nodeId: "node-calc-1",
        conceptId: "concept-derivatives",
        conceptName: "Derivatives",
        studyPlanId: "plan-ml",
        masteryScore: 0.92,
      },
    ],
    formulationOpportunities: [
      {
        documentId: "doc-systems",
        documentTitle: "DDIA Chapter 5",
        readingMinutesLast7Days: 95,
        unformulatedExtractCount: 6,
        existingCardCount: 0,
      },
    ],
    relevantSmartFeeds: [
      {
        feedItemId: "feed-42",
        title: "Practical Raft Consensus Walkthrough",
        matchedGoalId: "goal-deadline",
        relevanceScore: 0.88,
      },
    ],
    scheduleMetrics: {
      consecutiveAbandonedSessions: 4,
      averageSessionDurationMinutes: 45,
      recommendedTimeboxMinutes: 15,
    },
    transferOpportunities: [
      {
        conceptId: "concept-sql-joins",
        conceptName: "SQL Window Functions",
        retentionScore: 0.86,
        transferScore: 0.3,
      },
    ],
  };
}

describe("Personal Learning Coach Engine (coachEngine)", () => {
  it("detects all 12 canonical coaching opportunity signal types deterministically", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();
    const prefs: CoachPreferences = {
      ...DEFAULT_COACH_PREFERENCES,
      proactivity: "on_demand",
    };

    const run1 = detectCoachingOpportunities(snapshot, prefs, [], NOW_ISO);
    const run2 = detectCoachingOpportunities(snapshot, prefs, [], NOW_ISO);

    // 100% deterministic across repeated runs
    expect(run1).toEqual(run2);

    const detectedTypes = new Set(run1.map((r) => r.signalType));
    for (const signalType of COACHING_SIGNAL_TYPES) {
      expect(detectedTypes.has(signalType)).toBe(true);
    }
    expect(detectedTypes.size).toBe(12);
  });

  it("returns empty immediately when proactivity is disabled", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();
    const prefs: CoachPreferences = {
      ...DEFAULT_COACH_PREFERENCES,
      proactivity: "disabled",
    };

    const results = detectCoachingOpportunities(snapshot, prefs, [], NOW_ISO);
    expect(results).toEqual([]);
  });

  it("suppresses all coaching when examIsolationActive is true", () => {
    const snapshot: CoachSnapshot = {
      ...buildAllTwelveSignalsSnapshot(),
      examIsolationActive: true,
    };
    const prefs: CoachPreferences = {
      ...DEFAULT_COACH_PREFERENCES,
      proactivity: "proactive",
    };

    const results = detectCoachingOpportunities(snapshot, prefs, [], NOW_ISO);
    expect(results).toEqual([]);
  });

  it("caps recommendations per proactivity level (minimal: 1, balanced: 3, proactive: 6)", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();

    const minimal = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "minimal" },
      [],
      NOW_ISO,
    );
    const balanced = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "balanced" },
      [],
      NOW_ISO,
    );
    const proactive = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "proactive" },
      [],
      NOW_ISO,
    );

    expect(minimal).toHaveLength(1);
    expect(balanced).toHaveLength(3);
    expect(proactive).toHaveLength(6);

    // Highest ranked recommendation is identical across levels
    expect(minimal[0].id).toBe(balanced[0].id);
    expect(balanced[0].id).toBe(proactive[0].id);
  });

  it("respects quiet hours for automatic proactivity levels while allowing on_demand", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();
    const quietNow = "2026-11-28T23:30:00.000Z";
    const quietHours = { enabled: true, start: "22:00", end: "07:00" };

    const balancedQuiet = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "balanced", quietHours },
      [],
      quietNow,
    );
    expect(balancedQuiet).toEqual([]);

    const onDemandQuiet = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "on_demand", quietHours },
      [],
      quietNow,
    );
    expect(onDemandQuiet.length).toBe(12);
  });

  it("filters dismissed/snoozed categories and snoozed signal IDs until snoozeUntil passes", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();
    const prefs: CoachPreferences = {
      ...DEFAULT_COACH_PREFERENCES,
      proactivity: "on_demand",
    };

    const dismissals: CoachDismissal[] = [
      {
        signalType: "review_backlog",
        dismissedAt: "2026-11-28T10:00:00.000Z",
        snoozeUntil: "2026-11-29T10:00:00.000Z",
      },
      {
        signalId: "coach:approaching_exam:exam-1",
        dismissedAt: "2026-11-28T10:00:00.000Z",
        snoozeUntil: "2026-11-28T18:00:00.000Z",
      },
      {
        signalType: "stalled_goal",
        dismissedAt: "2026-11-28T10:00:00.000Z",
        snoozeUntil: null, // permanent
      },
    ];

    // Before snooze expires
    const beforeExpiry = detectCoachingOpportunities(
      snapshot,
      prefs,
      dismissals,
      "2026-11-28T14:00:00.000Z",
    );
    expect(beforeExpiry.some((r) => r.signalType === "review_backlog")).toBe(false);
    expect(beforeExpiry.some((r) => r.id === "coach:approaching_exam:exam-1")).toBe(false);
    expect(beforeExpiry.some((r) => r.signalType === "stalled_goal")).toBe(false);

    // After exam snooze expires (2026-11-28T19:00), review_backlog still snoozed, stalled_goal permanent
    const afterExamSnooze = detectCoachingOpportunities(
      snapshot,
      prefs,
      dismissals,
      "2026-11-28T19:00:00.000Z",
    );
    expect(afterExamSnooze.some((r) => r.id === "coach:approaching_exam:exam-1")).toBe(true);
    expect(afterExamSnooze.some((r) => r.signalType === "review_backlog")).toBe(false);
    expect(afterExamSnooze.some((r) => r.signalType === "stalled_goal")).toBe(false);

    // After review_backlog snooze expires too
    const afterAllSnoozes = detectCoachingOpportunities(
      snapshot,
      prefs,
      dismissals,
      "2026-11-29T12:00:00.000Z",
    );
    expect(afterAllSnoozes.some((r) => r.signalType === "review_backlog")).toBe(true);
    expect(afterAllSnoozes.some((r) => r.signalType === "stalled_goal")).toBe(false);
  });

  it("sets cloudExplanationAllowed to false for isLocalOnly and isAiExcluded sources", () => {
    const snapshot: CoachSnapshot = {
      formulationOpportunities: [
        {
          documentId: "doc-local",
          documentTitle: "Private Journal",
          readingMinutesLast7Days: 90,
          unformulatedExtractCount: 4,
          existingCardCount: 0,
          isLocalOnly: true,
        },
        {
          documentId: "doc-no-ai",
          documentTitle: "Confidential Spec",
          readingMinutesLast7Days: 90,
          unformulatedExtractCount: 4,
          existingCardCount: 0,
          isAiExcluded: true,
        },
        {
          documentId: "doc-public",
          documentTitle: "Public Textbook",
          readingMinutesLast7Days: 90,
          unformulatedExtractCount: 4,
          existingCardCount: 0,
        },
      ],
      sourcePrivacyById: {
        "concept-secret": { isLocalOnly: true },
      },
      misunderstoodConcepts: [
        {
          conceptId: "concept-secret",
          conceptName: "Proprietary Algorithm",
          comprehensionScore: 0.25,
          unresolvedGap: true,
        },
      ],
    };

    const recs = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "on_demand" },
      [],
      NOW_ISO,
    );

    const localRec = recs.find((r) => r.dedupeKey === "doc-local");
    const aiExcludedRec = recs.find((r) => r.dedupeKey === "doc-no-ai");
    const publicRec = recs.find((r) => r.dedupeKey === "doc-public");
    const mappedLocalRec = recs.find((r) => r.dedupeKey === "concept-secret");

    expect(localRec?.cloudExplanationAllowed).toBe(false);
    expect(localRec?.privacyReason).toBe("local_only_source");
    expect(aiExcludedRec?.cloudExplanationAllowed).toBe(false);
    expect(aiExcludedRec?.privacyReason).toBe("ai_excluded_source");
    expect(publicRec?.cloudExplanationAllowed).toBe(true);
    expect(publicRec?.privacyReason).toBe("allowed");
    expect(mappedLocalRec?.cloudExplanationAllowed).toBe(false);
  });

  it("never leaks Health Vault metrics into recommendations", () => {
    // Even if an untyped caller sneaks Health Vault fields onto the snapshot
    const taintedSnapshot = {
      ...buildAllTwelveSignalsSnapshot(),
      healthMetrics: { heartRate: 72, sleepDuration: 410, hrv: 58 },
      biometrics: { bloodGlucose: 95 },
    } as unknown as CoachSnapshot;

    const recs = detectCoachingOpportunities(
      taintedSnapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "on_demand" },
      [],
      NOW_ISO,
    );

    expect(recs.length).toBe(12);
    expect(containsHealthVaultFields(recs)).toBe(false);
    const serialized = JSON.stringify(recs);
    expect(serialized).not.toMatch(/heartRate|sleepDuration|hrv|bloodGlucose|healthMetrics/i);
  });

  it("produces strictly non-mutating action proposals requiring explicit confirmation", () => {
    const snapshot = buildAllTwelveSignalsSnapshot();
    const snapshotCopyBefore = JSON.stringify(snapshot);

    const recs = detectCoachingOpportunities(
      snapshot,
      { ...DEFAULT_COACH_PREFERENCES, proactivity: "on_demand" },
      [],
      NOW_ISO,
    );

    expect(JSON.stringify(snapshot)).toBe(snapshotCopyBefore);
    for (const rec of recs) {
      expect(rec.proposedAction.requiresConfirmation).toBe(true);
      expect(rec.proposedAction.mutatesDirectly).toBe(false);
      expect(rec.proposedAction.previewDescription.length).toBeGreaterThan(0);
    }
  });
});

describe("learningCoachStore", () => {
  beforeEach(() => {
    useLearningCoachStore.getState().reset();
  });

  it("uses the canonical plethora.learningCoach.v1 storage key and manages proactivity/snooze", () => {
    expect(LEARNING_COACH_STORAGE_KEY).toBe("plethora.learningCoach.v1");

    const snapshot = buildAllTwelveSignalsSnapshot();
    const initial = useLearningCoachStore
      .getState()
      .evaluateOpportunities(snapshot, NOW_ISO);
    expect(initial).toHaveLength(3); // default balanced cap

    const firstId = initial[0].id;
    useLearningCoachStore
      .getState()
      .snoozeSignal(firstId, "2026-11-29T00:00:00.000Z", "later", NOW_ISO);

    expect(
      useLearningCoachStore.getState().recommendations.some((r) => r.id === firstId),
    ).toBe(false);

    // Re-evaluating before snooze expires keeps it suppressed
    const reEval = useLearningCoachStore
      .getState()
      .evaluateOpportunities(snapshot, "2026-11-28T16:00:00.000Z");
    expect(reEval.some((r) => r.id === firstId)).toBe(false);

    // Switching proactivity to disabled immediately clears recommendations
    useLearningCoachStore.getState().setProactivity("disabled");
    expect(useLearningCoachStore.getState().recommendations).toEqual([]);
    expect(
      useLearningCoachStore.getState().evaluateOpportunities(snapshot, NOW_ISO),
    ).toEqual([]);
  });
});
