import { beforeEach, describe, expect, it, vi } from "vitest";

const startupApi = vi.hoisted(() => ({
  getStartupSnapshot: vi.fn(),
}));
const tauriApi = vi.hoisted(() => ({
  isNativeAndroid: vi.fn(() => false),
  waitForBackendReady: vi.fn(),
}));
const collectionState = vi.hoisted(() => ({
  activeCollectionId: "collection-a",
  loaded: false,
  subscriber: null as ((state: { activeCollectionId: string }, previous: { activeCollectionId: string }) => void) | null,
  hydrateStartup: vi.fn(),
  loadCollections: vi.fn(),
}));
const documentState = vi.hoisted(() => ({
  documents: [] as unknown[],
  hasCompletedFirstLoad: false,
  isLoading: false,
  error: null as string | null,
  hydrateStartupDocuments: vi.fn(),
  loadDocuments: vi.fn(),
  setState: vi.fn(),
}));
const queueState = vi.hoisted(() => ({
  // DAQE's derived ranking cache. An empty Map is the faithful
  // "no ranking yet" value for state the components only ever read.
  rankBreakdowns: new Map<string, unknown>(),
  rankBreakdownKnobs: null,
  items: [] as unknown[],
  hasCompletedFirstLoad: false,
  isLoading: false,
  error: null as string | null,
  hydrateStartupQueue: vi.fn(),
  loadQueue: vi.fn(),
  loadDueDocumentsOnly: vi.fn(),
  setState: vi.fn(),
}));
const savedQueueState = vi.hoisted(() => ({ loadSavedQueues: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../api/startup", () => startupApi);
vi.mock("../../lib/tauri", () => tauriApi);
vi.mock("../collectionStore", () => ({
  useCollectionStore: Object.assign(() => collectionState, {
    getState: () => collectionState,
    subscribe: vi.fn((subscriber: typeof collectionState.subscriber) => {
      collectionState.subscriber = subscriber;
      return vi.fn();
    }),
  }),
}));
vi.mock("../documentStore", () => ({
  useDocumentStore: Object.assign(() => documentState, {
    getState: () => documentState,
    setState: (update: Record<string, unknown>) => documentState.setState(update),
  }),
}));
vi.mock("../queueStore", () => ({
  useQueueStore: Object.assign(() => queueState, {
    getState: () => queueState,
    setState: (update: Record<string, unknown>) => queueState.setState(update),
  }),
}));
vi.mock("../savedQueueStore", () => ({
  useSavedQueueStore: Object.assign(() => savedQueueState, {
    getState: () => savedQueueState,
  }),
}));

import { useStartupStore } from "../startupStore";

function snapshot(activeCollectionId = "collection-a") {
  return {
    version: 1,
    collections: [],
    activeCollectionId,
    documents: { items: [], total: 0, hasMore: false, nextOffset: null },
    queue: { items: [], total: 0, hasMore: false, nextOffset: null },
    continueReading: [],
    dueCount: 0,
  };
}

function populatedSnapshot() {
  return {
    ...snapshot(),
    documents: { items: [{ id: "doc-1", title: "A local book" }], total: 1, hasMore: false, nextOffset: null },
    queue: { items: [{ id: "queue-1", documentId: "doc-1" }], total: 1, hasMore: false, nextOffset: null },
  };
}

describe("startup coordinator store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriApi.isNativeAndroid.mockReturnValue(false);
    tauriApi.waitForBackendReady.mockResolvedValue(undefined);
    collectionState.activeCollectionId = "collection-a";
    collectionState.loaded = false;
    collectionState.hydrateStartup.mockImplementation((_collections, activeCollectionId: string) => {
      collectionState.activeCollectionId = activeCollectionId;
      collectionState.loaded = true;
    });
    documentState.documents = [];
    documentState.hasCompletedFirstLoad = false;
    documentState.isLoading = false;
    documentState.error = null;
    documentState.setState.mockImplementation((update: Record<string, unknown>) => Object.assign(documentState, update));
    documentState.hydrateStartupDocuments.mockImplementation((documents: unknown[]) => {
      documentState.documents = documents;
      documentState.hasCompletedFirstLoad = true;
      documentState.isLoading = false;
      documentState.error = null;
    });
    queueState.items = [];
    queueState.hasCompletedFirstLoad = false;
    queueState.isLoading = false;
    queueState.error = null;
    queueState.setState.mockImplementation((update: Record<string, unknown>) => Object.assign(queueState, update));
    queueState.hydrateStartupQueue.mockImplementation((items: unknown[]) => {
      queueState.items = items;
      queueState.hasCompletedFirstLoad = true;
      queueState.isLoading = false;
      queueState.error = null;
    });
    useStartupStore.setState({
      status: "idle",
      error: null,
      snapshot: null,
      collectionId: null,
      lastSurface: null,
      lastQueueMode: null,
    });
  });

  it("shares one in-flight snapshot request and hydrates stores once", async () => {
    let resolveRequest!: (value: ReturnType<typeof snapshot>) => void;
    startupApi.getStartupSnapshot.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = useStartupStore.getState().ensureStartup("dashboard");
    const second = useStartupStore.getState().ensureStartup("dashboard");
    expect(first).toBe(second);
    expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(1);

    resolveRequest(snapshot());
    await first;
    expect(collectionState.hydrateStartup).toHaveBeenCalledTimes(1);
    expect(documentState.hydrateStartupDocuments).toHaveBeenCalledTimes(1);
    expect(useStartupStore.getState().status).toBe("ready");
  });

  it("retries a timed-out Android startup request and hydrates without another caller", async () => {
    vi.useFakeTimers();
    try {
      tauriApi.isNativeAndroid.mockReturnValue(true);
      startupApi.getStartupSnapshot
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce(populatedSnapshot());

      const first = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
      const joined = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
      expect(joined).toBe(first);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(useStartupStore.getState().status).toBe("loading");
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(first).resolves.toMatchObject({ activeCollectionId: "collection-a" });
      expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(2);
      expect(tauriApi.waitForBackendReady).toHaveBeenCalledTimes(2);
      expect(queueState.hasCompletedFirstLoad).toBe(true);
      expect(documentState.documents).toHaveLength(1);
      expect(queueState.items).toHaveLength(1);
      expect(useStartupStore.getState().status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for Android backend readiness before dispatching a snapshot", async () => {
    tauriApi.isNativeAndroid.mockReturnValue(true);
    let resolveReady!: () => void;
    tauriApi.waitForBackendReady.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveReady = resolve;
    }));
    startupApi.getStartupSnapshot.mockResolvedValueOnce(populatedSnapshot());

    const request = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
    expect(tauriApi.waitForBackendReady).toHaveBeenCalledTimes(1);
    expect(startupApi.getStartupSnapshot).not.toHaveBeenCalled();

    resolveReady();
    await expect(request).resolves.toMatchObject({ activeCollectionId: "collection-a" });
    expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(1);
    expect(queueState.items).toHaveLength(1);
  });

  it("treats a successful empty Android snapshot as ready without retrying", async () => {
    tauriApi.isNativeAndroid.mockReturnValue(true);
    startupApi.getStartupSnapshot.mockResolvedValueOnce(snapshot());

    await expect(useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" }))
      .resolves.toMatchObject({ queue: { items: [] }, documents: { items: [] } });

    expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(1);
    expect(documentState.hasCompletedFirstLoad).toBe(true);
    expect(queueState.hasCompletedFirstLoad).toBe(true);
    expect(useStartupStore.getState().status).toBe("ready");
  });

  it("exhausts bounded Android retries into an explicit error and can retry manually", async () => {
    vi.useFakeTimers();
    try {
      tauriApi.isNativeAndroid.mockReturnValue(true);
      startupApi.getStartupSnapshot
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockRejectedValueOnce(new Error("database unavailable"));

      const failed = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(failed).resolves.toBeNull();
      expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(3);
      expect(useStartupStore.getState().status).toBe("error");
      expect(queueState.isLoading).toBe(false);
      expect(queueState.error).toContain("database unavailable");

      startupApi.getStartupSnapshot.mockResolvedValueOnce(snapshot());
      const retried = useStartupStore.getState().retryStartup("queue");
      await expect(retried).resolves.toMatchObject({ activeCollectionId: "collection-a" });
      expect(useStartupStore.getState().status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves loaded rows and exposes retry after an Android refresh exhausts its budget", async () => {
    vi.useFakeTimers();
    try {
      tauriApi.isNativeAndroid.mockReturnValue(true);
      const loadedDocument = { id: "doc-keep", title: "Previously loaded" };
      const loadedQueueItem = { id: "queue-keep", documentId: "doc-keep" };
      documentState.documents = [loadedDocument];
      documentState.hasCompletedFirstLoad = true;
      queueState.items = [loadedQueueItem];
      queueState.hasCompletedFirstLoad = true;
      startupApi.getStartupSnapshot
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockRejectedValueOnce(new Error("database unavailable"));

      const refresh = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(refresh).resolves.toBeNull();

      expect(documentState.documents).toEqual([loadedDocument]);
      expect(queueState.items).toEqual([loadedQueueItem]);
      expect(documentState.hasCompletedFirstLoad).toBe(true);
      expect(queueState.hasCompletedFirstLoad).toBe(true);
      expect(documentState.error).toContain("database unavailable");
      expect(queueState.error).toContain("database unavailable");
      expect(documentState.isLoading).toBe(false);
      expect(queueState.isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply a delayed response after the active collection changes", async () => {
    let resolveRequest!: (value: ReturnType<typeof snapshot>) => void;
    startupApi.getStartupSnapshot.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const request = useStartupStore.getState().ensureStartup("dashboard");
    collectionState.loaded = true;
    collectionState.activeCollectionId = "collection-b";
    collectionState.subscriber?.(
      { activeCollectionId: "collection-b" },
      { activeCollectionId: "collection-a" },
    );
    resolveRequest(snapshot());
    await expect(request).resolves.toBeNull();
    expect(documentState.hydrateStartupDocuments).not.toHaveBeenCalled();
    expect(useStartupStore.getState().status).toBe("idle");
  });

  it("does not let an older queue-mode response overwrite the latest surface request", async () => {
    let resolveOldRequest!: (value: ReturnType<typeof populatedSnapshot>) => void;
    startupApi.getStartupSnapshot.mockReturnValueOnce(new Promise((resolve) => {
      resolveOldRequest = resolve;
    }));
    const older = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });

    const newestSnapshot = {
      ...snapshot(),
      queue: {
        items: [{ id: "new-mode-item", documentId: "doc-1" }],
        total: 1,
        hasMore: false,
        nextOffset: null,
      },
    };
    startupApi.getStartupSnapshot.mockResolvedValueOnce(newestSnapshot);
    const newer = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-all" });
    await expect(newer).resolves.toMatchObject({ queue: { items: [{ id: "new-mode-item" }] } });

    resolveOldRequest(populatedSnapshot());
    await expect(older).resolves.toBeNull();
    expect(queueState.items).toEqual([{ id: "new-mode-item", documentId: "doc-1" }]);
    expect(queueState.hydrateStartupQueue).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale failure after the active collection changes", async () => {
    tauriApi.isNativeAndroid.mockReturnValue(true);
    let rejectRequest!: (error: Error) => void;
    startupApi.getStartupSnapshot.mockReturnValueOnce(new Promise((_, reject) => {
      rejectRequest = reject;
    }));

    const request = useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
    collectionState.loaded = true;
    collectionState.activeCollectionId = "collection-b";
    collectionState.subscriber?.(
      { activeCollectionId: "collection-b" },
      { activeCollectionId: "collection-a" },
    );
    rejectRequest(new Error("database unavailable"));

    await expect(request).resolves.toBeNull();
    expect(startupApi.getStartupSnapshot).toHaveBeenCalledTimes(1);
    expect(useStartupStore.getState().status).toBe("idle");
    expect(queueState.error).toBeNull();
  });
});
