import { beforeEach, describe, expect, it, vi } from "vitest";

const getCollectionsMock = vi.fn();
const createCollectionMock = vi.fn();
const updateCollectionMock = vi.fn();
const deleteCollectionMock = vi.fn();
const getActiveCollectionMock = vi.fn();
const setActiveCollectionMock = vi.fn();
const getCollectionDueCountMock = vi.fn();

vi.mock("../../api/collections", () => ({
  getCollections: (...args: unknown[]) => getCollectionsMock(...args),
  createCollection: (...args: unknown[]) => createCollectionMock(...args),
  updateCollection: (...args: unknown[]) => updateCollectionMock(...args),
  deleteCollection: (...args: unknown[]) => deleteCollectionMock(...args),
  getActiveCollection: (...args: unknown[]) => getActiveCollectionMock(...args),
  setActiveCollection: (...args: unknown[]) => setActiveCollectionMock(...args),
  getCollectionDueCount: (...args: unknown[]) => getCollectionDueCountMock(...args),
}));

const loadDocumentsMock = vi.fn();
const documentStoreSetStateMock = vi.fn();
vi.mock("../documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ loadDocuments: loadDocumentsMock }),
    setState: (...args: unknown[]) => documentStoreSetStateMock(...args),
  },
}));

const loadQueueMock = vi.fn();
const reloadForCurrentModeMock = vi.fn();
const applyFiltersMock = vi.fn();
vi.mock("../queueStore", () => ({
  useQueueStore: {
    getState: () => ({
      loadQueue: loadQueueMock,
      reloadForCurrentMode: reloadForCurrentModeMock,
      applyFilters: applyFiltersMock,
    }),
  },
}));

const loadDashboardStatsMock = vi.fn();
vi.mock("../analyticsStore", () => ({
  useAnalyticsStore: { getState: () => ({ loadDashboardStats: loadDashboardStatsMock }) },
}));

import { useCollectionStore } from "../collectionStore";

beforeEach(() => {
  vi.clearAllMocks();
  setActiveCollectionMock.mockResolvedValue(undefined);
});

describe("collectionStore.switchCollection", () => {
  it("updates the active collection and triggers a fresh reload for it, without touching document state directly", async () => {
    await useCollectionStore.getState().switchCollection("col-2");

    expect(useCollectionStore.getState().activeCollectionId).toBe("col-2");
    expect(setActiveCollectionMock).toHaveBeenCalledWith("col-2");
    expect(loadDocumentsMock).toHaveBeenCalled();
    // The queue reload after a collection switch routes through the shared,
    // mode-aware chokepoint (see queueStore.reloadForCurrentMode) so it
    // re-issues the ACTIVE filter mode's query, not a raw loadQueue().
    expect(reloadForCurrentModeMock).toHaveBeenCalled();
    expect(loadQueueMock).not.toHaveBeenCalled();
    expect(loadDashboardStatsMock).toHaveBeenCalled();
    // loadDocuments() is itself authoritative for the new scope (and safely
    // discards a stale response — see documentStore.test.ts). switchCollection
    // must not pre-emptively clear documents: if the reload then fails or is
    // slow, that previously left the collection looking permanently empty.
    expect(documentStoreSetStateMock).not.toHaveBeenCalled();
  });

  it("persists the switch before kicking off the reload", async () => {
    const order: string[] = [];
    setActiveCollectionMock.mockImplementation(async () => {
      order.push("setActiveCollection");
    });
    loadDocumentsMock.mockImplementation(() => {
      order.push("loadDocuments");
    });

    await useCollectionStore.getState().switchCollection("col-2");

    expect(order).toEqual(["setActiveCollection", "loadDocuments"]);
  });
});
