/**
 * Regression tests for the desktop queue first-load gate (view-first-load
 * reliability): `loadedQueryKey` must be claimed only AFTER a load path
 * succeeds, and a watchdog-null startup snapshot must schedule its own retry
 * — otherwise a slow first load strands the view empty until the user
 * navigates away and back (the up-front-claim bug these tests pin down).
 */
import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewQueueView } from "../ReviewQueueView";

const ensureStartup = vi.hoisted(() => vi.fn());

const mockStore = vi.hoisted(() => {
  const store: Record<string, any> = {
    items: [],
    isLoading: false,
    error: null,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    loadQueue: vi.fn(() => Promise.resolve()),
    loadStats: vi.fn(),
    loadDueDocumentsOnly: vi.fn(() => Promise.resolve()),
    loadDueQueueItems: vi.fn(() => Promise.resolve()),
    queueFilterMode: "due-all",
    setQueueFilterMode: vi.fn(),
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
    loadedQueryKey: null as string | null,
    setLoadedQueryKey: vi.fn((key: string | null) => {
      store.loadedQueryKey = key;
    }),
    hasCompletedFirstLoad: false,
    setHasCompletedFirstLoad: vi.fn((done: boolean) => {
      store.hasCompletedFirstLoad = done;
    }),
    customSubset: null,
    setCustomSubset: vi.fn(),
    applyFilters: vi.fn(),
  };
  return store;
});

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector?: (s: typeof mockStore) => unknown) =>
      selector ? selector(mockStore) : mockStore,
    { getState: () => mockStore },
  ),
}));

vi.mock("../../../stores/startupStore", () => ({
  useStartupStore: (selector: (s: { ensureStartup: typeof ensureStartup }) => unknown) =>
    selector({ ensureStartup }),
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
  mockStore.loadedQueryKey = null;
  mockStore.hasCompletedFirstLoad = false;
  mockStore.queueFilterMode = "due-all";
  mockStore.loadQueue.mockClear();
  mockStore.loadDueQueueItems.mockClear();
  mockStore.loadDueDocumentsOnly.mockClear();
  ensureStartup.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ReviewQueueView first-load claim semantics", () => {
  it("claims the loaded key only after the startup snapshot arrives", async () => {
    ensureStartup.mockResolvedValue({ ok: true });
    render(<ReviewQueueView />);

    await vi.waitFor(() => {
      expect(mockStore.loadedQueryKey).not.toBeNull();
    });
    expect(mockStore.hasCompletedFirstLoad).toBe(true);
  });

  it("leaves the key unclaimed on a watchdog-null snapshot and retries with backoff", async () => {
    vi.useFakeTimers();
    ensureStartup.mockResolvedValue(null);
    render(<ReviewQueueView />);

    // First pass raced the backend and resolved null. The key must NOT be
    // claimed — a claimed-but-empty key made every later activation
    // early-return, which is the reported bug.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ensureStartup).toHaveBeenCalledTimes(1);
    expect(mockStore.loadedQueryKey).toBeNull();

    // The view schedules its own retry (~3s) instead of waiting for the user
    // to cycle views; the recovery pass claims the key.
    ensureStartup.mockResolvedValue({ ok: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    expect(ensureStartup).toHaveBeenCalledTimes(2);
    expect(mockStore.loadedQueryKey).not.toBeNull();
  });

  it("claims after a filter-path loader resolves, so failures retry on the next activation", async () => {
    mockStore.queueFilterMode = "due-today";
    let release!: () => void;
    mockStore.loadDueDocumentsOnly.mockImplementation(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    render(<ReviewQueueView />);

    // Loader still in flight: unclaimed (rapid tab toggling re-fires it, but
    // dedupeLoad coalesces the actual IPC).
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockStore.loadedQueryKey).toBeNull();

    release();
    await vi.waitFor(() => {
      expect(mockStore.loadedQueryKey).not.toBeNull();
    });
  });
});
