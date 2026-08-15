/**
 * Cold-start IPC stall regression tests for the startup coordinator.
 *
 * On a cold Android WebView the first invoke round-trip can stall ~30s
 * inside the bridge (see the retrying readiness gate in lib/tauri.ts). A
 * hung `get_startup_snapshot` used to pin the inflight coalescing entry:
 * every later `ensureStartup` with the same key shared the dead promise, so
 * the queue stayed empty until the user navigated away and back. The
 * watchdog must resolve null, free the inflight slot, and let the next call
 * issue a fresh request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStartupSnapshot = vi.fn();

vi.mock("../../api/startup", () => ({
  getStartupSnapshot: (...args: unknown[]) => getStartupSnapshot(...args),
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
    getState: () => ({ hydrateStartupDocuments }),
    subscribe: () => () => undefined,
  }),
}));

vi.mock("../queueStore", () => ({
  useQueueStore: Object.assign(vi.fn(), {
    getState: () => ({ hydrateStartupQueue }),
    subscribe: () => () => undefined,
  }),
}));

import { useStartupStore } from "../startupStore";

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
      expect(getStartupSnapshot).toHaveBeenCalledTimes(2);
      await expect(second).resolves.toBeDefined();
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
