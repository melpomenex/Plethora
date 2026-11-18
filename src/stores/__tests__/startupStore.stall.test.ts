/**
 * Legacy/browser startup watchdog regression tests for the startup coordinator.
 *
 * A hung `get_startup_snapshot` used to pin the inflight coalescing entry:
 * every later `ensureStartup` with the same key shared the dead promise, so
 * the queue stayed empty until the user navigated away and back. Android now
 * retries inside the shared coordinator; this suite keeps the legacy path
 * deterministic and verifies its watchdog still frees the inflight slot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStartupSnapshot = vi.fn();

vi.mock("../../api/startup", () => ({
  getStartupSnapshot: (...args: unknown[]) => getStartupSnapshot(...args),
}));

vi.mock("../../lib/tauri", () => ({
  isNativeAndroid: () => false,
  waitForBackendReady: vi.fn(),
}));

vi.mock("../../lib/sync/syncTelemetry", () => ({
  markSyncPhaseStart: () => () => undefined,
}));

const hydrateStartup = vi.fn();
const hydrateStartupDocuments = vi.fn();
const hydrateStartupQueue = vi.fn();

vi.mock("../collectionStore", () => ({
  useCollectionStore: Object.assign(vi.fn(), {
    getState: () => ({
      loaded: false,
      activeCollectionId: "collection-1",
      hydrateStartup,
    }),
    subscribe: () => () => undefined,
  }),
}));

vi.mock("../documentStore", () => ({
  useDocumentStore: Object.assign(vi.fn(), {
    getState: () => ({ documents: [], hydrateStartupDocuments }),
    setState: vi.fn(),
    subscribe: () => () => undefined,
  }),
}));

vi.mock("../queueStore", () => ({
  useQueueStore: Object.assign(vi.fn(), {
    getState: () => ({ items: [], hydrateStartupQueue }),
    setState: vi.fn(),
    subscribe: () => () => undefined,
  }),
}));

import { useStartupStore } from "../startupStore";
import { waitForBackendReady } from "../../lib/tauri";

function snapshot() {
  return {
    version: 1,
    collections: [],
    activeCollectionId: "collection-1",
    documents: { items: [], total: 0, hasMore: false, nextOffset: null },
    queue: { items: [], total: 0, hasMore: false, nextOffset: null },
    continueReading: [],
    dueCount: 0,
  };
}

describe("startupStore snapshot watchdog", () => {
  beforeEach(() => {
    getStartupSnapshot.mockReset();
    vi.mocked(waitForBackendReady).mockReset().mockResolvedValue(undefined);
    hydrateStartup.mockReset();
    hydrateStartupDocuments.mockReset();
    hydrateStartupQueue.mockReset();
    useStartupStore.setState({
      status: "idle",
      error: null,
      snapshot: null,
      collectionId: null,
      lastSurface: null,
      lastQueueMode: null,
    });
  });

  it("supersedes a still-pending snapshot on explicit retry", async () => {
    let finishFirst: (value: ReturnType<typeof snapshot>) => void = () => {};
    getStartupSnapshot.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));
    const stale = useStartupStore.getState().ensureStartup("queue");
    await Promise.resolve();
    getStartupSnapshot.mockResolvedValueOnce({ ...snapshot(), dueCount: 2 });
    await expect(useStartupStore.getState().retryStartup("queue")).resolves.toMatchObject({ dueCount: 2 });

    finishFirst({ ...snapshot(), dueCount: 1 });
    await expect(stale).resolves.toBeNull();
    expect(useStartupStore.getState().snapshot?.dueCount).toBe(2);
    expect(hydrateStartupQueue).toHaveBeenCalledTimes(1);
  });

  it("waits through a migration and dispatches one snapshot after readiness", async () => {
    vi.useFakeTimers();
    try {
      let finishMigration = () => {};
      vi.mocked(waitForBackendReady).mockReturnValue(new Promise<void>((resolve) => { finishMigration = resolve; }));
      const first = useStartupStore.getState().ensureStartup("queue");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getStartupSnapshot).not.toHaveBeenCalled();
      expect(useStartupStore.getState().ensureStartup("queue")).toBe(first);
      getStartupSnapshot.mockResolvedValueOnce(snapshot());
      finishMigration();
      await expect(first).resolves.toBeDefined();
      expect(getStartupSnapshot).toHaveBeenCalledTimes(1);
      expect(hydrateStartupQueue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves null on a stalled request, frees the inflight slot, and stays retryable", async () => {
    vi.useFakeTimers();
    try {
      // First request never settles (the dropped-callback transport stall).
      getStartupSnapshot.mockReturnValueOnce(new Promise(() => {}));
      const first = useStartupStore.getState().ensureStartup("queue", {
        queueMode: "due-today",
      });

      await vi.advanceTimersByTimeAsync(8_000);
      await expect(first).resolves.toBeNull();
      expect(useStartupStore.getState().status).toBe("idle");
      expect(hydrateStartupQueue).not.toHaveBeenCalled();

      // The next call must issue a FRESH request instead of sharing the
      // dead promise, and a healthy response must hydrate normally.
      getStartupSnapshot.mockResolvedValueOnce(snapshot());
      const second = useStartupStore.getState().ensureStartup("queue", {
        queueMode: "due-today",
      });
      await expect(second).resolves.toBeDefined();
      expect(getStartupSnapshot).toHaveBeenCalledTimes(2);
      expect(useStartupStore.getState().status).toBe("ready");
      expect(hydrateStartupQueue).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shares the inflight promise while a request is genuinely in progress", async () => {
    vi.useFakeTimers();
    try {
      let release: (value: ReturnType<typeof snapshot>) => void = () => {};
      getStartupSnapshot.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const a = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
      const b = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });

      await vi.advanceTimersByTimeAsync(100);
      release(snapshot());
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra).toBe(rb);
      expect(getStartupSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
