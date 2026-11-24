import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewStore } from "../stores/reviewStore";
import { useQueueStore } from "../stores/queueStore";
import { useSettingsStore } from "../stores/settingsStore";
import { applyItemTagsToStores } from "../lib/tagEditing/storeReconciliation";
import * as learningItemsApi from "../api/learning-items";

vi.mock("../api/review", async () => {
  const actual = await vi.importActual<typeof import("../api/review")>("../api/review");
  return {
    ...actual,
    getDueItems: vi.fn(async () => [
      {
        id: "due-finance-card",
        item_type: "Qa",
        question: "Finance question",
        answer: "Finance answer",
        difficulty: 3,
        interval: 1,
        ease_factor: 2.5,
        due_date: new Date(Date.now() - 3600_000).toISOString(),
        date_created: "2026-11-20T10:00:00Z",
        date_modified: "2026-11-20T10:00:00Z",
        review_count: 1,
        lapses: 0,
        state: "Review",
        is_suspended: false,
        tags: ["Finance"],
      },
    ]),
    startReview: vi.fn(async () => "session-1"),
    previewReviewIntervals: vi.fn(async () => ({ again: 1, hard: 2, good: 4, easy: 7 })),
  };
});

describe("Issue #6 State, Identity, Queue & Settings Remediation", () => {
  beforeEach(() => {
    useReviewStore.getState().resetSession();
  });

  it("BUG-15: startReviewAtItem fetches exact future-scheduled card instead of opening queue[0]", async () => {
    const futureCpsCard: learningItemsApi.LearningItem = {
      id: "future-cps-card",
      item_type: "Qa",
      question: "CPS pharmacy question",
      answer: "CPS pharmacy answer",
      difficulty: 3,
      interval: 5,
      ease_factor: 2.5,
      due_date: new Date(Date.now() + 5 * 86400_000).toISOString(),
      date_created: "2026-11-20T10:00:00Z",
      date_modified: "2026-11-20T10:00:00Z",
      review_count: 2,
      lapses: 0,
      state: "Review",
      is_suspended: false,
      tags: ["Pharmacy", "CPS"],
    };

    const spy = vi.spyOn(learningItemsApi, "getLearningItem").mockResolvedValueOnce(futureCpsCard);

    await useReviewStore.getState().startReviewAtItem("future-cps-card");

    expect(spy).toHaveBeenCalledWith("future-cps-card");
    expect(useReviewStore.getState().currentCard?.id).toBe("future-cps-card");
    expect(useReviewStore.getState().currentCard?.question).toBe("CPS pharmacy question");
    spy.mockRestore();
  });

  it("BUG-15: startReviewAtItem sets error instead of opening substitute when item is deleted", async () => {
    const spy = vi.spyOn(learningItemsApi, "getLearningItem").mockResolvedValueOnce(null);

    await useReviewStore.getState().startReviewAtItem("deleted-card-id");

    expect(useReviewStore.getState().currentCard).toBeNull();
    expect(useReviewStore.getState().error).toBeTruthy();
    spy.mockRestore();
  });

  it("BUG-06: applyItemTagsToStores reconciles reviewStore.currentCard and queue", () => {
    useReviewStore.setState({
      currentCard: {
        id: "card-tag-1",
        item_type: "qa",
        question: "Q",
        answer: "A",
        difficulty: 3,
        interval: 1,
        ease_factor: 2.5,
        due_date: "2026-11-24T00:00:00Z",
        date_created: "2026-11-20T00:00:00Z",
        date_modified: "2026-11-20T00:00:00Z",
        review_count: 0,
        lapses: 0,
        state: "new",
        is_suspended: false,
        tags: ["old-tag"],
      },
      queue: [
        {
          id: "card-tag-1",
          item_type: "qa",
          question: "Q",
          answer: "A",
          difficulty: 3,
          interval: 1,
          ease_factor: 2.5,
          due_date: "2026-11-24T00:00:00Z",
          date_created: "2026-11-20T00:00:00Z",
          date_modified: "2026-11-20T00:00:00Z",
          review_count: 0,
          lapses: 0,
          state: "new",
          is_suspended: false,
          tags: ["old-tag"],
        },
      ],
    });

    applyItemTagsToStores("learning-item", "card-tag-1", ["new-tag"]);

    expect(useReviewStore.getState().currentCard?.tags).toEqual(["new-tag"]);
    expect(useReviewStore.getState().queue[0]?.tags).toEqual(["new-tag"]);
  });

  it("BUG-05: removeItemsLocally removes completed card from Reading Queue store", () => {
    useQueueStore.setState({
      items: [
        {
          id: "card-1",
          documentId: "doc-1",
          documentTitle: "CPS",
          itemType: "learning-item",
          priority: 50,
          estimatedTime: 2,
          tags: [],
          progress: 0,
        },
      ],
      filteredItems: [
        {
          id: "card-1",
          documentId: "doc-1",
          documentTitle: "CPS",
          itemType: "learning-item",
          priority: 50,
          estimatedTime: 2,
          tags: [],
          progress: 0,
        },
      ],
    });

    useQueueStore.getState().removeItemsLocally(["card-1"]);
    expect(useQueueStore.getState().items).toHaveLength(0);
    expect(useQueueStore.getState().filteredItems).toHaveLength(0);
  });

  it("FEAT-02: scrollQueue.wheelNavigationEnabled defaults to true and persists updates", () => {
    const store = useSettingsStore.getState();
    expect(store.settings.scrollQueue.wheelNavigationEnabled).toBe(true);
    store.updateSettingsCategory("scrollQueue", { wheelNavigationEnabled: false });
    expect(useSettingsStore.getState().settings.scrollQueue.wheelNavigationEnabled).toBe(false);
    store.updateSettingsCategory("scrollQueue", { wheelNavigationEnabled: true });
  });
});
