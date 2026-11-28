import { describe, expect, it } from "vitest";
import {
  FOCUS_PROFILE_WEIGHTS,
  SESSION_FOCUS_PROFILES,
  orchestrateLearningSession,
  resolveProfileWeights,
  type DaqeActivityCandidate,
  type GoalDeadlineContext,
  type SessionFocusProfile,
} from "../orchestrator";

function makeCandidate(
  overrides: Partial<DaqeActivityCandidate> & Pick<DaqeActivityCandidate, "id">,
): DaqeActivityCandidate {
  return {
    dedupeKey: overrides.dedupeKey ?? `item:${overrides.id}`,
    title: overrides.title ?? `Activity ${overrides.id}`,
    providerKind: overrides.providerKind ?? "srs_due_pool",
    activityKind: overrides.activityKind ?? "srs_review",
    estimatedMinutes: overrides.estimatedMinutes ?? 5,
    signals: overrides.signals ?? {},
    ...overrides,
  };
}

describe("DAQE heterogeneous learning orchestrator", () => {
  it("supports all 6 session focus profiles with normalized weights and distinct top rankings", () => {
    for (const profile of SESSION_FOCUS_PROFILES) {
      const w = resolveProfileWeights(profile);
      const sum = Object.values(w).reduce((acc, v) => acc + v, 0);
      expect(sum).toBeCloseTo(1.0, 6);
      expect(FOCUS_PROFILE_WEIGHTS[profile]).toBeDefined();
    }

    const pool: DaqeActivityCandidate[] = [
      makeCandidate({
        id: "srs-urgent",
        title: "Overdue Flashcard Deck",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 5,
        retrievability: 0.45,
        dueAt: "2026-11-27T10:00:00Z",
        signals: {
          srsUrgency: 0.98,
          goalAlignment: 0.2,
          deadlinePressure: 0.1,
          knowledgeGap: 0.3,
          prerequisiteReadiness: 0.5,
          userPriority: 0.4,
          interest: 0.1,
          durationFit: 0.9,
        },
      }),
      makeCandidate({
        id: "explore-feed",
        title: "Curious Smart Feed Essay",
        providerKind: "smart_feeds",
        activityKind: "exploration_feed",
        estimatedMinutes: 6,
        isNewMaterial: true,
        signals: {
          srsUrgency: 0.05,
          goalAlignment: 0.15,
          deadlinePressure: 0.0,
          knowledgeGap: 0.1,
          prerequisiteReadiness: 0.5,
          userPriority: 0.4,
          interest: 0.98,
          durationFit: 0.9,
        },
      }),
      makeCandidate({
        id: "exam-mock",
        title: "Linear Algebra Midterm Mock",
        providerKind: "exam_prep",
        activityKind: "exam_attempt",
        estimatedMinutes: 15,
        goalReferences: [{ goalId: "goal-exam", goalTitle: "Linear Algebra Exam" }],
        signals: {
          srsUrgency: 0.2,
          goalAlignment: 0.85,
          deadlinePressure: 0.98,
          knowledgeGap: 0.92,
          prerequisiteReadiness: 0.6,
          userPriority: 0.5,
          interest: 0.1,
          durationFit: 0.8,
        },
      }),
      makeCandidate({
        id: "deep-trail",
        title: "Guided Trail: Spectral Theorem",
        providerKind: "guided_trails",
        activityKind: "guided_reading",
        estimatedMinutes: 20,
        goalReferences: [{ goalId: "goal-deep", goalTitle: "Functional Analysis" }],
        signals: {
          srsUrgency: 0.1,
          goalAlignment: 0.96,
          deadlinePressure: 0.15,
          knowledgeGap: 0.85,
          prerequisiteReadiness: 0.98,
          userPriority: 0.75,
          interest: 0.4,
          durationFit: 0.95,
        },
      }),
    ];

    const topIdFor = (profile: SessionFocusProfile, customWeights?: Record<string, number>) =>
      orchestrateLearningSession({
        candidates: pool,
        focusProfile: profile,
        timeBudgetMinutes: 30,
        customWeights,
      }).ranked[0].candidate.id;

    expect(topIdFor("memory_retention")).toBe("srs-urgent");
    expect(topIdFor("free_exploration")).toBe("explore-feed");
    expect(topIdFor("exam_prep")).toBe("exam-mock");
    expect(topIdFor("deep_study")).toBe("deep-trail");
    // Balanced evaluates the full weighted mix deterministically.
    expect(
      orchestrateLearningSession({
        candidates: pool,
        focusProfile: "balanced",
        timeBudgetMinutes: 30,
      }).ranked,
    ).toHaveLength(4);
    // Custom profile honors explicit user weights (e.g., 100% prerequisiteReadiness).
    expect(
      topIdFor("custom", {
        srsUrgency: 0,
        goalAlignment: 0,
        deadlinePressure: 0,
        knowledgeGap: 0,
        prerequisiteReadiness: 1,
        userPriority: 0,
        interest: 0,
        durationFit: 0,
      }),
    ).toBe("deep-trail");
  });

  it("strictly preserves manual priority order in strict_manual mode", () => {
    const candidates: DaqeActivityCandidate[] = [
      makeCandidate({
        id: "low-manual-high-srs",
        manualPriority: 2,
        signals: { srsUrgency: 0.99, deadlinePressure: 0.99 },
        estimatedMinutes: 5,
      }),
      makeCandidate({
        id: "high-manual-low-srs",
        manualPriority: 9.5,
        signals: { srsUrgency: 0.01, interest: 0.01 },
        estimatedMinutes: 5,
      }),
      makeCandidate({
        id: "mid-manual",
        manualPriority: 5,
        signals: { goalAlignment: 0.5 },
        estimatedMinutes: 5,
      }),
    ];

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile: "memory_retention",
      timeBudgetMinutes: 30,
      orderingMode: "strict_manual",
    });

    expect(plan.ranked.map((r) => r.candidate.id)).toEqual([
      "high-manual-low-srs",
      "mid-manual",
      "low-manual-high-srs",
    ]);
    expect(plan.selected.map((r) => r.candidate.id)).toEqual([
      "high-manual-low-srs",
      "mid-manual",
      "low-manual-high-srs",
    ]);
    expect(plan.ranked[0].explanation.orderingMode).toBe("strict_manual");
    expect(plan.ranked[0].explanation.primaryReason).toContain("Manual priority order");
  });

  it("deduplicates multi-goal flashcards by canonical dedupeKey without double-counting priority", () => {
    const sharedKey = "flashcard:eigenvalues-01";
    const candidates: DaqeActivityCandidate[] = [
      makeCandidate({
        id: "cand-goal-a",
        dedupeKey: sharedKey,
        title: "Eigenvalue decomposition card",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 3,
        manualPriority: 6,
        goalReferences: [{ goalId: "goal-a", goalTitle: "Linear Algebra" }],
        signals: {
          srsUrgency: 0.7,
          goalAlignment: 0.6,
          userPriority: 0.5,
        },
      }),
      makeCandidate({
        id: "cand-goal-b",
        dedupeKey: sharedKey,
        title: "Eigenvalue decomposition card",
        providerKind: "learning_goals",
        activityKind: "srs_review",
        estimatedMinutes: 3,
        manualPriority: 6,
        goalReferences: [{ goalId: "goal-b", goalTitle: "Quantum Mechanics" }],
        signals: {
          srsUrgency: 0.7,
          goalAlignment: 0.65,
          userPriority: 0.5,
        },
      }),
      makeCandidate({
        id: "single-goal-higher",
        dedupeKey: "flashcard:svd-02",
        title: "SVD card",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 3,
        manualPriority: 7,
        goalReferences: [{ goalId: "goal-a", goalTitle: "Linear Algebra" }],
        signals: {
          srsUrgency: 0.85,
          goalAlignment: 0.85,
          userPriority: 0.85,
        },
      }),
    ];

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 30,
    });

    expect(plan.deduplicatedCount).toBe(1);
    expect(plan.ranked).toHaveLength(2);

    const mergedItem = plan.ranked.find((r) => r.candidate.dedupeKey === sharedKey)!;
    expect(mergedItem.candidate.goalReferences.map((g) => g.goalId)).toEqual(["goal-a", "goal-b"]);
    expect(mergedItem.candidate.sourceProviders).toEqual(["learning_goals", "srs_due_pool"]);
    // Priority and urgency were NOT summed (0.5 + 0.5 would have beaten 0.85).
    expect(mergedItem.candidate.signals.userPriority).toBe(0.5);
    expect(mergedItem.candidate.signals.srsUrgency).toBe(0.7);
    expect(plan.ranked[0].candidate.id).toBe("single-goal-higher");
  });

  it("packs sessions cleanly for 5m, 30m, and unlimited budgets", () => {
    const candidates: DaqeActivityCandidate[] = [
      makeCandidate({
        id: "a-12m",
        estimatedMinutes: 12,
        signals: { srsUrgency: 0.95 },
      }),
      makeCandidate({
        id: "b-4m",
        estimatedMinutes: 4,
        signals: { srsUrgency: 0.85 },
      }),
      makeCandidate({
        id: "c-15m",
        estimatedMinutes: 15,
        signals: { srsUrgency: 0.75 },
      }),
      makeCandidate({
        id: "d-20m",
        estimatedMinutes: 20,
        signals: { srsUrgency: 0.65 },
      }),
    ];

    const plan5 = orchestrateLearningSession({
      candidates,
      focusProfile: "memory_retention",
      timeBudgetMinutes: 5,
    });
    expect(plan5.packedMinutes).toBeLessThanOrEqual(5);
    expect(plan5.selected.map((s) => s.candidate.id)).toEqual(["b-4m"]);
    expect(plan5.budgetOverflowMinutes).toBe(0);

    // When even the smallest item exceeds a 5m budget, still includes 1 top item with honest overflow.
    const plan5Overflow = orchestrateLearningSession({
      candidates: [candidates[0], candidates[2]],
      focusProfile: "memory_retention",
      timeBudgetMinutes: 5,
    });
    expect(plan5Overflow.selected).toHaveLength(1);
    expect(plan5Overflow.budgetOverflowMinutes).toBe(7);

    const plan30 = orchestrateLearningSession({
      candidates,
      focusProfile: "memory_retention",
      timeBudgetMinutes: 30,
    });
    expect(plan30.packedMinutes).toBeLessThanOrEqual(30);
    expect(plan30.selected.length).toBeGreaterThanOrEqual(2);
    expect(plan30.deferred.length).toBeGreaterThanOrEqual(1);

    const planUnlimited = orchestrateLearningSession({
      candidates,
      focusProfile: "memory_retention",
      timeBudgetMinutes: "unlimited",
    });
    expect(planUnlimited.selected).toHaveLength(4);
    expect(planUnlimited.deferred).toHaveLength(0);
    expect(planUnlimited.packedMinutes).toBe(51);
    expect(planUnlimited.budgetOverflowMinutes).toBe(0);
  });

  it("emits deterministic factor-derived explanations and treats absent signals as null/unavailable", () => {
    const candidate = makeCandidate({
      id: "partial-signals",
      providerKind: "remediation",
      activityKind: "remediation",
      estimatedMinutes: 8,
      goalReferences: [{ goalId: "g1", goalTitle: "Rust Lifetimes" }],
      signals: {
        knowledgeGap: 0.9,
        goalAlignment: 0.8,
        // Remaining signals intentionally omitted (unavailable, NOT 0).
      },
    });

    const input = {
      candidates: [candidate],
      focusProfile: "balanced" as const,
      timeBudgetMinutes: "unlimited" as const,
    };

    const run1 = orchestrateLearningSession(input);
    const run2 = orchestrateLearningSession(input);
    expect(run1).toEqual(run2);

    const item = run1.ranked[0];
    expect(item.explanation.llmGenerated).toBe(false);
    expect(item.explanation.primaryReason).toContain("Rust Lifetimes");

    const srsFactor = item.explanation.factors.find((f) => f.key === "srsUrgency")!;
    expect(srsFactor.state).toBe("unavailable");
    expect(srsFactor.normalizedValue).toBeNull();
    expect(srsFactor.effectiveWeight).toBe(0);
    expect(srsFactor.signedContribution).toBe(0);

    // Honest weight renormalization: score should be weighted average of 0.8 (w=0.20) and 0.9 (w=0.14).
    const expectedScore = (0.2 * 0.8 + 0.14 * 0.9) / (0.2 + 0.14);
    expect(item.score).toBeCloseTo(expectedScore, 6);
  });

  it("detects overload and suggests non-coercive relief without mutating SRS schedules", () => {
    const dueCandidates: DaqeActivityCandidate[] = Array.from({ length: 12 }, (_, i) =>
      makeCandidate({
        id: `due-${i}`,
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 10,
        dueAt: "2026-11-26T08:00:00Z",
        retrievability: 0.55,
        signals: { srsUrgency: 0.9 },
      }),
    );
    const explorationCandidate = makeCandidate({
      id: "feed-new-1",
      providerKind: "smart_feeds",
      activityKind: "exploration_feed",
      estimatedMinutes: 10,
      isNewMaterial: true,
      signals: { interest: 0.8 },
    });

    const allCandidates = [...dueCandidates, explorationCandidate];
    const snapshotBefore = JSON.stringify(allCandidates);

    const goals: GoalDeadlineContext[] = [
      {
        goalId: "goal-deadline",
        title: "Bar Exam",
        feasibilityStatus: "at_risk",
        daysRemaining: 10,
      },
    ];

    const plan = orchestrateLearningSession({
      candidates: allCandidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 20,
      rollingDailyStudyMinutes: 40,
      goals,
    });

    // Zero mutation to input candidates or SRS due dates.
    expect(JSON.stringify(allCandidates)).toBe(snapshotBefore);

    expect(plan.overload.isOverloaded).toBe(true);
    expect(plan.overload.mutatedSrsState).toBe(false);
    expect(plan.overload.coercive).toBe(false);
    expect(plan.overload.triggers).toContain("srs_backlog_overload");
    expect(plan.overload.triggers).toContain("deadline_crunch");
    expect(plan.overload.triggers).toContain("budget_mismatch");
    expect(plan.overload.deferrableCandidateIds).toContain("feed-new-1");
    expect(plan.overload.suggestions.map((s) => s.kind)).toEqual(
      expect.arrayContaining([
        "pause_new_material",
        "defer_low_priority",
        "focus_retention_triage",
        "focus_single_deadline",
        "keep_as_is",
      ]),
    );
  });

  it("balances competing deadlines without monopolizing or starving due retention items", () => {
    const candidates: DaqeActivityCandidate[] = [
      // Four high-pressure items from Goal A (40m total)
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate({
          id: `goal-a-${i}`,
          providerKind: "exam_prep",
          activityKind: "practice_check",
          estimatedMinutes: 10,
          topicKey: "topic-a",
          goalReferences: [{ goalId: "goal-a", goalTitle: "Goal A Exam" }],
          signals: { deadlinePressure: 0.98, goalAlignment: 0.95, knowledgeGap: 0.9 },
        }),
      ),
      // Two items from Goal B
      makeCandidate({
        id: "goal-b-1",
        providerKind: "learning_goals",
        activityKind: "study_workspace",
        estimatedMinutes: 10,
        topicKey: "topic-b",
        goalReferences: [{ goalId: "goal-b", goalTitle: "Goal B Project" }],
        signals: { deadlinePressure: 0.65, goalAlignment: 0.85, knowledgeGap: 0.7 },
      }),
      // Critical due retention item
      makeCandidate({
        id: "srs-critical",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 8,
        dueAt: "2026-11-27T00:00:00Z",
        retrievability: 0.5,
        topicKey: "topic-srs",
        signals: { srsUrgency: 0.92 },
      }),
    ];

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 30,
    });

    const selectedIds = plan.selected.map((s) => s.candidate.id);
    // Due retention item is protected from starvation.
    expect(selectedIds).toContain("srs-critical");
    // Goal B is included because Goal A cannot monopolize the entire budget.
    expect(selectedIds).toContain("goal-b-1");
    expect(plan.packedMinutes).toBeLessThanOrEqual(30);
  });

  it("operates 100% offline, preserves local-only/AI-excluded items locally, and rejects Health Vault inputs", () => {
    const candidates: DaqeActivityCandidate[] = [
      makeCandidate({
        id: "local-journal-note",
        title: "Private Research Synthesis",
        providerKind: "continue_reading",
        activityKind: "continue_reading",
        estimatedMinutes: 10,
        isLocalOnly: true,
        isAiExcluded: true,
        signals: { goalAlignment: 0.9, userPriority: 0.85 },
      }),
      makeCandidate({
        id: "health-vault-lab",
        dedupeKey: "health_vault:blood-panel-2026",
        title: "Blood Panel Results",
        sourceDomain: "health_vault",
        isHealthVault: true,
        estimatedMinutes: 5,
        signals: { userPriority: 1.0, srsUrgency: 1.0 },
      }),
      makeCandidate({
        id: "health-db-leak",
        dedupeKey: "health/health.db:med-1",
        title: "Medication Log",
        estimatedMinutes: 5,
        signals: { userPriority: 1.0 },
      }),
    ];

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 30,
    });

    expect(plan.privacy.offlineCapable).toBe(true);
    expect(plan.privacy.aiProviderUsed).toBe(false);
    expect(plan.privacy.rejectedHealthVaultIds).toEqual(["health-vault-lab", "health-db-leak"]);
    expect(plan.privacy.localOnlyItemCount).toBe(1);
    expect(plan.privacy.aiExcludedItemCount).toBe(1);
    expect(plan.privacy.planCloudAiAllowed).toBe(false);

    // Local-only item is preserved in local orchestration with cloudAiAllowed: false.
    expect(plan.ranked.map((r) => r.candidate.id)).toEqual(["local-journal-note"]);
    expect(plan.selected[0].cloudAiAllowed).toBe(false);
    expect(plan.selected[0].candidate.cloudAiAllowed).toBe(false);
  });
});
