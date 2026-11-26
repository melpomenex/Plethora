import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningItem } from "../../api/review";
import type { QueueItem } from "../../types/queue";
import {
  _resetReviewSyncForTests,
  canonicalLearningItemId,
  filterStaleDueLearningItems,
  getReviewSyncRevision,
  isLearningItemEligibleForDueQueue,
  matchesQueueLearningItem,
  reconcileReviewUndo,
  reconcileScheduledReview,
  subscribeReviewSync,
} from "../reviewSync";
import { useQueueStore } from "../../stores/queueStore";
import { useReviewStore } from "../../stores/reviewStore";
import { cardMutationCoordinator } from "../../api/learningItemMutationCoordinator";

function makeLearningItem(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: "card-1",
    document_id: "doc-1",
    item_type: "flashcard",
    question: "What is FSRS?",
    answer: "Free Spaced Repetition Scheduler",
    due_date: new Date(Date.now() - 60_000).toISOString(),
    interval: 1,
    ease_factor: 2.5,
    difficulty: 3,
    lapses: 0,
    review_count: 1,
    state: "review",
    is_suspended: false,
    tags: [],
    date_created: new Date(Date.now() - 86_400_000).toISOString(),
    date_modified: new Date(Date.now() - 86_400_000).toISOString(),
    interaction_metadata: undefined,
    ...overrides,
  };
}

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "card-1",
    learningItemId: "card-1",
    documentId: "doc-1",
    documentTitle: "Test Doc",
    itemType: "learning-item",
    priority: 5,
    estimatedTime: 2,
    tags: [],
    progress: 0,
    ...overrides,
  };
}

describe("cross-mode reviewSync", () => {
  beforeEach(() => {
    _resetReviewSyncForTests();
    window.localStorage.clear();
    useQueueStore.setState({
      items: [],
      filteredItems: [],
      queryRevision: 0,
      hasLocalDeltas: false,
      hasCompletedFirstLoad: false,
    });
    useReviewStore.setState({
      queue: [],
      currentIndex: 0,
      currentCard: null,
      isAnswerShown: false,
      reviewsCompleted: 0,
      correctCount: 0,
      removedIds: new Set<string>(),
      revealRevision: 0,
      generation: 1,
    });
  });

  it("reconciles Review View -> Reading Queue & Scroll Mode when a card is scheduled into the future", () => {
    const docItem = makeQueueItem({ id: "doc-1", learningItemId: undefined, itemType: "document" });
    const cardQueueItem = makeQueueItem({ id: "flashcard-card-1", learningItemId: "card-1" });
    useQueueStore.setState({ items: [docItem, cardQueueItem], filteredItems: [docItem, cardQueueItem] });

    const listener = vi.fn();
    const unsub = subscribeReviewSync(listener);

    const futureItem = makeLearningItem({
      id: "card-1",
      due_date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      interval: 3,
    });

    reconcileScheduledReview(futureItem, { source: "reviewStore" });

    // Card removed from Reading Queue, source document preserved
    const remainingIds = useQueueStore.getState().items.map((i) => i.id);
    expect(remainingIds).toEqual(["doc-1"]);
    expect(useQueueStore.getState().queryRevision).toBe(1);

    // Scroll Mode / subscribers notified
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "review-committed",
        canonicalId: "card-1",
        eligible: false,
        source: "reviewStore",
      })
    );
    unsub();
  });

  it("reconciles Scroll Mode / Quick Review -> Review View without incrementing external review count", () => {
    const card1 = makeLearningItem({ id: "card-1" });
    const card2 = makeLearningItem({ id: "card-2", question: "Second card" });
    useReviewStore.setState({
      queue: [card1, card2],
      currentIndex: 0,
      currentCard: card1,
      isAnswerShown: true,
      reviewsCompleted: 0,
    });
    useQueueStore.setState({
      items: [makeQueueItem({ id: "card-1" }), makeQueueItem({ id: "card-2", learningItemId: "card-2" })],
      filteredItems: [makeQueueItem({ id: "card-1" }), makeQueueItem({ id: "card-2", learningItemId: "card-2" })],
    });

    const futureCard1 = makeLearningItem({
      id: "card-1",
      due_date: new Date(Date.now() + 86_400_000).toISOString(),
      interval: 1,
    });

    reconcileScheduledReview(futureCard1, { source: "scrollMode" });

    const reviewState = useReviewStore.getState();
    expect(reviewState.queue.map((c) => c.id)).toEqual(["card-2"]);
    expect(reviewState.currentCard?.id).toBe("card-2");
    expect(reviewState.isAnswerShown).toBe(false);
    expect(reviewState.reviewsCompleted).toBe(0);
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["card-2"]);
  });

  it("keeps Again / short-relearning cards eligible instead of banning them for the day", () => {
    useQueueStore.setState({
      items: [makeQueueItem({ id: "flashcard-card-1", learningItemId: "card-1" })],
      filteredItems: [makeQueueItem({ id: "flashcard-card-1", learningItemId: "card-1" })],
    });

    const againDueNow = makeLearningItem({
      id: "card-1",
      due_date: new Date(Date.now() - 1000).toISOString(),
      interval: 0,
      state: "relearning",
    });

    expect(isLearningItemEligibleForDueQueue(againDueNow)).toBe(true);
    reconcileScheduledReview(againDueNow, { source: "reviewStore" });

    expect(useQueueStore.getState().items).toHaveLength(1);
    expect(useQueueStore.getState().items[0].dueDate).toBe(againDueNow.due_date);
  });

  it("prevents stale in-flight getDueItems responses from resurrecting reviewed cards", () => {
    const revBefore = getReviewSyncRevision();
    const card1 = makeLearningItem({ id: "card-1" });
    const card2 = makeLearningItem({ id: "card-2" });

    const futureCard1 = makeLearningItem({
      id: "card-1",
      due_date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    reconcileScheduledReview(futureCard1, { source: "reviewStore" });

    const filtered = filterStaleDueLearningItems([card1, card2], revBefore);
    expect(filtered.map((c) => c.id)).toEqual(["card-2"]);
  });

  it("restores eligibility on review undo and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeReviewSync(listener);

    const restored = makeLearningItem({
      id: "card-1",
      due_date: new Date(Date.now() - 10_000).toISOString(),
    });
    reconcileReviewUndo(restored, { source: "reviewStore" });

    expect(useQueueStore.getState().queryRevision).toBe(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "review-undone",
        canonicalId: "card-1",
        eligible: true,
      })
    );
    unsub();
  });

  it("matches canonical learning item identity without touching documents or extracts", () => {
    expect(canonicalLearningItemId("flashcard-abc")).toBe("abc");
    expect(matchesQueueLearningItem(makeQueueItem({ id: "flashcard-abc", learningItemId: "abc" }), "abc")).toBe(true);
    expect(
      matchesQueueLearningItem(
        makeQueueItem({ id: "abc", learningItemId: undefined, itemType: "extract" }),
        "abc"
      )
    ).toBe(false);
    expect(
      matchesQueueLearningItem(
        makeQueueItem({ id: "abc", learningItemId: undefined, itemType: "document" }),
        "abc"
      )
    ).toBe(false);
  });

  it("prevents concurrent duplicate rating submission via cardMutationCoordinator", () => {
    const token1 = cardMutationCoordinator.acquireMutationToken("card-dup", "rate");
    const token2 = cardMutationCoordinator.acquireMutationToken("card-dup", "rate");
    expect(token1).not.toBeNull();
    expect(token2).toBeNull();
    token1?.release();
  });
});
