import { beforeEach, describe, expect, it, vi } from "vitest";

const startupApi = vi.hoisted(() => ({
  getStartupSnapshot: vi.fn(),
}));
const collectionState = vi.hoisted(() => ({
  activeCollectionId: "collection-a",
  hydrateStartup: vi.fn(),
  loadCollections: vi.fn(),
}));
const documentState = vi.hoisted(() => ({
  hydrateStartupDocuments: vi.fn(),
  loadDocuments: vi.fn(),
}));
const queueState = vi.hoisted(() => ({
  hydrateStartupQueue: vi.fn(),
  loadQueue: vi.fn(),
  loadDueDocumentsOnly: vi.fn(),
}));

vi.mock("../../api/startup", () => startupApi);
vi.mock("../collectionStore", () => ({
  useCollectionStore: Object.assign(() => collectionState, {
    getState: () => collectionState,
    subscribe: vi.fn(),
  }),
}));
vi.mock("../documentStore", () => ({
  useDocumentStore: Object.assign(() => documentState, {
    getState: () => documentState,
  }),
}));
vi.mock("../queueStore", () => ({
  useQueueStore: Object.assign(() => queueState, {
    getState: () => queueState,
  }),
}));

import { useStartupStore } from "../startupStore";

function snapshot() {
  return {
    version: 1,
    collections: [],
    activeCollectionId: "collection-a",
    documents: { items: [], total: 0, hasMore: false, nextOffset: null },
    queue: { items: [], total: 0, hasMore: false, nextOffset: null },
    continueReading: [],
    dueCount: 0,
  };
}

describe("startup coordinator store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
