/**
 * Component tests for the mobile Scroll Mode launcher's theme-aware
 * mode-accent styling (theme-mode-accent / scroll-mode-entry capabilities).
 *
 * The enabled launcher must use the same shared mode-accent token classes as
 * desktop; the disabled state (empty queue) must render as an ordinary
 * disabled control without the accent treatment.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const ensureStartup = vi.fn();
const emitUserInteraction = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/feedback/orchestrator", () => ({ emitUserInteraction }));

let storeItems: any[] = [];

vi.mock("../../../stores/queueStore", () => {
  const getStore = () => ({
    items: storeItems,
    isLoading: false,
    error: null,
    selectedIds: new Set<string>(),
    loadQueue: vi.fn(),
    loadDueQueueItems: vi.fn(),
    setQueueFilterMode: vi.fn(),
    setSelected: vi.fn(),
    clearSelection: vi.fn(),
    bulkSuspend: vi.fn(),
    bulkUnsuspend: vi.fn(),
    bulkDelete: vi.fn(),
    postponeItemSmart: vi.fn(),
    loadedQueryKey: null as string | null,
    setLoadedQueryKey: vi.fn(),
    // DAQE's derived ranking cache. An empty Map is the faithful
    // "no ranking yet" value for state the components only ever read.
    rankBreakdowns: new Map<string, unknown>(),
    rankBreakdownKnobs: null,
  });
  return {
    // DAQE's derived ranking cache. Absent means "no ranking yet", which
  // is the faithful empty value for a Map the components only read.
  rankBreakdowns: new Map<string, unknown>(),
  rankBreakdownKnobs: null,
  useQueueStore: Object.assign(
      (selector?: (s: ReturnType<typeof getStore>) => unknown) => (selector ? selector(getStore()) : getStore()),
      { getState: () => getStore() }
    ),
  };
});

vi.mock("../../../stores/startupStore", () => ({
  useStartupStore: (selector: (s: any) => unknown) =>
    selector({
      status: "idle",
      error: null,
      snapshot: null,
      collectionId: null,
      lastSurface: null,
      lastQueueMode: null,
      ensureStartup,
      retryStartup: vi.fn(),
    }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: any) => unknown) =>
    selector({ settings: { general: {}, queue: {}, smartQueue: {} } }),
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../schedule/MobileScheduleView", () => ({
  MobileScheduleView: () => React.createElement("div"),
}));

vi.mock("../../queue/QueueItemActionSheet", () => ({
  QueueItemActionSheet: () => null,
}));

vi.mock("../SwipeableItem", () => ({
  SwipeableItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("../PullToRefresh", () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("../../common/VirtualList", () => ({
  DynamicVirtualList: () => null,
}));

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  dismissDocument: vi.fn(),
}));

import { MobileQueueView } from "../MobileQueueView";
import {
  scrollModeEntryDisabledClasses,
  scrollModeEntryProminentClasses,
} from "../../queue/scrollModeEntry";

const readingItem = {
  id: "item-1",
  documentId: "doc-1",
  documentTitle: "Reading Item",
  itemType: "document",
  priority: 7,
  estimatedTime: 5,
  tags: [],
  progress: 0,
};

describe("MobileQueueView Scroll Mode launcher (mode-accent styling)", () => {
  beforeEach(() => {
    ensureStartup.mockReset().mockResolvedValue(null);
    emitUserInteraction.mockClear();
    storeItems = [];
  });

  const getLauncher = (): HTMLButtonElement | null => {
    const tooltip = screen.queryByTitle("queue.scrollModeTooltip");
    return tooltip ? (tooltip.closest("button") as HTMLButtonElement) : null;
  };

  it("enabled launcher uses the same shared mode-accent token classes as desktop", async () => {
    storeItems = [readingItem];
    render(React.createElement(MobileQueueView, { onOpenScrollMode: vi.fn() }));

    await waitFor(() => expect(getLauncher()).not.toBeNull());
    const classes = getLauncher()!.className;
    for (const token of scrollModeEntryProminentClasses.split(" ")) {
      expect(classes).toContain(token);
    }
    expect(classes).toContain("active:scale-95");
    expect(classes).not.toContain("from-purple-500");
    expect(classes).not.toContain("to-pink-500");
    expect(classes).not.toContain("text-white");
  });

  it("disabled state renders an ordinary disabled control when the queue is empty", async () => {
    render(React.createElement(MobileQueueView, { onOpenScrollMode: vi.fn() }));

    await waitFor(() => expect(getLauncher()).not.toBeNull());
    const launcher = getLauncher()!;
    expect(launcher.disabled).toBe(true);
    for (const token of scrollModeEntryDisabledClasses.split(" ")) {
      expect(launcher.className).toContain(token);
    }
    // Reduced emphasis comes from the standard disabled opacity, matching the
    // pre-change treatment (design D4: disabled state unchanged).
    expect(launcher.className).toContain("disabled:opacity-50");
  });

  it("activation callback is unchanged and gated by the enabled state", async () => {
    const onOpenScrollMode = vi.fn();
    storeItems = [readingItem];
    const view = render(React.createElement(MobileQueueView, { onOpenScrollMode }));

    await waitFor(() => expect(getLauncher()).not.toBeNull());
    fireEvent.click(getLauncher()!);
    expect(onOpenScrollMode).toHaveBeenCalledTimes(1);
    expect(onOpenScrollMode).toHaveBeenCalledWith({
      items: [expect.objectContaining({ id: "item-1" })],
      mode: "queue-list",
    });

    // Empty queue → disabled → no activation.
    storeItems = [];
    view.rerender(React.createElement(MobileQueueView, { onOpenScrollMode }));
    await waitFor(() => expect(getLauncher()!.disabled).toBe(true));
    fireEvent.click(getLauncher()!);
    expect(onOpenScrollMode).toHaveBeenCalledTimes(1);
  });
});

describe("MobileQueueView session activation feedback", () => {
  beforeEach(() => {
    ensureStartup.mockReset().mockResolvedValue(null);
    emitUserInteraction.mockClear();
    storeItems = [readingItem];
  });

  it("emits one activation when Start Reading opens the optimal scroll session", () => {
    const onOpenScrollMode = vi.fn();
    render(<MobileQueueView onOpenScrollMode={onOpenScrollMode} />);

    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReading" }));

    expect(onOpenScrollMode).toHaveBeenCalledExactlyOnceWith({ mode: "optimal" });
    expect(emitUserInteraction).toHaveBeenCalledExactlyOnceWith("navigation.destination-opened");
  });

  it("emits one activation when Start Reading falls back to a document", () => {
    const onOpenDocument = vi.fn();
    render(<MobileQueueView onOpenDocument={onOpenDocument} />);

    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReading" }));

    expect(onOpenDocument).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "item-1" }));
    expect(emitUserInteraction).toHaveBeenCalledExactlyOnceWith("navigation.destination-opened");
  });

  it("emits one activation when Start Review starts the filtered learning queue", () => {
    const onStartReview = vi.fn();
    storeItems = [readingItem, { ...readingItem, id: "queue-card-1", learningItemId: "card-1", itemType: "learning-item" }];
    render(<MobileQueueView onStartReview={onStartReview} />);
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.review" }));

    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReview" }));

    expect(onStartReview).toHaveBeenCalledExactlyOnceWith("card-1", ["card-1"]);
    expect(emitUserInteraction).toHaveBeenCalledExactlyOnceWith("navigation.destination-opened");
  });

  it("stays silent when the reading or review queue is empty", () => {
    storeItems = [];
    const onOpenScrollMode = vi.fn();
    const onStartReview = vi.fn();
    render(<MobileQueueView onOpenScrollMode={onOpenScrollMode} onStartReview={onStartReview} />);
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReading" }));
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.review" }));
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReview" }));

    expect(onOpenScrollMode).not.toHaveBeenCalled();
    expect(onStartReview).not.toHaveBeenCalled();
    expect(emitUserInteraction).not.toHaveBeenCalled();
  });

  it("stays silent when no session callback is wired up", () => {
    storeItems.push({ ...readingItem, id: "card-1", itemType: "learning-item" });
    render(<MobileQueueView />);
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReading" }));
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.review" }));
    fireEvent.click(screen.getByRole("button", { name: "mobileQueue.startReview" }));

    expect(emitUserInteraction).not.toHaveBeenCalled();
  });
});
