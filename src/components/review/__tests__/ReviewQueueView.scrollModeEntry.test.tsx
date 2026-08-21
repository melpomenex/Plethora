/**
 * Component tests for the desktop Scroll Mode launcher's theme-aware
 * mode-accent styling (theme-mode-accent / scroll-mode-entry capabilities).
 *
 * The launcher must consume the shared mode-accent token classes, keep its
 * layout/tooltip/activation behavior, and contain no hard-coded pink/purple.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewQueueView } from "../ReviewQueueView";
import { scrollModeEntryProminentClasses } from "../../queue/scrollModeEntry";

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
    ],
    isLoading: false,
    error: null,
    searchQuery: "",
    setSearchQuery: vi.fn(),
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
    loadedQueryKey: null as string | null,
    setLoadedQueryKey: vi.fn(),
    hasCompletedFirstLoad: false,
    setHasCompletedFirstLoad: vi.fn(),
    customSubset: null,
    setCustomSubset: vi.fn(),
    applyFilters: vi.fn(),
  };
  return store;
});

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector?: (s: typeof mockStore) => unknown) => (selector ? selector(mockStore) : mockStore),
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

describe("ReviewQueueView Scroll Mode launcher (mode-accent styling)", () => {
  beforeEach(() => {
    mockStore.loadQueue.mockClear();
    mockStore.searchQuery = "";
  });

  const getLauncher = () => screen.getByText("Scroll Mode").closest("button")!;

  it("renders the enabled launcher with the shared mode-accent token classes", () => {
    render(<ReviewQueueView onOpenScrollMode={vi.fn()} />);
    const launcher = getLauncher();
    const classes = launcher.className;

    expect(classes).toContain("border-mode-accent/60");
    expect(classes).toContain("bg-mode-accent/10");
    expect(classes).toContain("text-mode-accent");
    for (const token of scrollModeEntryProminentClasses.split(" ")) {
      expect(classes).toContain(token);
    }
  });

  it("keeps hover treatment derived from the mode accent tokens", () => {
    render(<ReviewQueueView onOpenScrollMode={vi.fn()} />);
    const classes = getLauncher().className;
    expect(classes).toContain("hover:bg-mode-accent/20");
    expect(classes).toContain("hover:border-mode-accent");
  });

  it("contains no hard-coded pink/purple gradient or white text", () => {
    render(<ReviewQueueView onOpenScrollMode={vi.fn()} />);
    const classes = getLauncher().className;
    expect(classes).not.toContain("from-purple-500");
    expect(classes).not.toContain("to-pink-500");
    expect(classes).not.toContain("bg-gradient");
    expect(classes).not.toContain("text-white");
  });

  it("preserves layout, tooltip, and the default keyboard focus outline", () => {
    render(<ReviewQueueView onOpenScrollMode={vi.fn()} />);
    const launcher = getLauncher();

    // Two-line label + icon structure.
    expect(launcher.querySelector("svg")).not.toBeNull();
    expect(launcher.textContent).toContain("Scroll Mode");

    // Tooltip.
    expect(launcher.getAttribute("title")).toBeTruthy();
    expect(launcher.getAttribute("title")).not.toBe("");

    // Min-height contract from the original button.
    expect(launcher.className).toContain("min-h-[44px]");

    // The mode-accent border must not suppress the platform focus outline.
    expect(launcher.className).not.toContain("outline-none");
    expect(launcher.className).not.toContain("focus:outline-none");
  });

  it("activates Scroll Mode with the visible queue items unchanged", () => {
    const onOpenScrollMode = vi.fn();
    render(<ReviewQueueView onOpenScrollMode={onOpenScrollMode} />);
    fireEvent.click(getLauncher());
    expect(onOpenScrollMode).toHaveBeenCalledTimes(1);
    expect(onOpenScrollMode).toHaveBeenCalledWith({
      items: [expect.objectContaining({ id: "item-1", documentId: "doc-1" })],
      mode: "queue-list",
      itemTypes: { documents: true, extracts: true, learningItems: true },
    });
  });
});
