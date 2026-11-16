import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MobileQueueView } from "../MobileQueueView";

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        items: [
          {
            id: "q-1",
            documentId: "doc-raft",
            documentTitle: "Raft Consensus",
            itemType: "document",
            queuePosition: 1,
            queueTotal: 1,
            isUpNext: true,
            dueDate: null,
            priority: 10,
            question: "The Raft leader logs append-only entries.",
          },
        ],
        isLoading: false,
        error: null,
        hasCompletedFirstLoad: true,
        selectedIds: new Set<string>(),
        loadQueue: vi.fn(),
        loadDueQueueItems: vi.fn(),
        setQueueFilterMode: vi.fn(),
        setSelected: vi.fn(),
        clearSelection: vi.fn(),
        toggleSelectAll: vi.fn(),
        selectAll: vi.fn(),
        postponeItem: vi.fn(),
        removeItem: vi.fn(),
        toggleSelectionMode: vi.fn(),
        selectionMode: false,
        queueFilterMode: "today",
      }),
    {
      getState: () => ({
        items: [],
        loadedQueryKey: "mobile:due-today",
        setLoadedQueryKey: vi.fn(),
        setQueueFilterMode: vi.fn(),
        loadDueQueueItems: vi.fn(),
      }),
    }
  ),
}));

vi.mock("../../../stores/startupStore", () => ({
  useStartupStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      snapshot: null,
      isHydrating: false,
      ensureStartup: vi.fn().mockResolvedValue(null),
    }),
}));

describe("MobileQueueView.ergonomics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures double-tapped paragraph to desktop inbox and shows Captured to Inbox toast", async () => {
    const onInstantExtractParagraph = vi.fn().mockResolvedValue(undefined);
    render(
      <MobileQueueView
        activeReadableParagraphs={["The Raft leader logs append-only entries."]}
        onInstantExtractParagraph={onInstantExtractParagraph}
      />
    );

    const para = document.querySelector('[data-paragraph-index="0"]')!;
    expect(para).toBeTruthy();
    fireEvent.doubleClick(para);

    await waitFor(() => {
      expect(onInstantExtractParagraph).toHaveBeenCalledTimes(1);
    });
    expect(onInstantExtractParagraph.mock.calls[0][0]).toBe(
      "The Raft leader logs append-only entries."
    );
    expect(await screen.findByText("Captured to Inbox")).toBeInTheDocument();
  });

  it("dispatches Thumb-Arc rating, priority nudge, and Commute Audio Queue toggle", () => {
    const onThumbArcRate = vi.fn();
    const onThumbArcPriorityNudge = vi.fn();
    const onToggleCommuteAudio = vi.fn();

    render(
      <MobileQueueView
        onThumbArcRate={onThumbArcRate}
        onThumbArcPriorityNudge={onThumbArcPriorityNudge}
        onToggleCommuteAudio={onToggleCommuteAudio}
      />
    );

    const dock = document.querySelector('[data-mobile-thumb-arc="true"]');
    expect(dock).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(onThumbArcRate).toHaveBeenCalledTimes(1);
    expect(onThumbArcRate.mock.calls[0][0]).toBe("good");

    fireEvent.click(screen.getByRole("button", { name: /Boost Priority \(-10\)/i }));
    expect(onThumbArcPriorityNudge).toHaveBeenCalledTimes(1);
    expect(onThumbArcPriorityNudge.mock.calls[0][0]).toBe(-10);

    fireEvent.click(screen.getByRole("button", { name: /Commute Audio Queue/i }));
    expect(onToggleCommuteAudio).toHaveBeenCalledWith(true);
  });

  it("shows the Up next target label and starts speech readout for Commute Audio Queue without opening Scroll Mode", async () => {
    const onOpenScrollMode = vi.fn();
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
    );

    render(<MobileQueueView onOpenScrollMode={onOpenScrollMode} />);

    const context = document.querySelector('[data-thumb-arc-context="true"]');
    expect(context?.textContent).toContain("Up next: Raft Consensus");
    expect(context?.textContent).toContain("Rate #1 to review");

    fireEvent.click(screen.getByRole("button", { name: /Commute Audio Queue/i }));
    await waitFor(() => {
      expect(speak).toHaveBeenCalledTimes(1);
    });
    expect(onOpenScrollMode).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Stop Audio Queue/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Stop Audio Queue/i }));
    expect(cancel).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
