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

  it("does not render the bottom thumb-arc rating dock on the queue list", () => {
    render(<MobileQueueView />);

    expect(document.querySelector('[data-mobile-thumb-arc="true"]')).toBeNull();
    expect(document.querySelector('[data-thumb-arc-context="true"]')).toBeNull();
  });
});
