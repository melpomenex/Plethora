import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    invokeCommand: vi.fn(),
    listen: vi.fn(async () => () => {}),
  };
});

import {
  HealthVaultBoundaryError,
  _resetLearningEventBusForTests,
  emitAndReconcileReviewCommitted,
  emitAndReconcileReviewUndone,
  emitLearningEvent,
  getBufferedLearningEvents,
  getHighWaterSeq,
  getLearningEventById,
  isStaleRelativeTo,
  retractLearningEvent,
  subscribeLearningEvents,
} from "../learningEventBus";
import {
  _resetLearningEventsApiFallbackForTests,
  advanceLearningEventCheckpoint,
  appendLearningEvent,
  getLearningEventCheckpoint,
  listLearningEvents,
  retractLearningEvent as apiRetractLearningEvent,
} from "../../../api/learning-events";
import {
  _resetReviewSyncForTests,
  filterStaleDueLearningItems,
  getReviewSyncRevision,
  subscribeReviewSync,
  type ReviewSyncEvent,
  type SyncableLearningItem,
} from "../../reviewSync";
import { LEARNING_EVENT_SCHEMA_VERSION, type LearningEvent } from "../../../types/learningEvent";

function makeSyncableItem(overrides: Partial<SyncableLearningItem> = {}): SyncableLearningItem {
  const now = "2026-11-28T12:00:00.000Z";
  return {
    id: "item-1",
    question: "What is FSRS?",
    answer: "Free Spaced Repetition Scheduler",
    due_date: "2026-12-05T12:00:00.000Z",
    interval: 7,
    ease_factor: 2.5,
    difficulty: 5,
    review_count: 3,
    lapses: 0,
    state: "Review",
    is_suspended: false,
    tags: [],
    date_created: now,
    date_modified: now,
    ...overrides,
  };
}

describe("learningEventBus (Phase 1A)", () => {
  beforeEach(() => {
    _resetLearningEventBusForTests();
    _resetLearningEventsApiFallbackForTests();
    _resetReviewSyncForTests();
  });

  afterEach(() => {
    _resetLearningEventBusForTests();
    _resetLearningEventsApiFallbackForTests();
    _resetReviewSyncForTests();
  });

  it("deduplicates deterministically by idempotencyKey and assigns monotonic seq", () => {
    const received: LearningEvent[] = [];
    const unsubscribe = subscribeLearningEvents(null, (evt) => received.push(evt));

    const first = emitLearningEvent({
      idempotencyKey: "review_commit:rr-100",
      eventType: "review_committed",
      surface: "review",
      entityKind: "learning_item",
      entityId: "item-100",
      payload: { rating: 3, elapsedDays: 4 },
    });

    const duplicate = emitLearningEvent({
      idempotencyKey: "review_commit:rr-100",
      eventType: "review_committed",
      surface: "review",
      entityKind: "learning_item",
      entityId: "item-100",
      payload: { rating: 3, elapsedDays: 4 },
    });

    const second = emitLearningEvent({
      idempotencyKey: "reading_segment:doc-1:seg-2",
      eventType: "reading_progressed",
      surface: "reader",
      entityKind: "document",
      entityId: "doc-1",
      documentId: "doc-1",
      payload: { coverageRatio: 0.4 },
    });

    unsubscribe();

    expect(first.inserted).toBe(true);
    expect(first.event.seq).toBe(1);
    expect(first.event.schemaVersion).toBe(LEARNING_EVENT_SCHEMA_VERSION);

    expect(duplicate.inserted).toBe(false);
    expect(duplicate.event.id).toBe(first.event.id);
    expect(duplicate.event.seq).toBe(first.event.seq);

    expect(second.inserted).toBe(true);
    expect(second.event.seq).toBe(2);
    expect(getHighWaterSeq()).toBe(2);
    expect(received).toHaveLength(2);
  });

  it("tracks per-entity staleness via isStaleRelativeTo", () => {
    const seqBefore = getHighWaterSeq();
    expect(isStaleRelativeTo("learning_item", "item-7", seqBefore)).toBe(false);

    emitLearningEvent({
      idempotencyKey: "review_commit:item-7:1",
      eventType: "review_committed",
      surface: "scroll_mode",
      entityKind: "learning_item",
      entityId: "item-7",
      payload: { rating: 3 },
    });

    expect(isStaleRelativeTo("learning_item", "item-7", seqBefore)).toBe(true);
    expect(isStaleRelativeTo("learning_item", "item-8", seqBefore)).toBe(false);
    expect(isStaleRelativeTo("learning_item", "item-7", getHighWaterSeq())).toBe(false);
  });

  it("retracts events append-only by linking retractedByEventId without mutating payload", () => {
    const original = emitLearningEvent({
      idempotencyKey: "exam_grade:grade-1",
      eventType: "assessment_graded",
      surface: "exam",
      entityKind: "exam_grade",
      entityId: "grade-1",
      payload: { score: 0.9, conceptIds: ["c-1"] },
    });

    const retraction = retractLearningEvent(original.event.id, {
      idempotencyKey: "exam_grade_invalidate:grade-1",
      eventType: "assessment_grade_invalidated",
      surface: "exam",
      entityKind: "exam_grade",
      entityId: "grade-1",
      payload: { reason: "rubric_corrected" },
    });

    expect(retraction.inserted).toBe(true);
    expect(retraction.event.seq).toBe(original.event.seq + 1);

    const updatedOriginal = getLearningEventById(original.event.id);
    expect(updatedOriginal).not.toBeNull();
    expect(updatedOriginal!.retractedByEventId).toBe(retraction.event.id);
    expect(updatedOriginal!.payload).toEqual({ score: 0.9, conceptIds: ["c-1"] });

    // Default buffer query excludes retracted events
    const activeOnly = getBufferedLearningEvents();
    expect(activeOnly.map((e) => e.id)).toEqual([retraction.event.id]);

    // Explicit includeRetracted returns both
    const all = getBufferedLearningEvents({ includeRetracted: true });
    expect(all.map((e) => e.id)).toEqual([original.event.id, retraction.event.id]);
  });

  it("filters cross-surface subscriptions accurately", () => {
    const scrollEvents: LearningEvent[] = [];
    const examEvents: LearningEvent[] = [];

    const unsubScroll = subscribeLearningEvents(
      { surfaces: ["scroll_mode"], eventTypes: ["review_committed"] },
      (e) => scrollEvents.push(e),
    );
    const unsubExam = subscribeLearningEvents(
      { entityKind: "exam_grade" },
      (e) => examEvents.push(e),
    );

    emitLearningEvent({
      idempotencyKey: "k-1",
      eventType: "review_committed",
      surface: "scroll_mode",
      entityKind: "learning_item",
      entityId: "card-1",
    });
    emitLearningEvent({
      idempotencyKey: "k-2",
      eventType: "review_committed",
      surface: "review",
      entityKind: "learning_item",
      entityId: "card-2",
    });
    emitLearningEvent({
      idempotencyKey: "k-3",
      eventType: "assessment_graded",
      surface: "exam",
      entityKind: "exam_grade",
      entityId: "grade-9",
    });

    unsubScroll();
    unsubExam();

    expect(scrollEvents).toHaveLength(1);
    expect(scrollEvents[0].entityId).toBe("card-1");
    expect(examEvents).toHaveLength(1);
    expect(examEvents[0].entityId).toBe("grade-9");
  });

  it("bridges review_committed and review_undone with reviewSync and prevents stale due-card resurrection", () => {
    const syncEvents: ReviewSyncEvent[] = [];
    const unsubSync = subscribeReviewSync((evt) => syncEvents.push(evt));

    const nowMs = Date.parse("2026-11-28T12:00:00.000Z");
    const startedAtRevision = getReviewSyncRevision();

    // Commit a review from Scroll Mode scheduling the item 7 days into the future
    const committedItem = makeSyncableItem({
      id: "card-42",
      due_date: "2026-12-05T12:00:00.000Z",
      interval: 7,
    });

    const firstCommit = emitAndReconcileReviewCommitted({
      idempotencyKey: "review_commit:card-42:1",
      surface: "scroll_mode",
      updatedItem: committedItem,
      payload: { rating: 3, elapsedDays: 3 },
      nowMs,
    });

    // Duplicate delivery with same idempotencyKey must NOT trigger a second reviewSync
    const dupCommit = emitAndReconcileReviewCommitted({
      idempotencyKey: "review_commit:card-42:1",
      surface: "scroll_mode",
      updatedItem: committedItem,
      payload: { rating: 3, elapsedDays: 3 },
      nowMs,
    });

    expect(firstCommit.eventResult.inserted).toBe(true);
    expect(firstCommit.syncEvent).not.toBeNull();
    expect(firstCommit.syncEvent!.source).toBe("scrollMode");
    expect(firstCommit.syncEvent!.eligible).toBe(false);
    expect(dupCommit.eventResult.inserted).toBe(false);
    expect(dupCommit.syncEvent).toBeNull();
    expect(syncEvents).toHaveLength(1);

    // An in-flight getDueItems that started before the commit must NOT resurrect card-42
    const staleFetch = [{ id: "card-42" }, { id: "card-99" }];
    const filtered = filterStaleDueLearningItems(staleFetch, startedAtRevision);
    expect(filtered.map((i) => i.id)).toEqual(["card-99"]);

    // Undo restores the card to due now and retracts the original event
    const restoredItem = makeSyncableItem({
      id: "card-42",
      due_date: "2026-11-28T11:00:00.000Z",
      interval: 1,
    });

    const undoRes = emitAndReconcileReviewUndone({
      idempotencyKey: "review_undo:card-42:1",
      targetEventId: firstCommit.eventResult.event.id,
      surface: "scroll_mode",
      restoredItem,
      nowMs,
    });

    unsubSync();

    expect(undoRes.eventResult.inserted).toBe(true);
    expect(undoRes.syncEvent?.type).toBe("review-undone");
    expect(undoRes.syncEvent?.eligible).toBe(true);
    expect(getLearningEventById(firstCommit.eventResult.event.id)?.retractedByEventId).toBe(
      undoRes.eventResult.event.id,
    );
  });

  it("strictly rejects Health Vault entity kinds, event types, and raw health payload fields", () => {
    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-1",
        eventType: "reading_progressed",
        surface: "reader",
        // @ts-expect-error testing runtime Health Vault boundary enforcement
        entityKind: "health_record",
        entityId: "hr-1",
      }),
    ).toThrow(HealthVaultBoundaryError);

    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-2",
        // @ts-expect-error testing runtime Health Vault boundary enforcement
        eventType: "biometric_recorded",
        surface: "background",
        entityKind: "document",
        entityId: "doc-1",
      }),
    ).toThrow(HealthVaultBoundaryError);

    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-3",
        eventType: "session_completed",
        surface: "unified_session",
        entityKind: "learning_session",
        entityId: "sess-1",
        payload: {
          durationSec: 600,
          nested: {
            heartRate: 72,
          },
        },
      }),
    ).toThrow(HealthVaultBoundaryError);

    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-4",
        eventType: "session_completed",
        surface: "unified_session",
        entityKind: "learning_session",
        entityId: "sess-2",
        payload: {
          sleep_duration: 420,
        },
      }),
    ).toThrow(HealthVaultBoundaryError);

    expect(getBufferedLearningEvents()).toHaveLength(0);
  });

  it("preserves isLocalOnly and isAiExcluded privacy flags and respects excludeAiExcluded filters", () => {
    const aiVisibleEvents: LearningEvent[] = [];
    const unsub = subscribeLearningEvents({ excludeAiExcluded: true }, (e) =>
      aiVisibleEvents.push(e),
    );

    const privateEvt = emitLearningEvent({
      idempotencyKey: "priv-1",
      eventType: "reading_progressed",
      surface: "reader",
      entityKind: "document",
      entityId: "doc-secret",
      documentId: "doc-secret",
      isLocalOnly: true,
      isAiExcluded: true,
      payload: { coverageRatio: 0.8 },
    });

    const normalEvt = emitLearningEvent({
      idempotencyKey: "pub-1",
      eventType: "reading_progressed",
      surface: "reader",
      entityKind: "document",
      entityId: "doc-public",
      documentId: "doc-public",
      isLocalOnly: false,
      isAiExcluded: false,
      payload: { coverageRatio: 0.5 },
    });

    unsub();

    expect(privateEvt.event.isLocalOnly).toBe(true);
    expect(privateEvt.event.isAiExcluded).toBe(true);
    expect(normalEvt.event.isLocalOnly).toBe(false);
    expect(normalEvt.event.isAiExcluded).toBe(false);

    expect(aiVisibleEvents.map((e) => e.id)).toEqual([normalEvt.event.id]);
    expect(getBufferedLearningEvents({ excludeAiExcluded: true }).map((e) => e.id)).toEqual([
      normalEvt.event.id,
    ]);
  });

  it("supports browser/test API fallback for events and durable checkpoints", async () => {
    const appended = await appendLearningEvent({
      idempotencyKey: "api-1",
      eventType: "extract_created",
      surface: "reader",
      entityKind: "extract",
      entityId: "ext-1",
      documentId: "doc-1",
      payload: { length: 120 },
    });

    expect(appended.inserted).toBe(true);
    const listed = await listLearningEvents({ entityKind: "extract" });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(appended.event.id);

    const initialCp = await getLearningEventCheckpoint("learner_model_v1");
    expect(initialCp).toBeNull();

    const advanced = await advanceLearningEventCheckpoint("learner_model_v1", appended.event.seq);
    expect(advanced.lastSeq).toBe(appended.event.seq);

    // Advancing with a lower seq does not regress the checkpoint
    const monotonic = await advanceLearningEventCheckpoint("learner_model_v1", 0);
    expect(monotonic.lastSeq).toBe(appended.event.seq);

    const retracted = await apiRetractLearningEvent(appended.event.id, {
      idempotencyKey: "api-retract-1",
      eventType: "review_undone",
      surface: "reader",
      entityKind: "extract",
      entityId: "ext-1",
    });
    expect(retracted.inserted).toBe(true);
    expect(getLearningEventById(appended.event.id)?.retractedByEventId).toBe(retracted.event.id);
  });

  it("isolates subscriber errors so one failing listener does not block others", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: string[] = [];

    const u1 = subscribeLearningEvents(null, () => {
      throw new Error("boom");
    });
    const u2 = subscribeLearningEvents(null, (e) => {
      received.push(e.id);
    });

    const res = emitLearningEvent({
      idempotencyKey: "iso-1",
      eventType: "goal_created",
      surface: "today_dashboard",
      entityKind: "learning_goal",
      entityId: "goal-1",
    });

    u1();
    u2();
    consoleSpy.mockRestore();

    expect(received).toEqual([res.event.id]);
  });
});
