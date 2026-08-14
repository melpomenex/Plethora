import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewSession } from "../ReviewSession";
import { useReviewStore } from "../../../stores/reviewStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { ToastType } from "../../common/Toast";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    pause: vi.fn(),
    resume: vi.fn(),
    isSupported: false,
  }),
}));

vi.mock("../../../hooks/useAudioReviewMode", () => ({
  useAudioReviewMode: () => ({
    isEnabled: false,
    isSupported: false,
    enable: vi.fn(),
    disable: vi.fn(),
    toggle: vi.fn(),
    status: "idle",
    onUserAdvance: vi.fn(),
    lastError: null,
  }),
}));

const { updateLearningItemContentWithVersion, updateLearningItemTags, getDueItems } =
  vi.hoisted(() => ({
    updateLearningItemContentWithVersion: vi.fn(),
    updateLearningItemTags: vi.fn(),
    getDueItems: vi.fn(),
  }));

vi.mock("../../../api/learning-items", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    updateLearningItemContentWithVersion,
    updateLearningItemTags,
  };
});

vi.mock("../../../api/review", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    getDueItems,
  };
});

vi.mock("../../../api/queue", () => ({
  bulkDeleteItems: vi.fn(),
  bulkSuspendItems: vi.fn(),
}));

const makeCard = (id: string, question: string) =>
  ({
    id,
    item_type: "basic",
    question,
    answer: "answer-" + id,
    difficulty: 3,
    interval: 1,
    ease_factor: 2.5,
    due_date: new Date().toISOString(),
    date_created: new Date().toISOString(),
    date_modified: new Date().toISOString(),
    review_count: 1,
    lapses: 0,
    state: "review",
    is_suspended: false,
    tags: [],
  }) as any;

function seedSession(card = makeCard("card-1", "Question one?")) {
  const queue = [card, makeCard("card-2", "Question two?")];
  useReviewStore.setState({
    queue,
    currentIndex: 0,
    currentCard: card,
    isLoading: false,
    isAnswerShown: false,
    isSubmitting: false,
    error: null,
    sessionId: "session-1",
    sessionStartTime: Date.now(),
    reviewsCompleted: 0,
    correctCount: 0,
    averageTimePerCard: 0,
    pendingArenaReview: null,
    previewIntervals: null,
    streak: null,
    canUndoLastReview: false,
  });
  return { card, queue };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      general: { ...state.settings.general, language: "en" },
    },
  }));
  updateLearningItemContentWithVersion.mockResolvedValue(undefined);
  updateLearningItemTags.mockResolvedValue(undefined);
});

describe("ReviewSession edit-during-review", () => {
  it("opens the inline editor via Cmd/Ctrl+E instead of the placeholder toast", async () => {
    seedSession();
    render(<ReviewSession onExit={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "e", metaKey: true });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit Card")).toBeInTheDocument();
  });

  it("opens the editor from the on-card edit control", async () => {
    seedSession();
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("review-card-edit"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("patches the in-flight card on save without reloading the queue", async () => {
    const { queue } = seedSession();
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.keyDown(document.body, { key: "e", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("Question one?"), {
      target: { value: "Edited question?" },
    });
    fireEvent.click(within(dialog).getByTestId("inline-card-editor-save"));

    await waitFor(() => {
      expect(useReviewStore.getState().currentCard?.question).toBe("Edited question?");
    });
    const state = useReviewStore.getState();
    // In-place patch: same position, same queue length, no reload.
    expect(state.currentIndex).toBe(0);
    expect(state.queue).toHaveLength(2);
    expect(state.queue[0].question).toBe("Edited question?");
    expect(state.queue[1].question).toBe("Question two?");
    expect(getDueItems).not.toHaveBeenCalled();
    // The editor closes after a successful save.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rolls the card back when persistence fails", async () => {
    seedSession();
    updateLearningItemContentWithVersion.mockRejectedValue(new Error("disk error"));
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.keyDown(document.body, { key: "e", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("Question one?"), {
      target: { value: "Doomed edit?" },
    });
    fireEvent.click(within(dialog).getByTestId("inline-card-editor-save"));

    await waitFor(() =>
      expect(useReviewStore.getState().currentCard?.question).toBe("Question one?")
    );
    expect(useReviewStore.getState().queue[0].question).toBe("Question one?");
  });

  it("keeps the editor closed while a submission is in flight", () => {
    seedSession();
    useReviewStore.setState({ isSubmitting: true });
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.keyDown(document.body, { key: "e", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The on-card control is disabled for the same window.
    expect(screen.getByTestId("review-card-edit")).toBeDisabled();
  });

  it("closes the editor on Escape without touching the session", () => {
    seedSession();
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.keyDown(document.body, { key: "e", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useReviewStore.getState().currentCard?.question).toBe("Question one?");
  });
});

describe("reviewStore.patchCurrentCard", () => {
  it("replaces the current card and its queue entry only", () => {
    const card = makeCard("card-1", "Question one?");
    seedSession(card);

    const updated = { ...card, question: "Patched?" } as any;
    useReviewStore.getState().patchCurrentCard(updated);

    const state = useReviewStore.getState();
    expect(state.currentCard).toBe(updated);
    expect(state.queue[0]).toBe(updated);
    expect(state.queue[1].question).toBe("Question two?");
    expect(state.currentIndex).toBe(0);
    expect(state.isSubmitting).toBe(false);
  });

  it("falls back to replacing only the visible card when the queue has moved on", () => {
    const card = makeCard("card-1", "Question one?");
    seedSession(card);
    // Simulate a rating landing between open and save: the queue advanced and
    // the edited card is no longer the entry at currentIndex.
    const other = makeCard("card-2", "Question two?");
    useReviewStore.setState({ queue: [other], currentIndex: 0, currentCard: other });

    const updated = { ...card, question: "Patched?" } as any;
    useReviewStore.getState().patchCurrentCard(updated);

    const state = useReviewStore.getState();
    expect(state.currentCard).toBe(updated);
    expect(state.queue[0]).toBe(other);
  });
});
