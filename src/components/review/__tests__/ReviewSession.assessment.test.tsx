/**
 * Scheduling-authority tests for the free-response integration (task 5.8,
 * spec flashcard-review-session "Scheduling semantics unchanged by
 * assessment"): the `submitReview` payload is IDENTICAL with and without an
 * assessment present, and the assessment is stored by a separate invoke
 * after grading.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "../ReviewSession";
import { useReviewStore } from "../../../stores/reviewStore";
import { useSettingsStore } from "../../../stores/settingsStore";

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

const { submitReview, getDueItems, recordAnswerAssessment } = vi.hoisted(() => ({
  submitReview: vi.fn(),
  getDueItems: vi.fn(),
  recordAnswerAssessment: vi.fn(),
}));

vi.mock("../../../api/review", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    submitReview,
    getDueItems,
  };
});

vi.mock("../../../api/queue", () => ({
  bulkDeleteItems: vi.fn(),
  bulkSuspendItems: vi.fn(),
}));

vi.mock("../../../api/answer-assessment", () => ({
  recordAnswerAssessment,
}));

const availability = { available: true, loading: false, path: "ondevice" as const };
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => availability,
}));

const runAssessAnswer = vi.fn();
vi.mock("../../../lib/ai/tasks/definitions/assessmentTask", () => ({
  runAssessAnswer: (...args: unknown[]) => runAssessAnswer(...args),
}));

const makeCard = (id: string) =>
  ({
    id,
    item_type: "basic",
    question: `Question ${id}?`,
    answer: `answer-${id}`,
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

function seedSession() {
  const card = makeCard("card-1");
  useReviewStore.setState({
    queue: [card, makeCard("card-2")],
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
  return card;
}

function setFlags(features: { aiAnswerAssessment?: boolean; aiAutoGradeSuggest?: boolean }) {
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      features: { ...state.settings.features, ...features },
    },
  }));
}

async function gradeGood() {
  fireEvent.click(await screen.findByRole("button", { name: /show answer/i }));
  const good = await waitFor(() => {
    const button = document.querySelector('[data-review-rating="3"]') as HTMLElement | null;
    expect(button).not.toBeNull();
    return button!;
  });
  fireEvent.click(good);
  await waitFor(() => expect(submitReview).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  submitReview.mockImplementation(async (itemId: string) => makeCard(itemId));
  recordAnswerAssessment.mockResolvedValue({});
  availability.available = true;
  availability.loading = false;
  setFlags({});
});

describe("scheduling is unchanged by assessment (spec scenario)", () => {
  it("submits exactly the same submitReview payload without an assessment", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: false });
    render(<ReviewSession onExit={vi.fn()} />);

    await gradeGood();

    expect(submitReview).toHaveBeenCalledTimes(1);
    const [itemId, rating, , sessionId] = submitReview.mock.calls[0];
    expect(itemId).toBe("card-1");
    expect(rating).toBe(3);
    expect(sessionId).toBe("session-1");
    expect(recordAnswerAssessment).not.toHaveBeenCalled();
    expect(runAssessAnswer).not.toHaveBeenCalled();
  });

  it("keeps the identical submitReview payload WITH an assessed free response", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: true });
    runAssessAnswer.mockResolvedValue({
      assessment: {
        classification: "partial",
        score: 0.5,
        completeness: 0.4,
        missingConcepts: ["page table"],
        feedback: "partly there",
        suggestedCorrection: "also mention paging",
        confidence: 0.9,
      },
      run: { providerId: "fake-ondevice", baseModelName: null },
    });
    render(<ReviewSession onExit={vi.fn()} />);

    // Optional free-response input is present and skippable-by-default.
    const field = await screen.findByLabelText(/answer from memory first/i);
    fireEvent.change(field, { target: { value: "because disk" } });

    await gradeGood();

    // Same scheduling inputs as the feature-off run.
    expect(submitReview).toHaveBeenCalledTimes(1);
    const [itemId, rating, , sessionId, options] = submitReview.mock.calls[0];
    expect(itemId).toBe("card-1");
    expect(rating).toBe(3);
    expect(sessionId).toBe("session-1");
    // The options bag carries scheduling parameters only — no assessment
    // payload ever rides along the review submission.
    expect(Object.keys(options ?? {}).sort()).toEqual(
      ["algorithm", "arenaProvenance", "arenaSelection", "desiredRetention", "fsrsWeights", "grade", "noScheduleUpdate", "sm20PureM4"].sort()
    );

    // Assessment ran on reveal and was persisted separately AFTER grading.
    expect(runAssessAnswer).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(recordAnswerAssessment).toHaveBeenCalledTimes(1));
    expect(recordAnswerAssessment).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "card-1", provider: "fake-ondevice" })
    );
  });

  it("records nothing when the free response was skipped (skippable input)", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: true });
    render(<ReviewSession onExit={vi.fn()} />);

    await gradeGood();

    expect(runAssessAnswer).not.toHaveBeenCalled();
    expect(recordAnswerAssessment).not.toHaveBeenCalled();
  });

  it("flag on but no provider: identical flow, no input, no errors", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: true });
    availability.available = false;
    const { container } = render(<ReviewSession onExit={vi.fn()} />);

    expect(container.querySelector("[data-free-response-input]")).toBeNull();
    await gradeGood();
    expect(recordAnswerAssessment).not.toHaveBeenCalled();
    expect(submitReview).toHaveBeenCalledTimes(1);
  });
});

describe("auto-grade suggestion is advisory only (flag off by default)", () => {
  it("highlights the suggested rating button only when the flag is on", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: true, aiAutoGradeSuggest: true });
    runAssessAnswer.mockResolvedValue({
      assessment: {
        classification: "incorrect",
        score: 0,
        completeness: 0,
        missingConcepts: [],
        feedback: "not quite",
        confidence: 0.95,
      },
      run: { providerId: "fake-ondevice", baseModelName: null },
    });
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText(/answer from memory first/i), {
      target: { value: "compression" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /show answer/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/not quite/i).length).toBeGreaterThan(0)
    );

    // Highlight present on Exactly the "Again" button; nothing auto-clicked.
    const suggested = document.querySelectorAll("[data-suggested='true']");
    await waitFor(() => expect(suggested.length).toBeGreaterThan(0));
    expect(suggested).toHaveLength(1);
    expect((suggested[0] as HTMLElement).getAttribute("data-review-rating")).toBe("1");
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("no highlight when aiAutoGradeSuggest is off (default)", async () => {
    seedSession();
    setFlags({ aiAnswerAssessment: true, aiAutoGradeSuggest: false });
    runAssessAnswer.mockResolvedValue({
      assessment: {
        classification: "incorrect",
        score: 0,
        completeness: 0,
        missingConcepts: [],
        feedback: "not quite",
        confidence: 0.95,
      },
      run: { providerId: "fake-ondevice", baseModelName: null },
    });
    render(<ReviewSession onExit={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText(/answer from memory first/i), {
      target: { value: "compression" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /show answer/i }));
    await waitFor(() => expect(screen.getAllByText(/not quite/i).length).toBeGreaterThan(0));

    expect(document.querySelectorAll("[data-suggested='true']")).toHaveLength(0);
  });
});
