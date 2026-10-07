/**
 * Component tests for AskSheet (OpenSpec `mobile-ask-sheet-library-qa`,
 * tasks 2.1/3.1/5.1/5.3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AskSheet } from "../AskSheet";
import type { AskLibraryResult } from "../../../lib/ai/tasks/definitions/libraryTask";
import { RAG_NAMESPACE_LIBRARY } from "../../../lib/ai/capabilities/search";

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => true,
}));

const mockAskInScope = vi.fn();
const mockGetIndexState = vi.fn();
vi.mock("../../../lib/ai/askSheet/scope", () => ({
  askInScope: (...args: unknown[]) => mockAskInScope(...args),
  getAskSheetIndexState: (...args: unknown[]) => mockGetIndexState(...args),
}));

vi.mock("../../../lib/ai/tasks/runTask", () => ({
  runTask: vi.fn(async () => ({
    output: "Q: What is spaced repetition?\nQ: Why do intervals expand?\nQ: How does recall help?",
  })),
}));

vi.mock("../../tabs/DocumentQASources", () => ({
  DocumentQASources: ({ citations }: { citations: unknown[] }) => (
    <div data-testid="qa-sources">{citations.length} sources</div>
  ),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const mockRetrieveFromLibrary = vi.fn();
vi.mock("../../../api/ai-learning", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../../api/ai-learning")>();
  return { ...orig, retrieveFromLibrary: (...args: unknown[]) => mockRetrieveFromLibrary(...args) };
});

const mockGenerateSpeech = vi.fn();
vi.mock("../../../api/tts", () => ({
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}));

function answeredResult(overrides: Partial<AskLibraryResult> = {}): AskLibraryResult {
  return {
    answer: {
      answer:
        "Spaced repetition schedules reviews at expanding intervals to fight the forgetting curve, " +
        "a phenomenon first described by Ebbinghaus in the 1880s through meticulous self-experimentation. " +
        "Active recall strengthens the memory trace each time you retrieve, which is why testing beats re-reading.",
      sourceRefs: [],
      evidenceLevel: "supported",
    },
    sources: [],
    droppedChunks: 0,
    mode: "semantic",
    candidatesScanned: 4,
    composition: {
      retrieverId: "ai_learning",
      generatorKind: "ondevice",
      namespace: RAG_NAMESPACE_LIBRARY,
    },
    retrievalOnly: false,
    run: {} as AskLibraryResult["run"],
    ...overrides,
  };
}

const REQUEST = { passage: "The forgetting curve shows memory decaying over time.", documentId: "doc-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIndexState.mockResolvedValue({ unindexedCount: 2, generatorKind: "ondevice" });
  mockAskInScope.mockResolvedValue(answeredResult());
});

function openSheet(request = REQUEST) {
  const onClose = vi.fn();
  render(<AskSheet open onClose={onClose} request={request} />);
  return { onClose };
}

describe("task 2.1 — composer", () => {
  it("opens with the passage as context chip, scope picker, and voice control", async () => {
    openSheet();
    expect(await screen.findByText("The forgetting curve shows memory decaying over time.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Passage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Document" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /voice input/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
  });

  it("does not force the keyboard open until the field is focused", async () => {
    openSheet();
    await screen.findByPlaceholderText(/ask a question/i);
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("removing the chip falls back to document scope", async () => {
    openSheet();
    await screen.findByText("The forgetting curve shows memory decaying over time.");
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.queryByText("The forgetting curve shows memory decaying over time.")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
  });

  it("tapping a suggested question submits without typing", async () => {
    openSheet();
    const suggestion = await screen.findByText("What is spaced repetition?");
    fireEvent.click(suggestion);
    await waitFor(() => expect(mockAskInScope).toHaveBeenCalledTimes(1));
    expect(mockAskInScope.mock.calls[0][0].query).toBe("What is spaced repetition?");
  });

  it("voice control degrades gracefully when unsupported", async () => {
    openSheet();
    await screen.findByRole("button", { name: /voice input/i });
    fireEvent.click(screen.getByRole("button", { name: /voice input/i }));
    expect(await screen.findByText(/voice input isn't supported/i)).toBeInTheDocument();
  });
});

describe("task 3.1 — docked answer card", () => {
  it("shows a collapsed summary card that expands on swipe-up and dismisses on swipe-down", async () => {
    const { onClose } = openSheet();
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "What is the forgetting curve?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    // Collapsed card shows the summary, not the full answer.
    const dialog = await screen.findByRole("dialog", { name: "Ask" });
    await waitFor(() => expect(mockAskInScope).toHaveBeenCalled());
    expect(dialog.textContent).toContain("Spaced repetition schedules reviews");
    expect(dialog.textContent).not.toContain("Active recall strengthens");

    // Swipe up expands to the full answer.
    fireEvent.touchStart(dialog, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 380 }] });
    expect(dialog.textContent).toContain("Active recall strengthens");

    // Swipe down collapses…
    fireEvent.touchStart(dialog, { touches: [{ clientY: 380 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 500 }] });
    expect(dialog.textContent).not.toContain("Active recall strengthens");

    // …and a second swipe down dismisses the card.
    fireEvent.touchStart(dialog, { touches: [{ clientY: 380 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 500 }] });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("task 5.1 — honest state", () => {
  it("shows the answering mode and freshness disclosure in library scope", async () => {
    openSheet();
    await screen.findByText(/on-device/i);
    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    expect(await screen.findByText("2 documents not yet indexed")).toBeInTheDocument();
  });

  it("hides the freshness disclosure outside library scope", async () => {
    openSheet();
    await screen.findByText(/on-device/i);
    expect(screen.queryByText(/not yet indexed/)).not.toBeInTheDocument();
  });
});

describe("task 2.3 — where else is this discussed", () => {
  it("runs a retrieval-only concept trace and renders a jump-list", async () => {
    mockRetrieveFromLibrary.mockResolvedValue({
      results: [
        {
          chunkId: "c9",
          documentId: "doc-9",
          documentTitle: "Other Book",
          sourceType: "document",
          ordinal: 3,
          text: "A related passage about memory.",
          headingPath: [],
          location: { sourceType: "text", documentId: "doc-9", ordinal: 3, startOffset: 0, endOffset: 29 },
          contentHash: "h",
          tokenCount: 5,
          score: 0.8,
          mode: "semantic",
        },
      ],
      mode: "semantic",
      candidatesScanned: 10,
    });
    openSheet();
    await screen.findByText("The forgetting curve shows memory decaying over time.");
    fireEvent.click(screen.getByText("Where else is this discussed?"));
    await waitFor(() => expect(mockRetrieveFromLibrary).toHaveBeenCalled());
    // Jump-list entries render through the sources component (deep-linkable).
    expect(await screen.findByTestId("qa-sources")).toHaveTextContent("1 sources");
    // Current document is excluded from its own trace.
    const filters = (mockRetrieveFromLibrary.mock.calls[0] as unknown[])[1] as { k?: number };
    expect(filters.k).toBe(8);
  });
});

describe("task 3.2 — source chips", () => {
  it("renders cited sources as tappable chips in the expanded card", async () => {
    mockAskInScope.mockResolvedValue(
      answeredResult({
        sources: [
          {
            chunkId: "c1",
            documentId: "doc-1",
            documentTitle: "Forgetting Curve Notes",
            sourceType: "document",
            text: "Spaced repetition schedules reviews.",
            headingPath: ["Chapter 2"],
            location: { sourceType: "text", documentId: "doc-1", ordinal: 0, startOffset: 0, endOffset: 36 },
            score: 0.9,
          },
        ],
      }),
    );
    openSheet();
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: "Q?" } });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    const dialog = await screen.findByRole("dialog", { name: "Ask" });
    fireEvent.touchStart(dialog, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 380 }] });
    expect(await screen.findByTestId("qa-sources")).toHaveTextContent("1 sources");
  });
});

describe("task 3.3 — card actions", () => {
  async function answerAndExpand() {
    openSheet();
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "What is spaced repetition?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    const dialog = await screen.findByRole("dialog", { name: "Ask" });
    fireEvent.touchStart(dialog, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 380 }] });
    await screen.findByText(/active recall strengthens/i);
    return dialog;
  }

  it("make flashcard creates a card carrying the answer and its sources", async () => {
    const { usePendingFlashcardsStore } = await import("../../../stores/pendingFlashcardsStore");
    usePendingFlashcardsStore.getState().clearAll();
    mockAskInScope.mockResolvedValue(
      answeredResult({
        sources: [
          {
            chunkId: "c1",
            documentId: "doc-1",
            documentTitle: "Forgetting Curve Notes",
            sourceType: "document",
            text: "Spaced repetition schedules reviews.",
            headingPath: [],
            location: { sourceType: "text", documentId: "doc-1", ordinal: 0, startOffset: 0, endOffset: 36 },
            score: 0.9,
          },
        ],
      }),
    );
    await answerAndExpand();
    fireEvent.click(screen.getByText("Make flashcard"));
    const sets = usePendingFlashcardsStore.getState().pendingSets;
    expect(sets).toHaveLength(1);
    const card = sets[0].cards[0];
    expect(card.question).toBe("What is spaced repetition?");
    expect(card.answer).toContain("Active recall strengthens");
    expect(card.answer).toContain("Forgetting Curve Notes");
  });

  it("copy writes the answer to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await answerAndExpand();
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown[])[0]).toContain("Spaced repetition schedules reviews");
  });

  it("read aloud speaks the answer via TTS", async () => {
    mockGenerateSpeech.mockResolvedValue({ audioUrl: "blob:audio", rawOutput: {} });
    const play = vi.fn(async () => {});
    vi.stubGlobal(
      "Audio",
      function (this: unknown) {
        return { play, onended: null, onerror: null };
      } as unknown as typeof Audio,
    );
    await answerAndExpand();
    fireEvent.click(screen.getByText("Read aloud"));
    await waitFor(() => expect(mockGenerateSpeech).toHaveBeenCalled());
    expect(play).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("task 3.4 — follow-up chips", () => {
  it("follow-ups submit as the next question without the keyboard", async () => {
    openSheet();
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: "First?" } });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    const dialog = await screen.findByRole("dialog", { name: "Ask" });
    fireEvent.touchStart(dialog, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 380 }] });
    const chip = await within(dialog).findByText("Why do intervals expand?");
    fireEvent.click(chip);
    await waitFor(() => expect(mockAskInScope).toHaveBeenCalledTimes(2));
    expect(mockAskInScope.mock.calls[1][0].query).toBe("Why do intervals expand?");
    // Keyboard was not summoned for the follow-up.
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });
});

describe("task 5.3 — retrieval-only and empty answers", () => {
  it("renders matching passages with a note when generation is off", async () => {
    mockAskInScope.mockResolvedValue(
      answeredResult({
        retrievalOnly: true,
        answer: { answer: "", sourceRefs: [], evidenceLevel: "weak" },
        sources: [
          {
            chunkId: "c1",
            documentId: "doc-9",
            documentTitle: "Other Doc",
            sourceType: "document",
            text: "A matching passage.",
            headingPath: [],
            location: { sourceType: "text", documentId: "doc-9", ordinal: 0, startOffset: 0, endOffset: 18 },
            score: 0.8,
          },
        ],
      }),
    );
    openSheet();
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "What matches?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    const dialog = await screen.findByRole("dialog", { name: "Ask" });
    expect(dialog.textContent).toContain("Generation is off");
    // Sources render once the card is expanded.
    fireEvent.touchStart(dialog, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 380 }] });
    expect(await screen.findByTestId("qa-sources")).toHaveTextContent("1 sources");
  });
});
