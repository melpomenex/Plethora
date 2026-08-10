import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReviewQueueView } from "../ReviewQueueView";
import { TabContent } from "../../common/Tabs/TabContent";
import type { Tab } from "../../../stores/tabsStore";
import type { QueueItem } from "../../../types/queue";

const mockStore = vi.hoisted(() => {
  const store: Record<string, any> = {
    items: [
      {
        id: "item-1",
        documentId: "doc-1",
        documentTitle: "Reading Item",
        itemType: "document",
        priority: 7,
        estimatedTime: 5,
        tags: ["History"],
        progress: 20,
      },
      {
        id: "item-3",
        documentId: "doc-3",
        documentTitle: "Second Reading Item",
        itemType: "document",
        priority: 6,
        estimatedTime: 7,
        tags: ["Math"],
        progress: 10,
      },
      {
        id: "item-2",
        learningItemId: "card-2",
        documentId: "doc-2",
        documentTitle: "Review Item",
        itemType: "learning-item",
        priority: 9,
        estimatedTime: 2,
        tags: ["Science"],
        progress: 40,
      },
    ] as QueueItem[],
    isLoading: false,
    error: null,
    searchQuery: "",
    setSearchQuery: vi.fn((q: string) => { store.searchQuery = q; }),
    loadQueue: vi.fn(),
    loadStats: vi.fn(),
    selectedIds: new Set<string>(),
    setSelected: vi.fn(),
    setSelectionFromClick: vi.fn(),
    selectAll: vi.fn(),
    clearSelection: vi.fn(),
    bulkSuspend: vi.fn(),
    bulkUnsuspend: vi.fn(),
    bulkDelete: vi.fn(),
    bulkOperationLoading: false,
    bulkOperationResult: null,
    clearBulkResult: vi.fn(),
    loadDueDocumentsOnly: vi.fn(),
    loadDueQueueItems: vi.fn(),
    queueFilterMode: "all-items",
    setQueueFilterMode: vi.fn(),
    // Order-stability (stabilize-queue-order-on-reactivation): the component
    // records its loaded query key + first-load flag in the store so they
    // survive tab unmount. Default to an unmatched key so the load effect runs,
    // and mirror the real setters so they actually update state (a bare vi.fn
    // would leave loadedQueryKey null and the effect would reload on every
    // reactivation, defeating the dedup the real store provides).
    loadedQueryKey: null as string | null,
    setLoadedQueryKey: vi.fn((key: string | null) => { store.loadedQueryKey = key; }),
    hasCompletedFirstLoad: false,
    setHasCompletedFirstLoad: vi.fn((done: boolean) => { store.hasCompletedFirstLoad = done; }),
    customSubset: null,
    setCustomSubset: vi.fn(),
    applyFilters: vi.fn(),
  };
  return store;
});

vi.mock("../../../stores/queueStore", () => ({
  // The component calls useQueueStore three ways: as a hook with no args
  // (`useQueueStore(useShallow(selector))`), and with bare selectors
  // (`useQueueStore((s) => s.customSubset)`). Apply the selector to the store
  // when one is passed so per-field reads resolve correctly; without this the
  // mock returns the whole store for every selector, making `customSubset`
  // truthy and breaking applyFilters.
  useQueueStore: Object.assign(
    (selector?: (s: typeof mockStore) => unknown) =>
      selector ? selector(mockStore) : mockStore,
    { getState: () => mockStore }
  ),
}));

vi.mock("../../../lib/pwa", () => ({
  getDeviceInfo: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isPWA: false,
    isOnline: true,
    pixelRatio: 1,
    screenWidth: 1200,
    screenHeight: 800,
  }),
}));

beforeEach(() => {
  mockStore.loadQueue.mockClear();
  mockStore.loadStats.mockClear();
  mockStore.searchQuery = "";
  mockStore.queueFilterMode = undefined;
});

describe("ReviewQueueView", () => {
  it("shows flashcards as well as documents in Due All", () => {
    mockStore.queueFilterMode = "due-all";
    render(<ReviewQueueView />);
    expect(screen.getAllByText("Review Item").length).toBeGreaterThan(0);
  });

  it("renders session actions and queue toggle", () => {
    render(<ReviewQueueView />);
    expect(screen.getByText("Start Optimal Session")).toBeInTheDocument();
    expect(screen.getAllByText("Reading Queue").length).toBeGreaterThan(0);
  });

  it("shows inspector for selected item", () => {
    render(<ReviewQueueView />);
    fireEvent.click(screen.getAllByText("Reading Item")[0]);
    expect(screen.getByText("Inspector")).toBeInTheDocument();
    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
  });

  it("routes optimal session to scroll mode with optimal mode option", () => {
    const onOpenScrollMode = vi.fn();
    render(<ReviewQueueView onOpenScrollMode={onOpenScrollMode} />);
    fireEvent.click(screen.getByText("Start Optimal Session"));
    expect(onOpenScrollMode).toHaveBeenCalledTimes(1);
    expect(onOpenScrollMode).toHaveBeenCalledWith({
      mode: "optimal",
      itemTypes: { documents: true, extracts: false, learningItems: false },
    });
  });

  it("routes scroll mode button to scroll mode with visible items and queue-list mode option", () => {
    const onOpenScrollMode = vi.fn();
    render(<ReviewQueueView onOpenScrollMode={onOpenScrollMode} />);
    fireEvent.click(screen.getByText("Scroll Mode"));
    expect(onOpenScrollMode).toHaveBeenCalledTimes(1);
    expect(onOpenScrollMode).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({ id: "item-1", documentId: "doc-1" }),
        expect.objectContaining({ id: "item-3", documentId: "doc-3" }),
      ]),
      mode: "queue-list",
      itemTypes: { documents: true, extracts: false, learningItems: false },
    });
  });

  it("starts the planned flashcard queue when Review Queue is selected", () => {
    const onStartReview = vi.fn();
    const onOpenScrollMode = vi.fn();
    render(
      <ReviewQueueView
        onStartReview={onStartReview}
        onOpenScrollMode={onOpenScrollMode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Review Queue" }));
    fireEvent.click(screen.getByText("Start Optimal Session"));

    expect(onOpenScrollMode).not.toHaveBeenCalled();
    expect(onStartReview).toHaveBeenCalledWith("card-2", ["card-2"]);
  });

  it("shows deterministic visible queue positions and marks the next item", () => {
    render(<ReviewQueueView />);

    expect(screen.getByLabelText("Queue position 1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Queue position 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Up next · #1 of 2")).toBeInTheDocument();
  });
});

describe("Queue tab focus does not force a reload", () => {
  function Placeholder() {
    return null;
  }

  it("does not reload the queue merely from regaining focus (e.g. returning from Scroll Mode)", () => {
    mockStore.queueFilterMode = "all-items";
    const tabs: Tab[] = [
      { id: "other", title: "Other", icon: null, type: "dashboard", content: Placeholder, closable: true },
      { id: "queue", title: "Queue", icon: null, type: "queue", content: ReviewQueueView, closable: true },
    ];

    const view = render(<TabContent tabs={tabs} activeTabId="queue" />);
    expect(mockStore.loadQueue).toHaveBeenCalledTimes(1);

    // Simulate opening Scroll Mode / an Optimal Session (a different tab
    // becomes active) and returning to the Queue tab without anything about
    // the filter/mode/collection actually changing.
    view.rerender(<TabContent tabs={tabs} activeTabId="other" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="queue" />);

    expect(mockStore.loadQueue).toHaveBeenCalledTimes(1);
  });
});

describe("Session customization filtering", () => {
  const openModal = () => {
    fireEvent.click(screen.getByRole("button", { name: /Customize Session/i }));
  };

  const findModal = () => {
    // The modal title heading is h2 "Customize Session", the button is a <button>
    return screen.getByRole("heading", { name: "Customize Session", level: 2 }).closest(".fixed")!;
  };

  // Due All used to bypass the Item Types toggles entirely, so unchecking
  // Learning Items there did nothing — and Due All is the default filter.
  it("honors the Learning Items toggle in Due All", () => {
    mockStore.queueFilterMode = "due-all";
    render(<ReviewQueueView />);
    expect(screen.getAllByText("Review Item").length).toBeGreaterThan(0);

    openModal();
    const modal = findModal() as HTMLElement;
    const learningItems = within(modal)
      .getByText("Learning Items")
      .closest("label")!
      .querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(learningItems.checked).toBe(true);
    fireEvent.click(learningItems);
    fireEvent.click(within(modal).getByText("Apply Customization"));

    expect(screen.queryByText("Review Item")).not.toBeInTheDocument();
    // Documents are still on, so the reading items must survive.
    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
  });

  it("filters visible items by tag when tag selected in customize modal", () => {
    render(<ReviewQueueView />);

    // Both documents should be visible initially (reading mode shows documents)
    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Second Reading Item").length).toBeGreaterThan(0);

    // Open customize session modal
    openModal();

    // Click the "History" tag in the modal
    const modal = findModal() as HTMLElement;
    const historyTag = within(modal).getByText("History");
    fireEvent.click(historyTag);

    // Apply the customization
    fireEvent.click(within(modal).getByText("Apply Customization"));

    // Only "Reading Item" (tagged "History") should remain visible
    expect(screen.queryByText("Second Reading Item")).not.toBeInTheDocument();
    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
  });

  it("filters visible items by category when category selected", () => {
    // Add category to mock items
    mockStore.items[0] = { ...mockStore.items[0], category: "Chapter 1" };
    mockStore.items[1] = { ...mockStore.items[1], category: "Chapter 2" };

    render(<ReviewQueueView />);

    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Second Reading Item").length).toBeGreaterThan(0);

    // Open modal and select "Chapter 1"
    openModal();
    const modal = findModal() as HTMLElement;
    const chapterButton = within(modal).getByText("Chapter 1");
    fireEvent.click(chapterButton);

    fireEvent.click(within(modal).getByText("Apply Customization"));

    // Only item with category "Chapter 1" should be visible
    expect(screen.queryByText("Second Reading Item")).not.toBeInTheDocument();
    expect(screen.getAllByText("Reading Item").length).toBeGreaterThan(0);
  });

  it("composes tag filter with queue mode (reading mode shows documents with matching tags)", () => {
    render(<ReviewQueueView />);

    openModal();
    const modal = findModal() as HTMLElement;
    const mathTag = within(modal).getByText("Math");
    fireEvent.click(mathTag);
    fireEvent.click(within(modal).getByText("Apply Customization"));

    // Only "Second Reading Item" (tagged "Math") should be visible
    expect(screen.queryByText("Reading Item")).not.toBeInTheDocument();
    expect(screen.getAllByText("Second Reading Item").length).toBeGreaterThan(0);
  });

  it("composes session customization filters with search query", () => {
    // Pre-set search query in the mock store before rendering
    mockStore.searchQuery = "Second";

    render(<ReviewQueueView />);

    // Only "Second Reading Item" should match the search query
    expect(screen.queryByText("Reading Item")).not.toBeInTheDocument();
    expect(screen.getAllByText("Second Reading Item").length).toBeGreaterThan(0);

    // Now apply a tag filter that excludes the matching item
    openModal();
    const modal = findModal() as HTMLElement;
    const historyTag = within(modal).getByText("History");
    fireEvent.click(historyTag);
    fireEvent.click(within(modal).getByText("Apply Customization"));

    // "Second Reading Item" doesn't have "History" tag, so queue should be empty
    expect(screen.queryByText("Second Reading Item")).not.toBeInTheDocument();
    expect(screen.queryByText("Reading Item")).not.toBeInTheDocument();
  });
});

describe("ReviewQueueView selection (queue-multi-select)", () => {
  beforeEach(() => {
    mockStore.queueFilterMode = "all-items";
    mockStore.selectedIds = new Set<string>();
    mockStore.setSelectionFromClick = vi.fn();
    mockStore.clearSelection = vi.fn();
    mockStore.selectAll = vi.fn();
  });

  // Target the row's clickable body. Not the first text match — the title also
  // appears in the side panel, which has no selection handler — and not the row
  // wrapper either, since the handler sits on its child and events only bubble up.
  const row = (id: string) =>
    document.querySelector(
      `[data-queue-item-id="${id}"] .cursor-pointer`
    ) as HTMLElement;

  it("shift+click on a row extends from the anchor via the store", () => {
    render(<ReviewQueueView />);
    fireEvent.click(row("item-3"), { shiftKey: true });

    expect(mockStore.setSelectionFromClick).toHaveBeenCalledTimes(1);
    const [id, renderedIds, mods] = mockStore.setSelectionFromClick.mock.calls[0];
    expect(id).toBe("item-3");
    expect(mods).toEqual({ shift: true, meta: false });
    // The store must receive this surface's own visible order, not the raw list.
    expect(renderedIds).toEqual(["item-1", "item-3"]);
  });

  it("cmd/ctrl+click on a row toggles a single row via the store", () => {
    render(<ReviewQueueView />);
    fireEvent.click(row("item-3"), { metaKey: true });

    expect(mockStore.setSelectionFromClick).toHaveBeenCalledTimes(1);
    const [id, , mods] = mockStore.setSelectionFromClick.mock.calls[0];
    expect(id).toBe("item-3");
    expect(mods).toEqual({ shift: false, meta: true });
  });

  it("an unmodified row click does not change the selection", () => {
    render(<ReviewQueueView />);
    fireEvent.click(row("item-3"));
    expect(mockStore.setSelectionFromClick).not.toHaveBeenCalled();
  });

  it("cmd+A inside the search box does not select the queue", () => {
    render(<ReviewQueueView />);
    const search = screen.getByPlaceholderText(/search/i);
    fireEvent.keyDown(search, { key: "a", metaKey: true });
    expect(mockStore.selectAll).not.toHaveBeenCalled();
  });

  it("documents are selectable, not just learning items", () => {
    render(<ReviewQueueView />);
    // Both visible rows are documents; each must carry its own checkbox now
    // that selection is no longer narrowed to learning items.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("escape clears an active selection", () => {
    mockStore.selectedIds = new Set(["item-1", "item-3"]);
    render(<ReviewQueueView />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockStore.clearSelection).toHaveBeenCalled();
  });

  it("escape clears the selection from inside the search box too", () => {
    mockStore.selectedIds = new Set(["item-1"]);
    render(<ReviewQueueView />);
    // The shared handler bails on text fields for every other shortcut; Escape
    // is checked first so a selection can always be dropped.
    fireEvent.keyDown(screen.getByPlaceholderText(/search/i), { key: "Escape" });
    expect(mockStore.clearSelection).toHaveBeenCalled();
  });

  it("escape does nothing to the selection while a dialog is open", () => {
    mockStore.selectedIds = new Set(["item-1"]);
    render(<ReviewQueueView />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "Escape" });
    document.body.removeChild(dialog);
    expect(mockStore.clearSelection).not.toHaveBeenCalled();
  });

  it("escape is ignored mid-IME-composition", () => {
    mockStore.selectedIds = new Set(["item-1"]);
    render(<ReviewQueueView />);
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    expect(mockStore.clearSelection).not.toHaveBeenCalled();
  });

  it("escape with nothing selected does not call clearSelection", () => {
    mockStore.selectedIds = new Set<string>();
    render(<ReviewQueueView />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockStore.clearSelection).not.toHaveBeenCalled();
  });
});
