import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";

const { submitReviewMock, restoreLearningItemStateMock } = vi.hoisted(() => ({
  submitReviewMock: vi.fn(),
  restoreLearningItemStateMock: vi.fn(),
}));

vi.mock("../../api/review", () => ({
  getDueItems: vi.fn().mockResolvedValue([]),
  submitReview: submitReviewMock,
  restoreLearningItemState: restoreLearningItemStateMock,
  previewReviewIntervals: vi.fn().mockResolvedValue({ again: 1, hard: 2, good: 3, easy: 4 }),
  getReviewStreak: vi.fn().mockResolvedValue({
    current_streak: 0,
    longest_streak: 0,
    total_reviews: 0,
  }),
  startReview: vi.fn().mockResolvedValue("session"),
}));

vi.mock("../collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({
      activeCollectionId: null,
      documentAssignments: {},
    }),
  },
}));

vi.mock("../studyDeckStore", () => ({
  useStudyDeckStore: {
    getState: () => ({
      activeDeckIds: [],
      decks: [],
    }),
  },
}));

vi.mock("../settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        learning: {
          fsrsParams: { desiredRetention: 0.9, maximumInterval: 36500 },
          scopedFsrsOverrides: [],
        },
      },
    }),
  },
}));

vi.mock("../../lib/sync-client", () => ({
  getUser: vi.fn(() => null),
}));

import { getDueItems } from "../../api/review";
import { useReviewStore } from "../reviewStore";

beforeAll(() => {
  const data = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
});

const makeLearningCard = (overrides: Partial<any> = {}) => ({
  id: "card-1",
  item_type: "flashcard" as const,
  question: "Q",
  answer: "A",
  difficulty: 3,
  interval: 2,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 2,
  lapses: 0,
  state: "review" as const,
  is_suspended: false,
  tags: ["biology"],
  extract_id: "extract-1",
  ...overrides,
});

describe("reviewStore Wave 1 behavior", () => {
  beforeEach(() => {
    submitReviewMock.mockReset();
    restoreLearningItemStateMock.mockReset();
    vi.mocked(getDueItems).mockReset();
    window.localStorage.clear();
    useReviewStore.getState().resetSession();
  });

  it("does not mutate scheduling in cram mode", async () => {
    const card = makeLearningCard();
    useReviewStore.setState({
      queue: [card],
      currentCard: card,
      currentIndex: 0,
      reviewMode: "cram",
      sessionStartTime: Date.now() - 1000,
      sessionId: "s1",
    });

    await useReviewStore.getState().submitRating(3);

    expect(submitReviewMock).not.toHaveBeenCalled();
  });

  it("buries sibling cards from the same extract in the active session", async () => {
    submitReviewMock.mockResolvedValue({});
    const first = makeLearningCard({ id: "card-1", extract_id: "extract-a" });
    const sibling = makeLearningCard({ id: "card-2", extract_id: "extract-a" });
    const other = makeLearningCard({ id: "card-3", extract_id: "extract-b" });

    useReviewStore.setState({
      queue: [first, sibling, other],
      currentCard: first,
      currentIndex: 0,
      reviewMode: "normal",
      sessionStartTime: Date.now() - 1000,
      sessionId: "s1",
    });

    await useReviewStore.getState().submitRating(3);

    const remainingIds = useReviewStore.getState().queue.map((item) => item.id);
    expect(remainingIds).toEqual(["card-3"]);
  });

  it("records per-review metadata payloads", async () => {
    submitReviewMock.mockResolvedValue({});
    const card = makeLearningCard();
    useReviewStore.setState({
      queue: [card],
      currentCard: card,
      currentIndex: 0,
      reviewMode: "normal",
      sessionStartTime: Date.now() - 1000,
      sessionId: "s1",
    });

    useReviewStore.getState().setPendingReviewMetadata({
      hintsUsed: 2,
      typedMode: "fuzzy",
      typedCorrect: true,
      typedSimilarity: 0.91,
    });

    await useReviewStore.getState().submitRating(4);
    const last = useReviewStore.getState().reviewEventLog.at(-1);
    expect(last?.metadata).toEqual({
      hintsUsed: 2,
      typedMode: "fuzzy",
      typedCorrect: true,
      typedSimilarity: 0.91,
    });
  });

  it("loadQueue populates the queue only with due flashcards, never documents", async () => {
    // getDueItems returns flashcards; documents would have come from a separate
    // stream that the review session no longer touches.
    vi.mocked(getDueItems).mockResolvedValue([
      makeLearningCard({ id: "card-1", extract_id: "extract-a" }),
      makeLearningCard({ id: "card-2", extract_id: "extract-b" }),
    ]);

    await useReviewStore.getState().loadQueue();

    const state = useReviewStore.getState();
    expect(state.queue).toHaveLength(2);
    expect(state.queue.every((item) => item.id.startsWith("card-"))).toBe(true);
    expect(state.queue.some((item) => (item as any).itemType === "document")).toBe(false);
    expect(state.currentCard?.id).toBe("card-1");
    // Answer is never auto-revealed (that was document-only behavior).
    expect(state.isAnswerShown).toBe(false);
  });

  it("loadQueue yields an empty queue when no flashcards are due, with no document padding", async () => {
    vi.mocked(getDueItems).mockResolvedValue([]);

    await useReviewStore.getState().loadQueue();

    const state = useReviewStore.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.currentCard).toBeNull();
    expect(state.sessionId).toBe("");
  });

  it("submitRating routes learning cards through the flashcard scheduler", async () => {
    submitReviewMock.mockResolvedValue({});
    const card = makeLearningCard();
    useReviewStore.setState({
      queue: [card],
      currentCard: card,
      currentIndex: 0,
      reviewMode: "normal",
      sessionStartTime: Date.now() - 1000,
      sessionId: "s1",
    });

    await useReviewStore.getState().submitRating(4);

    expect(submitReviewMock).toHaveBeenCalledWith(
      "card-1",
      4,
      expect.any(Number),
      "s1",
      expect.objectContaining({ noScheduleUpdate: false })
    );
  });
});
