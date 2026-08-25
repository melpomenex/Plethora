import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";

const { submitReviewMock, restoreLearningItemStateMock, previewReviewIntervalsMock, settingsState } = vi.hoisted(() => ({
  submitReviewMock: vi.fn(),
  restoreLearningItemStateMock: vi.fn(),
  previewReviewIntervalsMock: vi.fn(),
  settingsState: {
    learning: {
      algorithm: "fsrs",
      precisionPureKernel: false,
      arenaReviewMode: "choose" as "automatic" | "choose",
      fsrsParams: { desiredRetention: 0.9, maximumInterval: 36500 },
      scopedFsrsOverrides: [],
    },
  },
}));

vi.mock("../../api/review", () => ({
  getDueItems: vi.fn().mockResolvedValue([]),
  submitReview: submitReviewMock,
  restoreLearningItemState: restoreLearningItemStateMock,
  previewReviewIntervals: previewReviewIntervalsMock,
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
      settings: settingsState,
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

const makeArenaPreview = (previewId = "preview-store") => ({
  schema_version: 1,
  preview_id: previewId,
  item_revision: `item-${previewId}`,
  arena_revision: `arena-${previewId}`,
  generated_at: new Date().toISOString(),
  model_order: ["m1", "m2", "m3", "m4", "m5"],
  grades: Array.from({ length: 6 }, (_, grade) => ({
    grade,
    recommendation: { interval_days: grade + 10, due_at: new Date().toISOString() },
    candidates: ["m1", "m2", "m3", "m4", "m5"].map((model_id, index) => ({
      model_id,
      label: model_id.toUpperCase(),
      interval_days: grade + index + 1,
      due_at: new Date().toISOString(),
      weight_percent: [6, 14, 45, 25, 10][index],
      personalized: false,
    })),
    range: { min_days: 1, max_days: 20 },
    custom_bounds: { min_days: 1 / 1_440, max_days: 44_530 },
  })),
});

describe("reviewStore Wave 1 behavior", () => {
  beforeEach(() => {
    submitReviewMock.mockReset();
    restoreLearningItemStateMock.mockReset();
    vi.mocked(getDueItems).mockReset();
    previewReviewIntervalsMock.mockReset();
    previewReviewIntervalsMock.mockResolvedValue({ again: 1, hard: 2, good: 3, easy: 4 });
    settingsState.learning.algorithm = "fsrs";
    settingsState.learning.precisionPureKernel = false;
    settingsState.learning.arenaReviewMode = "choose";
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

  it("removes a deleted card from the active session without resetting progress", () => {
    const first = makeLearningCard({ id: "card-1" });
    const second = makeLearningCard({ id: "card-2" });
    const third = makeLearningCard({ id: "card-3" });
    useReviewStore.setState({
      queue: [first, second, third],
      currentCard: second,
      currentIndex: 1,
      isAnswerShown: true,
      reviewsCompleted: 7,
      correctCount: 5,
      sessionId: "session-in-progress",
    });

    useReviewStore.getState().removeItemFromSession(second.id);

    const state = useReviewStore.getState();
    expect(state.queue.map((card) => card.id)).toEqual(["card-1", "card-3"]);
    expect(state.currentCard?.id).toBe("card-3");
    expect(state.currentIndex).toBe(1);
    expect(state.isAnswerShown).toBe(false);
    expect(state.reviewsCompleted).toBe(7);
    expect(state.correctCount).toBe(5);
    expect(state.sessionId).toBe("session-in-progress");
  });

  it("starts a review session in the exact order supplied by the Review Queue", async () => {
    const first = makeLearningCard({ id: "card-1" });
    const second = makeLearningCard({ id: "card-2" });
    const third = makeLearningCard({ id: "card-3" });
    vi.mocked(getDueItems).mockResolvedValue([first, second, third]);

    await useReviewStore.getState().startReviewWithQueue([
      "card-3",
      "card-1",
      "card-3",
    ]);

    const state = useReviewStore.getState();
    expect(state.queue.map((card) => card.id)).toEqual(["card-3", "card-1"]);
    expect(state.currentCard?.id).toBe("card-3");
    expect(state.currentIndex).toBe(0);
    expect(state.reviewTabMode).toBe("session");
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

  it("holds an eligible Precision grade until the Arena choice commits", async () => {
    settingsState.learning.algorithm = "precision";
    const card = makeLearningCard({ algorithm_type: "precision", algorithm_state: '{"interval":2}' });
    const arena = {
      schema_version: 1,
      preview_id: "preview-1",
      item_revision: "item-rev",
      arena_revision: "arena-rev",
      generated_at: new Date().toISOString(),
      model_order: ["m1", "m2", "m3", "m4", "m5"],
      grades: Array.from({ length: 6 }, (_, grade) => ({
        grade,
        recommendation: { interval_days: grade + 10, due_at: new Date().toISOString() },
        candidates: ["m1", "m2", "m3", "m4", "m5"].map((model_id, index) => ({
          model_id,
          label: model_id.toUpperCase(),
          interval_days: grade + index + 1,
          due_at: new Date().toISOString(),
          weight_percent: [6, 14, 45, 25, 10][index],
          personalized: false,
        })),
        range: { min_days: 1, max_days: 20 },
        custom_bounds: { min_days: 1 / 1440, max_days: 44530 },
      })),
    };
    useReviewStore.setState({
      queue: [card],
      currentCard: card,
      currentIndex: 0,
      reviewMode: "normal",
      sessionStartTime: Date.now() - 1000,
      sessionId: "s1",
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena } as any,
      isAnswerShown: true,
    });

    await useReviewStore.getState().submitRating(3, 4);

    expect(submitReviewMock).not.toHaveBeenCalled();
    expect(useReviewStore.getState().currentCard?.id).toBe("card-1");
    expect(useReviewStore.getState().reviewsCompleted).toBe(0);
    expect(useReviewStore.getState().reviewPhase).toBe("arena-ready");

    submitReviewMock.mockResolvedValue({});
    useReviewStore.getState().selectArenaChoice({ source: "model", modelId: "m5" });
    await useReviewStore.getState().confirmArenaSelection();

    expect(submitReviewMock).toHaveBeenCalledWith(
      "card-1",
      3,
      expect.any(Number),
      "s1",
      expect.objectContaining({
        arenaSelection: expect.objectContaining({
          source: "model",
          model_id: "m5",
          preview_id: "preview-1",
        }),
      }),
    );
    expect(useReviewStore.getState().currentCard).toBeNull();
    expect(useReviewStore.getState().reviewsCompleted).toBe(1);

    const committedSelection = submitReviewMock.mock.calls[0][4].arenaSelection;
    await useReviewStore.getState().undoLastReview();
    expect(restoreLearningItemStateMock).toHaveBeenCalledWith(
      "card-1",
      expect.objectContaining({
        algorithmType: "precision",
        algorithmState: '{"interval":2}',
        arenaCommitId: committedSelection.commit_id,
      }),
    );
    expect(useReviewStore.getState().currentCard?.id).toBe("card-1");
    expect(useReviewStore.getState().reviewsCompleted).toBe(0);
  });

  it("keeps the pending grade, selection, queue, and counters after an Arena commit error", async () => {
    settingsState.learning.algorithm = "precision";
    submitReviewMock.mockRejectedValue(new Error("network offline"));
    const card = makeLearningCard({ algorithm_type: "precision" });
    const gradePreview = {
      grade: 4,
      recommendation: { interval_days: 12, due_at: new Date().toISOString() },
      candidates: ["m1", "m2", "m3", "m4", "m5"].map((model_id, index) => ({
        model_id,
        label: model_id,
        interval_days: index + 4,
        due_at: new Date().toISOString(),
        weight_percent: 20,
        personalized: false,
      })),
      range: { min_days: 4, max_days: 12 },
      custom_bounds: { min_days: 1 / 1440, max_days: 44530 },
    };
    useReviewStore.setState({
      queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "s1", isAnswerShown: true,
      previewIntervals: {
        again: 1, hard: 2, good: 3, easy: 4,
        arena: {
          schema_version: 1, preview_id: "p", item_revision: "i", arena_revision: "a",
          generated_at: new Date().toISOString(), model_order: ["m1", "m2", "m3", "m4", "m5"],
          grades: [gradePreview, gradePreview, gradePreview, gradePreview, gradePreview, gradePreview],
        },
      } as any,
    });

    await useReviewStore.getState().submitRating(3, 4);
    useReviewStore.getState().selectArenaChoice({ source: "custom", intervalDays: 9 });
    await useReviewStore.getState().confirmArenaSelection();

    const state = useReviewStore.getState();
    expect(state.currentCard?.id).toBe("card-1");
    expect(state.queue).toHaveLength(1);
    expect(state.reviewsCompleted).toBe(0);
    expect(state.pendingArenaReview?.selection).toEqual({ source: "custom", intervalDays: 9 });
    expect(state.reviewPhase).toBe("arena-error");

    submitReviewMock.mockResolvedValue({});
    await useReviewStore.getState().confirmArenaSelection();
    expect(useReviewStore.getState().currentCard).toBeNull();
    expect(useReviewStore.getState().reviewsCompleted).toBe(1);
  });

  it("discards a confirmed pending grade on session exit without scheduling it", async () => {
    settingsState.learning.algorithm = "precision";
    const card = makeLearningCard({ algorithm_type: "precision" });
    useReviewStore.setState({
      queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "exit", isAnswerShown: true,
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena: makeArenaPreview() } as any,
    });

    await useReviewStore.getState().submitRating(3, 4);
    expect(useReviewStore.getState().pendingArenaReview).not.toBeNull();
    useReviewStore.getState().cancelArenaDecision();
    useReviewStore.getState().resetSession();

    expect(submitReviewMock).not.toHaveBeenCalled();
    expect(useReviewStore.getState().pendingArenaReview).toBeNull();
    expect(useReviewStore.getState().queue).toEqual([]);
    expect(useReviewStore.getState().reviewsCompleted).toBe(0);
  });

  it("keeps Pure M4 and non-Precision reviews on the direct scheduler path", async () => {
    submitReviewMock.mockResolvedValue({});
    for (const [algorithm, pureM4] of [["fsrs", false], ["precision", true]] as const) {
      settingsState.learning.algorithm = algorithm;
      settingsState.learning.precisionPureKernel = pureM4;
      const card = makeLearningCard({ id: `card-${algorithm}-${pureM4}`, algorithm_type: algorithm });
      useReviewStore.setState({
        queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
        sessionStartTime: Date.now(), sessionId: "direct", isAnswerShown: true,
        previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena: makeArenaPreview() } as any,
      });

      await useReviewStore.getState().submitRating(3, 4);

      expect(useReviewStore.getState().pendingArenaReview).toBeNull();
      expect(submitReviewMock).toHaveBeenCalledTimes(1);
      submitReviewMock.mockClear();
    }
  });

  it("commits Arena Pick immediately in the default automatic mode", async () => {
    settingsState.learning.algorithm = "precision";
    settingsState.learning.arenaReviewMode = "automatic";
    submitReviewMock.mockResolvedValue({});
    const card = makeLearningCard({ algorithm_type: "precision", extract_id: "automatic" });
    const arena = makeArenaPreview("automatic");
    useReviewStore.setState({
      queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "automatic", isAnswerShown: true,
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena } as any,
    });

    await useReviewStore.getState().submitRating(3, 4);

    expect(useReviewStore.getState().pendingArenaReview).toBeNull();
    expect(useReviewStore.getState().reviewsCompleted).toBe(1);
    expect(submitReviewMock).toHaveBeenCalledWith(
      "card-1",
      3,
      expect.any(Number),
      "automatic",
      expect.objectContaining({
        arenaSelection: expect.objectContaining({
          preview_id: "automatic-fallback",
          source: "arena",
          decision_time_ms: 0,
        }),
        arenaProvenance: expect.objectContaining({ schedule_source: "arena" }),
      }),
    );
  });

  it("uses the authoritative automatic fallback when preview is not ready", async () => {
    settingsState.learning.algorithm = "precision";
    settingsState.learning.arenaReviewMode = "automatic";
    submitReviewMock.mockResolvedValue({});
    const card = makeLearningCard({ algorithm_type: "precision", extract_id: "fallback" });
    useReviewStore.setState({
      queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "fallback", isAnswerShown: true,
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4 } as any,
    });

    await useReviewStore.getState().submitRating(3, 4);

    expect(submitReviewMock.mock.calls[0][4].arenaSelection).toMatchObject({
      preview_id: "automatic-fallback",
      source: "arena",
      decision_time_ms: 0,
    });
    expect(useReviewStore.getState().pendingArenaReview).toBeNull();
  });

  it("locks queue navigation until Back to rating discards the pending grade", async () => {
    settingsState.learning.algorithm = "precision";
    const first = makeLearningCard({ id: "card-1", extract_id: "one" });
    const second = makeLearningCard({ id: "card-2", extract_id: "two" });
    useReviewStore.setState({
      queue: [first, second], currentCard: first, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "locked", isAnswerShown: true,
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena: makeArenaPreview() } as any,
    });
    await useReviewStore.getState().submitRating(3, 4);

    useReviewStore.getState().nextCard();
    useReviewStore.getState().goToIndex(1);
    expect(useReviewStore.getState().currentCard?.id).toBe("card-1");
    expect(useReviewStore.getState().currentIndex).toBe(0);

    useReviewStore.getState().cancelArenaDecision();
    expect(useReviewStore.getState().reviewPhase).toBe("answer");
    expect(useReviewStore.getState().isAnswerShown).toBe(true);
    useReviewStore.getState().goToIndex(1);
    expect(useReviewStore.getState().currentCard?.id).toBe("card-2");
  });

  it("refreshes a stale preview while preserving the uncommitted selection", async () => {
    settingsState.learning.algorithm = "precision";
    const card = makeLearningCard({ algorithm_type: "precision", extract_id: "stale" });
    const initialArena = makeArenaPreview("initial");
    const refreshedArena = makeArenaPreview("refreshed");
    previewReviewIntervalsMock.mockResolvedValue({
      again: 1, hard: 2, good: 3, easy: 4, arena: refreshedArena,
    });
    submitReviewMock.mockRejectedValue(new Error("arena_preview_stale: collection changed"));
    useReviewStore.setState({
      queue: [card], currentCard: card, currentIndex: 0, reviewMode: "normal",
      sessionStartTime: Date.now(), sessionId: "stale", isAnswerShown: true,
      previewIntervals: { again: 1, hard: 2, good: 3, easy: 4, arena: initialArena } as any,
    });
    await useReviewStore.getState().submitRating(3, 4);
    useReviewStore.getState().selectArenaChoice({ source: "model", modelId: "m3" });
    await useReviewStore.getState().confirmArenaSelection();

    await vi.waitFor(() => {
      expect(useReviewStore.getState().previewIntervals?.arena?.preview_id).toBe("refreshed");
    });
    expect(useReviewStore.getState().pendingArenaReview?.selection).toEqual({
      source: "model",
      modelId: "m3",
    });
    expect(useReviewStore.getState().reviewPhase).toBe("arena-ready");
    expect(useReviewStore.getState().reviewsCompleted).toBe(0);
  });
});
