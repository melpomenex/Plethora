import { beforeEach, describe, expect, it } from "vitest";
import type { LearningActivity } from "../../../types/learningActivity";
import {
  _resetLearningEventBusForTests,
  learningEventBus,
} from "../../learning-events/learningEventBus";
import {
  LEARNING_SESSION_STORAGE_KEY,
  _resetLearningSessionEventSyncForTests,
  useLearningSessionStore,
} from "../../../stores/learningSessionStore";
import {
  ExamIsolationViolationError,
  adjustSessionBudget,
  assertExamIsolationAllows,
  completeActivity,
  completeSession,
  createLearningSession,
  deduplicateActivities,
  pauseSession,
  postponeActivity,
  reconcileExternalLearningEvent,
  reorderActivities,
  replaceActivity,
  resumeSession,
  revisitActivity,
  skipActivity,
  startActivity,
  summarizeSession,
} from "../sessionRuntime";

function makeActivity(overrides: Partial<LearningActivity> = {}): LearningActivity {
  const id = overrides.id ?? "act-1";
  const activityType = overrides.activityType ?? "source_reading";
  return {
    id,
    activityType,
    title: overrides.title ?? `Activity ${id}`,
    status: overrides.status ?? "pending",
    dedupeKey: overrides.dedupeKey ?? `${activityType}:${id}`,
    sourceReferences: overrides.sourceReferences ?? [
      { entityKind: "document", entityId: `doc-${id}`, documentId: `doc-${id}` },
    ],
    conceptReferences: overrides.conceptReferences ?? ["concept-1"],
    goalReferences: overrides.goalReferences ?? ["goal-1"],
    estimatedMinutes: overrides.estimatedMinutes ?? 10,
    priorityMetadata: overrides.priorityMetadata ?? { score: 0.7, urgency: "normal" },
    prerequisiteRequirements: overrides.prerequisiteRequirements ?? [],
    recommendationReason: overrides.recommendationReason ?? "Scheduled by study plan",
    capabilityRequirements: overrides.capabilityRequirements ?? {
      required: [],
      optional: [],
    },
    resumeState: overrides.resumeState ?? null,
    completionPolicy: overrides.completionPolicy ?? { mode: "explicit" },
    isLocalOnly: overrides.isLocalOnly ?? false,
    isAiExcluded: overrides.isAiExcluded ?? false,
    examIsolated: overrides.examIsolated ?? false,
    ...overrides,
  };
}

describe("sessionRuntime", () => {
  beforeEach(() => {
    _resetLearningEventBusForTests();
    _resetLearningSessionEventSyncForTests();
    if (typeof globalThis.localStorage !== "undefined") {
      globalThis.localStorage.removeItem(LEARNING_SESSION_STORAGE_KEY);
    }
    useLearningSessionStore.setState({
      activeSession: null,
      sessionHistory: [],
    });
  });

  it("runs a heterogeneous session lifecycle and emits idempotent completion events", () => {
    const reading = makeActivity({
      id: "a-read",
      activityType: "source_reading",
      dedupeKey: "source_reading:doc-1",
      estimatedMinutes: 12,
    });
    const flashcard = makeActivity({
      id: "a-card",
      activityType: "flashcard_review",
      dedupeKey: "flashcard_review:card-42:due-1",
      sourceReferences: [{ entityKind: "learning_item", entityId: "card-42" }],
      estimatedMinutes: 5,
    });
    const check = makeActivity({
      id: "a-check",
      activityType: "comprehension_check",
      dedupeKey: "comprehension_check:node-7",
      sourceReferences: [{ entityKind: "study_plan_node", entityId: "node-7" }],
      estimatedMinutes: 8,
    });

    let session = createLearningSession({
      id: "sess-hetero",
      title: "Morning Study",
      timeBudgetMinutes: 30,
      activities: [reading, flashcard, check],
    });

    expect(session.status).toBe("active");
    expect(session.activities).toHaveLength(3);
    expect(session.currentActivityIndex).toBe(0);

    session = startActivity(session, "a-read");
    expect(session.activities[0].status).toBe("in_progress");

    const firstComplete = completeActivity(session, "a-read", { activeSeconds: 420 });
    expect(firstComplete.emitted).toBe(true);
    expect(firstComplete.eventId).toBeTruthy();
    session = firstComplete.session;
    expect(session.activities[0].status).toBe("completed");
    expect(session.elapsedActiveSeconds).toBe(420);
    expect(session.currentActivityIndex).toBe(1);

    // Completing the same activity again must be idempotent and never double-count
    const duplicateComplete = completeActivity(session, "a-read", { activeSeconds: 420 });
    expect(duplicateComplete.emitted).toBe(false);
    expect(duplicateComplete.session.elapsedActiveSeconds).toBe(420);

    const cardComplete = completeActivity(session, "a-card", { activeSeconds: 180 });
    session = cardComplete.session;
    expect(session.elapsedActiveSeconds).toBe(600);
    expect(session.currentActivityIndex).toBe(2);

    const summaryBeforeClose = summarizeSession(session);
    expect(summaryBeforeClose.completedCount).toBe(2);
    expect(summaryBeforeClose.pendingCount).toBe(1);
    expect(summaryBeforeClose.remainingEstimatedMinutes).toBe(8);
    expect(summaryBeforeClose.completedByType.source_reading).toBe(1);
    expect(summaryBeforeClose.completedByType.flashcard_review).toBe(1);

    const closed = completeSession(session);
    expect(closed.status).toBe("completed");
    expect(closed.completedAt).toBeTruthy();

    const committedEvents = learningEventBus.getBufferedEvents({ sessionId: "sess-hetero" });
    const readingEvents = committedEvents.filter((e) => e.eventType === "reading_completed");
    const reviewEvents = committedEvents.filter((e) => e.eventType === "review_committed");
    expect(readingEvents).toHaveLength(1);
    expect(reviewEvents).toHaveLength(1);
  });

  it("prevents duplicate work by collapsing a multi-goal flashcard into one activity carrying all 3 goalReferences", () => {
    const sharedDedupeKey = "flashcard_review:card-99:cycle-3";
    const cardGoalA = makeActivity({
      id: "card-99-a",
      activityType: "flashcard_review",
      dedupeKey: sharedDedupeKey,
      goalReferences: ["goal-algorithms"],
      conceptReferences: ["concept-dp"],
      priorityMetadata: { score: 0.6 },
      isLocalOnly: false,
    });
    const cardGoalB = makeActivity({
      id: "card-99-b",
      activityType: "flashcard_review",
      dedupeKey: sharedDedupeKey,
      goalReferences: ["goal-interview-prep"],
      conceptReferences: ["concept-memoization"],
      priorityMetadata: { score: 0.95 },
      isLocalOnly: true,
    });
    const cardGoalC = makeActivity({
      id: "card-99-c",
      activityType: "flashcard_review",
      dedupeKey: sharedDedupeKey,
      goalReferences: ["goal-cs-exam"],
      conceptReferences: ["concept-dp"],
      priorityMetadata: { score: 0.75 },
      isAiExcluded: true,
    });

    const deduped = deduplicateActivities([cardGoalA, cardGoalB, cardGoalC]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("card-99-b"); // highest priority preserved
    expect(deduped[0].goalReferences).toEqual(
      expect.arrayContaining(["goal-algorithms", "goal-interview-prep", "goal-cs-exam"]),
    );
    expect(deduped[0].goalReferences).toHaveLength(3);
    expect(deduped[0].conceptReferences).toEqual(
      expect.arrayContaining(["concept-dp", "concept-memoization"]),
    );
    expect(deduped[0].isLocalOnly).toBe(true);
    expect(deduped[0].isAiExcluded).toBe(true);

    const session = createLearningSession({
      id: "sess-dedupe",
      activities: [cardGoalA, cardGoalB, cardGoalC],
    });
    expect(session.activities).toHaveLength(1);
    expect(session.isLocalOnly).toBe(true);
    expect(session.isAiExcluded).toBe(true);
  });

  it("synchronizes cross-surface completion via learningEventBus without double-counting", () => {
    const cardActivity = makeActivity({
      id: "act-card-7",
      activityType: "flashcard_review",
      dedupeKey: "flashcard_review:card-7:due-1",
      sourceReferences: [{ entityKind: "learning_item", entityId: "card-7" }],
    });
    const readingActivity = makeActivity({
      id: "act-read-2",
      activityType: "source_reading",
      dedupeKey: "source_reading:doc-2",
      sourceReferences: [{ entityKind: "document", entityId: "doc-2", documentId: "doc-2" }],
    });

    // Test via the live Zustand store wired to learningEventBus
    const store = useLearningSessionStore.getState();
    store.startNewSession({
      id: "sess-sync",
      activities: [cardActivity, readingActivity],
    });

    // User reviews card-7 from Scroll Mode while the session is open
    const emitted = learningEventBus.emit({
      idempotencyKey: "scroll_mode:review:card-7:1",
      eventType: "review_committed",
      surface: "scroll_mode",
      entityKind: "learning_item",
      entityId: "card-7",
      payload: { rating: 3 },
    });

    const syncedSession = useLearningSessionStore.getState().activeSession!;
    expect(syncedSession.activities[0].status).toBe("completed");
    expect(syncedSession.activities[0].completionEventId).toBe(emitted.event.id);
    expect(syncedSession.activities[0].activeSeconds).toBe(0);
    expect(syncedSession.activities[0].completedViaSurface).toBe("scroll_mode");
    expect(syncedSession.currentActivityIndex).toBe(1);
    expect(syncedSession.crossSurfaceNotices).toHaveLength(1);

    const summary = summarizeSession(syncedSession);
    expect(summary.completedViaExternalSurfaceCount).toBe(1);
    expect(summary.elapsedActiveSeconds).toBe(0);

    // Direct pure reconciliation also ignores events emitted by the same session
    const selfEvent = learningEventBus.emit({
      idempotencyKey: "unified:self:doc-2",
      eventType: "reading_completed",
      surface: "unified_session",
      sessionId: "sess-sync",
      entityKind: "document",
      entityId: "doc-2",
    });
    const unchanged = reconcileExternalLearningEvent(syncedSession, selfEvent.event);
    expect(unchanged.matchedActivityIds).toEqual([]);
  });

  it("enforces strict exam-mode isolation blocking hints, answer reveals, and coaching", () => {
    const examActivity = makeActivity({
      id: "act-exam",
      activityType: "rubric_assessment",
      dedupeKey: "rubric_assessment:exam-1",
      sourceReferences: [{ entityKind: "assessment_attempt", entityId: "exam-1" }],
      examIsolated: true,
    });
    const followUpReading = makeActivity({
      id: "act-follow",
      activityType: "source_reading",
      dedupeKey: "source_reading:doc-9",
      examIsolated: false,
    });

    let session = createLearningSession({
      id: "sess-exam",
      activities: [examActivity, followUpReading],
    });

    session = startActivity(session, "act-exam");
    expect(session.mode).toBe("exam_isolated");

    for (const blockedAction of [
      "show_hint",
      "reveal_answer",
      "open_tutor",
      "coaching_intervention",
      "peek_source",
      "switch_to_study_mode",
      "jump_to_other_activity",
    ] as const) {
      expect(() => assertExamIsolationAllows(session, blockedAction)).toThrow(
        ExamIsolationViolationError,
      );
    }

    // Jumping to another activity while exam is in progress is blocked
    expect(() => startActivity(session, "act-follow")).toThrow(
      ExamIsolationViolationError,
    );

    // Allowed exam actions succeed
    expect(() => assertExamIsolationAllows(session, "submit_attempt")).not.toThrow();
    expect(() => assertExamIsolationAllows(session, "pause_session")).not.toThrow();
    expect(() => assertExamIsolationAllows(session, "save_checkpoint")).not.toThrow();

    // Completing the exam activity cleanly exits exam_isolated mode
    const completed = completeActivity(session, "act-exam", { activeSeconds: 900 });
    expect(completed.session.mode).toBe("learning");
    expect(() => assertExamIsolationAllows(completed.session, "show_hint")).not.toThrow();
  });

  it("supports pause, resume, and persisted restart recovery without duplicating completed activities", () => {
    const act1 = makeActivity({ id: "a1", dedupeKey: "source_reading:d1" });
    const act2 = makeActivity({ id: "a2", dedupeKey: "source_reading:d2" });

    const store = useLearningSessionStore.getState();
    store.startNewSession({ id: "sess-persist", activities: [act1, act2] });
    store.startActivity("a1");
    store.completeActivity("a1", { activeSeconds: 120 });
    store.startActivity("a2");
    store.pauseSession({ checkpoint: { page: 14, scrollY: 480 } });

    const persistedRaw = globalThis.localStorage.getItem(LEARNING_SESSION_STORAGE_KEY);
    expect(persistedRaw).toBeTruthy();
    const parsed = JSON.parse(persistedRaw!);
    expect(parsed.state.activeSession.status).toBe("paused");
    expect(parsed.state.activeSession.activities[0].status).toBe("completed");
    expect(parsed.state.activeSession.activities[1].resumeState).toEqual({
      page: 14,
      scrollY: 480,
    });

    // Simulate restart recovery by pausing -> resuming via pure engine
    const recovered = resumeSession(parsed.state.activeSession);
    expect(recovered.status).toBe("active");
    expect(recovered.currentActivityIndex).toBe(1);
    expect(recovered.activities[0].status).toBe("completed");
    expect(recovered.activities[1].resumeState).toEqual({ page: 14, scrollY: 480 });

    // Re-completing already completed activity a1 after restart does not double-count
    const retry = completeActivity(recovered, "a1", { activeSeconds: 120 });
    expect(retry.emitted).toBe(false);
    expect(retry.session.elapsedActiveSeconds).toBe(120);
  });

  it("supports reorder, skip, postpone, replace, and budget adjustment", () => {
    const a1 = makeActivity({ id: "a1", dedupeKey: "k1", estimatedMinutes: 10 });
    const a2 = makeActivity({ id: "a2", dedupeKey: "k2", estimatedMinutes: 15 });
    const a3 = makeActivity({ id: "a3", dedupeKey: "k3", estimatedMinutes: 20 });

    let session = createLearningSession({
      id: "sess-ops",
      timeBudgetMinutes: 45,
      activities: [a1, a2, a3],
    });

    // Reorder
    session = reorderActivities(session, ["a3", "a1", "a2"]);
    expect(session.activities.map((a) => a.id)).toEqual(["a3", "a1", "a2"]);

    // Skip and postpone
    session = skipActivity(session, "a3", "Too tired");
    expect(session.activities[0].status).toBe("skipped");
    expect(session.activities[0].skipOrPostponeReason).toBe("Too tired");

    session = postponeActivity(session, "a1", "Save for evening");
    expect(session.activities[1].status).toBe("postponed");
    expect(session.currentActivityIndex).toBe(2);

    // Revisit postponed activity
    session = revisitActivity(session, "a1");
    expect(session.activities[1].status).toBe("pending");
    expect(session.activities[1].skipOrPostponeReason).toBeNull();
    expect(session.currentActivityIndex).toBe(1);

    // Replace
    const replacement = makeActivity({
      id: "a2-new",
      dedupeKey: "k2-new",
      title: "Targeted Drill",
      estimatedMinutes: 8,
    });
    session = replaceActivity(session, "a2", replacement);
    expect(session.activities[2].id).toBe("a2-new");

    // Budget adjustment clamps to [5, 120] and supports null (unlimited)
    session = adjustSessionBudget(session, 200);
    expect(session.timeBudgetMinutes).toBe(120);
    session = adjustSessionBudget(session, 2);
    expect(session.timeBudgetMinutes).toBe(5);
    session = adjustSessionBudget(session, null);
    expect(session.timeBudgetMinutes).toBeNull();

    // Pause / resume round-trip
    session = pauseSession(session, { checkpoint: { cursor: 3 } });
    expect(session.status).toBe("paused");
    session = resumeSession(session);
    expect(session.status).toBe("active");
  });
});
