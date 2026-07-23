import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      documents: [{ id: "doc-1", isArchived: true }],
    }),
  },
}));

vi.mock("../collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({
      activeCollectionId: null,
      documentAssignments: {},
    }),
  },
}));

import { useQueueStore } from "../queueStore";

const baseItem = {
  documentTitle: "Title",
  itemType: "document" as const,
  priority: 1,
  estimatedTime: 5,
  tags: [] as string[],
  progress: 0,
};

describe("queueStore archived filtering", () => {
  beforeEach(() => {
    useQueueStore.setState({
      items: [],
      filteredItems: [],
      selectedIds: new Set<string>(),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "priority", direction: "desc" },
    });
  });

  it("excludes archived documents from filtered items", () => {
    const items = [
      { ...baseItem, id: "doc-1", documentId: "doc-1" },
      { ...baseItem, id: "doc-2", documentId: "doc-2" },
    ];

    useQueueStore.setState({ items, filteredItems: items });
    useQueueStore.getState().applyFilters();

    const filtered = useQueueStore.getState().filteredItems;
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.documentId).toBe("doc-2");
  });
});

describe("queueStore local delta application (queue-ipc-efficiency)", () => {
  beforeEach(() => {
    useQueueStore.setState({
      items: [],
      filteredItems: [],
      selectedIds: new Set<string>(),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "priority", direction: "desc" },
      hasLocalDeltas: false,
    });
  });

  const items = () => [
    { ...baseItem, id: "a", documentId: "doc-2", priority: 2 },
    { ...baseItem, id: "b", documentId: "doc-3", priority: 1 },
    { ...baseItem, id: "c", documentId: "doc-4", priority: 3 },
  ];

  it("applyItemDelta patches only the target item, refilters, and marks dirty", () => {
    useQueueStore.setState({ items: items() });

    useQueueStore.getState().applyItemDelta("b", { dueDate: "2027-01-01T00:00:00Z", priority: 9 });

    const state = useQueueStore.getState();
    expect(state.hasLocalDeltas).toBe(true);
    expect(state.items.find((i) => i.id === "b")?.dueDate).toBe("2027-01-01T00:00:00Z");
    expect(state.items.find((i) => i.id === "a")?.dueDate).toBeUndefined();
    // applyFilters re-sorted by priority desc: patched item now leads.
    expect(state.filteredItems[0]?.id).toBe("b");
  });

  it("removeItemsLocally drops exactly the given ids and marks dirty", () => {
    useQueueStore.setState({ items: items() });

    useQueueStore.getState().removeItemsLocally(["a", "c"]);

    const state = useQueueStore.getState();
    expect(state.hasLocalDeltas).toBe(true);
    expect(state.items.map((i) => i.id)).toEqual(["b"]);
    expect(state.filteredItems.map((i) => i.id)).toEqual(["b"]);
  });

  it("removeItemsLocally with no ids is a no-op and stays clean", () => {
    useQueueStore.setState({ items: items() });

    useQueueStore.getState().removeItemsLocally([]);

    expect(useQueueStore.getState().hasLocalDeltas).toBe(false);
    expect(useQueueStore.getState().items).toHaveLength(3);
  });

  it("reconcileIfDirty reloads only when local deltas were applied", async () => {
    const loadQueue = vi.fn().mockResolvedValue(undefined);
    useQueueStore.setState({ loadQueue });

    await useQueueStore.getState().reconcileIfDirty();
    expect(loadQueue).not.toHaveBeenCalled();

    useQueueStore.setState({ hasLocalDeltas: true });
    await useQueueStore.getState().reconcileIfDirty();
    expect(loadQueue).toHaveBeenCalledTimes(1);
  });
});
