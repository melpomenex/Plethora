import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  invokeCommand: vi.fn(),
}));

import {
  listGoalsForSource,
  resetBrowserLearningGoalsState,
} from "../../api/learning-goals";
import { useLearningGoalsStore } from "../learningGoalsStore";

describe("learningGoalsStore", () => {
  beforeEach(() => {
    resetBrowserLearningGoalsState();
    useLearningGoalsStore.getState().reset();
  });

  it("supports casual 1-field goal creation with only a title", async () => {
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Explore Quantum Computing",
    });

    expect(goal.id).toBeTruthy();
    expect(goal.title).toBe("Explore Quantum Computing");
    expect(goal.kind).toBe("exploration");
    expect(goal.status).toBe("active");
    expect(goal.targetDate).toBeNull();
    expect(goal.studyPlanId).toBeNull();
    expect(goal.dailyMinutesBudget).toBeNull();
    expect(useLearningGoalsStore.getState().goals).toHaveLength(1);
    expect(useLearningGoalsStore.getState().activeGoalId).toBe(goal.id);
  });

  it("creates a goal through the creation wizard and resets wizard state", async () => {
    const store = useLearningGoalsStore.getState();
    store.openWizard({ kind: "skill" });
    store.updateWizardDraft({ title: "Learn Rust Lifetimes", dailyMinutesBudget: 25 });
    store.setWizardStep("review");

    expect(useLearningGoalsStore.getState().wizard.isOpen).toBe(true);
    expect(useLearningGoalsStore.getState().wizard.step).toBe("review");

    const created = await useLearningGoalsStore.getState().submitWizard();
    expect(created.title).toBe("Learn Rust Lifetimes");
    expect(created.kind).toBe("skill");
    expect(created.dailyMinutesBudget).toBe(25);
    expect(useLearningGoalsStore.getState().wizard.isOpen).toBe(false);
  });

  it("evolves an exploration goal into a deadline goal with a studyPlanId without losing ID or sources", async () => {
    const store = useLearningGoalsStore.getState();
    const initial = await store.createGoal({
      title: "Distributed Systems",
      kind: "exploration",
      initialSources: [
        { sourceKind: "document", sourceId: "doc-ddia", label: "DDIA" },
        { sourceKind: "concept", sourceId: "concept-raft" },
      ],
    });

    const evolved = await useLearningGoalsStore.getState().evolveGoal(initial.id, {
      kind: "deadline",
      studyPlanId: "plan-99",
      targetDate: "2026-12-15T00:00:00.000Z",
      dailyMinutesBudget: 45,
      targetDimensions: ["comprehension", "retention", "application"],
    });

    expect(evolved.id).toBe(initial.id);
    expect(evolved.kind).toBe("deadline");
    expect(evolved.studyPlanId).toBe("plan-99");
    expect(evolved.targetDate).toBe("2026-12-15T00:00:00.000Z");
    expect(evolved.dailyMinutesBudget).toBe(45);
    expect(evolved.sources.map((s) => s.sourceId)).toEqual([
      "doc-ddia",
      "concept-raft",
    ]);

    const stored = useLearningGoalsStore
      .getState()
      .goals.find((g) => g.id === initial.id)!;
    expect(stored.studyPlanId).toBe("plan-99");
    expect(stored.sources).toHaveLength(2);
  });

  it("shares a document, concept, and saved queue across multiple simultaneous goals without duplication", async () => {
    const store = useLearningGoalsStore.getState();
    const goalA = await store.createGoal({ title: "Exam Prep", kind: "deadline" });
    const goalB = await store.createGoal({ title: "Deep Mastery", kind: "mastery" });

    await useLearningGoalsStore
      .getState()
      .linkSource(goalA.id, "document", "doc-shared", "primary");
    await useLearningGoalsStore
      .getState()
      .linkSource(goalB.id, "document", "doc-shared", "supplemental");
    // Re-linking same source to goalA must be idempotent (no duplicate link)
    await useLearningGoalsStore
      .getState()
      .linkSource(goalA.id, "document", "doc-shared", "primary", 2.0);

    await useLearningGoalsStore
      .getState()
      .linkSource(goalA.id, "concept", "concept-shared");
    await useLearningGoalsStore
      .getState()
      .linkSource(goalB.id, "concept", "concept-shared");
    await useLearningGoalsStore
      .getState()
      .linkSource(goalA.id, "saved_queue", "queue-cards-1");
    await useLearningGoalsStore
      .getState()
      .linkSource(goalB.id, "saved_queue", "queue-cards-1");

    const goalsForDoc = useLearningGoalsStore
      .getState()
      .getGoalsForSource("document", "doc-shared");
    expect(goalsForDoc.map((g) => g.id).sort()).toEqual(
      [goalA.id, goalB.id].sort()
    );

    const apiGoalsForConcept = await listGoalsForSource("concept", "concept-shared");
    expect(apiGoalsForConcept).toHaveLength(2);

    const refreshedA = useLearningGoalsStore
      .getState()
      .goals.find((g) => g.id === goalA.id)!;
    const docLinksInA = refreshedA.sources.filter(
      (s) => s.sourceKind === "document" && s.sourceId === "doc-shared"
    );
    expect(docLinksInA).toHaveLength(1);
    expect(docLinksInA[0].weight).toBe(2.0);
  });

  it("enforces Smart Feed exploration_candidate invariant when linking sources", async () => {
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "AI Research Stream",
      kind: "continuous",
    });

    await expect(
      useLearningGoalsStore
        .getState()
        .linkSource(goal.id, "smart_feed", "sf-1", "primary")
    ).rejects.toThrow(/exploration_candidate/);

    const linked = await useLearningGoalsStore
      .getState()
      .linkSource(goal.id, "smart_feed", "sf-1", "exploration_candidate");
    expect(linked.sourceKind).toBe("smart_feed");
    expect(linked.sourceRole).toBe("exploration_candidate");
  });

  it("supports pause, resume, archive, and non-destructive delete preserving shared sources and other goals", async () => {
    const goalA = await useLearningGoalsStore.getState().createGoal({
      title: "Goal A",
      initialSources: [
        { sourceKind: "document", sourceId: "doc-7" },
        { sourceKind: "concept", sourceId: "c-7" },
      ],
    });
    const goalB = await useLearningGoalsStore.getState().createGoal({
      title: "Goal B",
      initialSources: [
        { sourceKind: "document", sourceId: "doc-7" },
        { sourceKind: "concept", sourceId: "c-7" },
      ],
    });

    await useLearningGoalsStore.getState().pauseGoal(goalA.id);
    expect(useLearningGoalsStore.getState().getPausedGoals().map((g) => g.id)).toEqual([
      goalA.id,
    ]);

    await useLearningGoalsStore.getState().resumeGoal(goalA.id);
    expect(useLearningGoalsStore.getState().getActiveGoals()).toHaveLength(2);

    await useLearningGoalsStore.getState().archiveGoal(goalA.id);
    expect(
      useLearningGoalsStore.getState().getArchivedGoals().map((g) => g.id)
    ).toEqual([goalA.id]);

    // Delete Goal A — Goal B and its links to doc-7 and c-7 MUST stay intact
    await useLearningGoalsStore.getState().deleteGoal(goalA.id);

    expect(useLearningGoalsStore.getState().goals.map((g) => g.id)).toEqual([
      goalB.id,
    ]);
    const remainingForDoc = await listGoalsForSource("document", "doc-7");
    expect(remainingForDoc.map((g) => g.id)).toEqual([goalB.id]);
    expect(remainingForDoc[0].sources.map((s) => s.sourceId)).toEqual([
      "doc-7",
      "c-7",
    ]);
  });

  it("evaluates feasibility and surfaces progress summary in the store", async () => {
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Midterm",
      kind: "deadline",
      targetDate: "2026-11-11T00:00:00.000Z",
      dailyMinutesBudget: 30,
    });

    await useLearningGoalsStore.getState().upsertMilestone(goal.id, {
      title: "Finish Chapter 1",
      status: "completed",
    });
    await useLearningGoalsStore.getState().upsertMilestone(goal.id, {
      title: "Practice Exam",
      status: "pending",
    });

    const report = await useLearningGoalsStore
      .getState()
      .evaluateFeasibility(goal.id, {
        uncompletedReadingMinutes: 180,
        nowIso: "2026-11-01T00:00:00.000Z",
      });

    expect(report.status).toBe("on_track");
    expect(useLearningGoalsStore.getState().feasibilityByGoalId[goal.id]).toEqual(
      report
    );

    const summary = useLearningGoalsStore.getState().getProgressSummary(goal.id)!;
    expect(summary.feasibilityStatus).toBe("on_track");
    expect(summary.completedMilestoneCount).toBe(1);
    expect(summary.totalMilestoneCount).toBe(2);
    expect(summary.remainingMinutes).toBe(180);
    expect(summary.daysRemaining).toBe(10);
  });
});
