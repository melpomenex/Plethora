/**
 * Tests for the review-session queue list's viewport behaviour
 * (`ReviewSession`).
 *
 * The reported symptom was a queue list that drew off-screen to the left on a
 * phone. It was `absolute right-0 w-80` anchored to a control that could sit
 * anywhere in a wrapping header row, so at phone widths the 320px panel landed
 * at a negative x under `z-50` — present in the DOM, invisible on screen.
 *
 * The guarantee is structural, so it is asserted from the classes: on a phone
 * the panel is anchored to the viewport, on desktop it is clamped.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { getDueItems } = vi.hoisted(() => ({ getDueItems: vi.fn() }));

vi.mock("../../../api/review", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDueItems,
}));

vi.mock("../../../api/learning-items", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateLearningItemContentWithVersion: vi.fn(),
  updateLearningItemTags: vi.fn(),
}));

vi.mock("../../../api/queue", () => ({
  bulkDeleteItems: vi.fn(),
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
  bulkDeleteItemsByFilter: vi.fn(),
}));

const isMobileMock = vi.fn(() => false);
vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => isMobileMock(),
}));

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

import { ReviewSession } from "../ReviewSession";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useReviewStore } from "../../../stores/reviewStore";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as never,
});

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
  }) as never;

function seedSession() {
  const first = makeCard("card-1", "First card?");
  useReviewStore.setState({
    queue: [first, makeCard("card-2", "Second card?")],
    currentIndex: 0,
    currentCard: first,
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
}

/**
 * The queue-list panel.
 *
 * Located via the list rows, which carry a "1 / 2" index line. The nav controls
 * also show "1 / 2", so the row lookup is restricted to buttons whose text
 * contains a question mark — the rows always do, the readout never does.
 */
function queuePanel(): HTMLElement {
  const row = screen
    .getAllByRole("button")
    .find((b) => /\d+ \/ \d+/.test(b.textContent || "") && /\?/.test(b.textContent || ""));
  if (!row) throw new Error("queue list not open");
  let node = row.parentElement;
  while (node && !/bg-card/.test(node.className)) node = node.parentElement;
  if (!node) throw new Error("queue panel not found");
  return node as HTMLElement;
}

/** True when the queue list is open. */
function queueListIsOpen(): boolean {
  return screen
    .queryAllByRole("button")
    .some((b) => /\d+ \/ \d+/.test(b.textContent || "") && /\?/.test(b.textContent || ""));
}

async function openQueueList() {
  seedSession();
  render(<ReviewSession onExit={vi.fn()} />);
  const toggle = await screen.findByRole("button", { name: /queue/i });
  fireEvent.click(toggle);
  await waitFor(queueListIsOpen);
}

beforeEach(() => {
  vi.clearAllMocks();
  isMobileMock.mockReturnValue(false);
  getDueItems.mockResolvedValue({ items: [], total: 0 });
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      general: { ...state.settings.general, language: "en" },
    },
  }));
});

describe("ReviewSession — queue list stays within the viewport", () => {
  it("anchors the list to the viewport on a phone", async () => {
    isMobileMock.mockReturnValue(true);
    await openQueueList();

    const panel = queuePanel();
    // Viewport-anchored: `fixed` plus horizontal insets, so it cannot land at a
    // negative x no matter where its toggle sits.
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("inset-x-0");
    // The old fixed 320px width is gone.
    expect(panel.className).not.toContain("w-80");
  });

  it("keeps the desktop dropdown clamped rather than a bare fixed width", async () => {
    isMobileMock.mockReturnValue(false);
    await openQueueList();

    const panel = queuePanel();
    expect(panel.className).toContain("absolute");
    // Clamped so it can never exceed the pane it opens in.
    expect(panel.className).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("closes the phone sheet on Escape", async () => {
    isMobileMock.mockReturnValue(true);
    await openQueueList();
    expect(queueListIsOpen()).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(queueListIsOpen()).toBe(false));
  });

  it("closes the phone sheet on a scrim tap", async () => {
    isMobileMock.mockReturnValue(true);
    await openQueueList();

    const scrim = document.querySelector(".fixed.inset-0.z-40") as HTMLElement;
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim);

    await waitFor(() => expect(queueListIsOpen()).toBe(false));
  });

  it("offers a labelled close control in the phone sheet", async () => {
    isMobileMock.mockReturnValue(true);
    await openQueueList();

    // Scoped to the sheet: the card itself has other close controls.
    const close = within(queuePanel()).getByRole("button", { name: /close/i });
    fireEvent.click(close);

    await waitFor(() => expect(queueListIsOpen()).toBe(false));
  });
});
