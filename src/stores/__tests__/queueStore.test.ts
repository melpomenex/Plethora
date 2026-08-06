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
    const loadDueQueueItems = vi.fn().mockResolvedValue(undefined);
    const loadDueDocumentsOnly = vi.fn().mockResolvedValue(undefined);
    // reconcileIfDirty routes through reloadForCurrentMode; in the default
    // due-all mode that delegates to loadDueQueueItems, so stub all three so
    // the test is robust to the active mode.
    useQueueStore.setState({ loadQueue, loadDueQueueItems, loadDueDocumentsOnly });

    await useQueueStore.getState().reconcileIfDirty();
    expect(loadQueue).not.toHaveBeenCalled();
    expect(loadDueQueueItems).not.toHaveBeenCalled();
    expect(loadDueDocumentsOnly).not.toHaveBeenCalled();

    useQueueStore.setState({ hasLocalDeltas: true });
    await useQueueStore.getState().reconcileIfDirty();
    // Exactly one mode-appropriate loader ran once.
    const total =
      loadQueue.mock.calls.length +
      loadDueQueueItems.mock.calls.length +
      loadDueDocumentsOnly.mock.calls.length;
    expect(total).toBe(1);
  });
});

// Regression guard for the "queue reorders on reactivation" class of bugs
// (openspec/changes/stabilize-queue-order-on-reactivation). The displayed
// order is derived from store `items` via a deterministic sort, so the only
// way unrelated rows can move is if `items` is replaced wholesale. A
// single-item mutation that applies its result locally (applyItemDelta) must
// NOT trigger a follow-up full reload that swaps the whole array.
describe("queueStore order stability across mutations (stabilize-queue-order-on-reactivation)", () => {
  const order = () => useQueueStore.getState().filteredItems.map((i) => i.id);

  beforeEach(() => {
    const items = [
      { ...baseItem, id: "a", documentId: "doc-2", priority: 10 },
      { ...baseItem, id: "b", documentId: "doc-3", priority: 8 },
      { ...baseItem, id: "c", documentId: "doc-4", priority: 6 },
    ];
    // Stub all three loaders (the things reloadForCurrentMode delegates to) so
    // no real IPC fires. Crucially, do NOT overwrite reloadForCurrentMode
    // itself — that would leak a no-op mock into later describe blocks.
    const loadQueue = vi.fn().mockResolvedValue(undefined);
    const loadDueQueueItems = vi.fn().mockResolvedValue(undefined);
    const loadDueDocumentsOnly = vi.fn().mockResolvedValue(undefined);
    useQueueStore.setState({
      items,
      filteredItems: items,
      selectedIds: new Set<string>(),
      lastSelectedId: null,
      selectionBase: new Set<string>(),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "priority", direction: "desc" },
      hasLocalDeltas: false,
      queueFilterMode: "due-all",
      loadQueue,
      loadDueQueueItems,
      loadDueDocumentsOnly,
    });
    useQueueStore.getState().applyFilters();
  });

  it("reloadForCurrentMode dispatches to the active mode's loader, not a different query", async () => {
    const { loadQueue, loadDueQueueItems, loadDueDocumentsOnly } =
      useQueueStore.getState() as any;

    // due-all is the active mode → reloadForCurrentMode must call loadDueQueueItems
    // (the due-all loader), never loadQueue (the all-items loader).
    await useQueueStore.getState().reloadForCurrentMode();
    expect(loadDueQueueItems).toHaveBeenCalledTimes(1);
    expect(loadQueue).not.toHaveBeenCalled();
    expect(loadDueDocumentsOnly).not.toHaveBeenCalled();

    // Switching to all-items changes which loader the chokepoint uses.
    useQueueStore.setState({ queueFilterMode: "all-items" });
    await useQueueStore.getState().reloadForCurrentMode();
    expect(loadQueue).toHaveBeenCalledTimes(1);
  });

  it("a single-item mutation that applies locally does not reorder unrelated rows", () => {
    const before = order();
    expect(before).toEqual(["a", "b", "c"]);
    const { loadQueue, loadDueQueueItems, loadDueDocumentsOnly } =
      useQueueStore.getState() as any;

    // Simulate the success branch of a single-item postpone: the store patches
    // exactly that item locally (applyItemDelta). No full reload fires, so the
    // whole `items` array — the only thing that can move unrelated rows — is
    // never replaced. This is the regression guard: if a future change re-adds
    // an unconditional loadQueue()/reloadForCurrentMode() on this path, the
    // loader mock assertions below fail.
    useQueueStore.getState().applyItemDelta("b", { dueDate: "2027-01-01T00:00:00Z" });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(loadDueQueueItems).not.toHaveBeenCalled();
    expect(loadDueDocumentsOnly).not.toHaveBeenCalled();
    // Only b's row data changed; the id order is unchanged.
    expect(order()).toEqual(before);
  });
});

describe("queueStore setQueueFilterMode idempotency", () => {
  it("re-selecting the already-active filter mode does not reload the queue", async () => {
    const loadQueue = vi.fn().mockResolvedValue(undefined);
    const loadDueDocumentsOnly = vi.fn().mockResolvedValue(undefined);
    const loadDueQueueItems = vi.fn().mockResolvedValue(undefined);
    useQueueStore.setState({
      queueFilterMode: "due-today",
      loadQueue,
      loadDueDocumentsOnly,
      loadDueQueueItems,
    });

    // Re-selecting the mode the store is already in — e.g. a caller (like
    // MobileQueueView) re-running this on every tab-focus change — must not
    // trigger a fresh backend fetch, since that would visibly reload/reorder
    // an already-correct list for no reason.
    await useQueueStore.getState().setQueueFilterMode("due-today");
    expect(loadDueDocumentsOnly).not.toHaveBeenCalled();
    expect(loadDueQueueItems).not.toHaveBeenCalled();
    expect(loadQueue).not.toHaveBeenCalled();

    // A genuine mode change still reloads via the matching loader.
    await useQueueStore.getState().setQueueFilterMode("due-all");
    expect(loadDueQueueItems).toHaveBeenCalledTimes(1);
    expect(loadDueDocumentsOnly).not.toHaveBeenCalled();
    expect(useQueueStore.getState().queueFilterMode).toBe("due-all");
  });
});

describe("queueStore selection model (queue-multi-select)", () => {
  const rows = () => [
    { ...baseItem, id: "i0", documentId: "doc-2", priority: 10 },
    { ...baseItem, id: "i1", documentId: "doc-3", priority: 9 },
    { ...baseItem, id: "i2", documentId: "doc-4", priority: 8 },
    { ...baseItem, id: "i3", documentId: "doc-5", priority: 7 },
    { ...baseItem, id: "i4", documentId: "doc-6", priority: 6 },
    { ...baseItem, id: "i5", documentId: "doc-7", priority: 5 },
    { ...baseItem, id: "i6", documentId: "doc-8", priority: 4 },
  ];
  const renderedIds = () => rows().map((r) => r.id);
  const selected = () => Array.from(useQueueStore.getState().selectedIds).sort();

  beforeEach(() => {
    const items = rows();
    useQueueStore.setState({
      items,
      filteredItems: items,
      selectedIds: new Set<string>(),
      lastSelectedId: null,
      selectionBase: new Set<string>(),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "priority", direction: "desc" },
      hasLocalDeltas: false,
    });
  });

  const click = (id: string, mods?: { shift?: boolean; meta?: boolean }) =>
    useQueueStore.getState().setSelectionFromClick(id, renderedIds(), mods);

  it("plain click replaces the selection and sets the anchor", () => {
    click("i2");
    click("i3");
    click("i6");
    expect(selected()).toEqual(["i6"]);
    expect(useQueueStore.getState().lastSelectedId).toBe("i6");
  });

  it("shift+click selects a forward contiguous range", () => {
    click("i2");
    click("i6", { shift: true });
    expect(selected()).toEqual(["i2", "i3", "i4", "i5", "i6"]);
  });

  it("shift+click selects a backward contiguous range", () => {
    click("i6");
    click("i2", { shift: true });
    expect(selected()).toEqual(["i2", "i3", "i4", "i5", "i6"]);
  });

  it("successive shift+clicks re-derive the range instead of accumulating", () => {
    click("i2");
    click("i6", { shift: true });
    click("i4", { shift: true });
    // Pivots around the anchor: 5 and 6 drop back out.
    expect(selected()).toEqual(["i2", "i3", "i4"]);
  });

  it("shift+click with no anchor degrades to a plain click", () => {
    useQueueStore.setState({ lastSelectedId: null, selectedIds: new Set<string>() });
    click("i5", { shift: true });
    expect(selected()).toEqual(["i5"]);
    expect(useQueueStore.getState().lastSelectedId).toBe("i5");
  });

  it("cmd/ctrl+click adds without clearing the existing selection", () => {
    click("i0");
    click("i1", { meta: true });
    click("i6", { meta: true });
    expect(selected()).toEqual(["i0", "i1", "i6"]);
  });

  it("cmd/ctrl+click deselects an already-selected row", () => {
    click("i0");
    click("i1", { meta: true });
    click("i1", { meta: true });
    expect(selected()).toEqual(["i0"]);
  });

  it("shift+click after cmd+click extends from the toggled row and keeps prior picks", () => {
    click("i0");
    click("i4", { meta: true });
    click("i6", { shift: true });
    expect(selected()).toEqual(["i0", "i4", "i5", "i6"]);
  });

  it("selectAll covers every visible item, not just learning items", () => {
    useQueueStore.getState().selectAll();
    expect(selected()).toEqual(["i0", "i1", "i2", "i3", "i4", "i5", "i6"]);
  });

  it("selectAll respects an active search filter", () => {
    useQueueStore.setState({
      items: [
        { ...baseItem, id: "keep", documentId: "doc-2", documentTitle: "Kalman filters" },
        { ...baseItem, id: "drop", documentId: "doc-3", documentTitle: "Something else" },
      ],
      searchQuery: "kalman",
    });
    useQueueStore.getState().applyFilters();
    useQueueStore.getState().selectAll();
    expect(selected()).toEqual(["keep"]);
  });

  it("filtering out a selected row drops it from the selection", () => {
    click("i0");
    click("i2", { shift: true });
    expect(selected()).toEqual(["i0", "i1", "i2"]);

    useQueueStore.setState({ searchQuery: "" , filters: { minPriority: 9 } });
    useQueueStore.getState().applyFilters();
    // Only i0 (10) and i1 (9) survive the priority floor.
    expect(selected()).toEqual(["i0", "i1"]);
  });

  it("re-sorting preserves the selection", () => {
    click("i0");
    click("i2", { shift: true });
    useQueueStore.getState().setSortOptions({ field: "priority", direction: "asc" });
    expect(selected()).toEqual(["i0", "i1", "i2"]);
  });

  it("clearSelection resets the selection and the anchor", () => {
    click("i0");
    click("i3", { shift: true });
    useQueueStore.getState().clearSelection();
    expect(selected()).toEqual([]);
    expect(useQueueStore.getState().lastSelectedId).toBeNull();
  });
});

describe("queueStore optimistic bulk patching (queue-bulk-actions)", () => {
  const rows = () => [
    { ...baseItem, id: "a", documentId: "doc-2", priority: 10 },
    { ...baseItem, id: "b", documentId: "doc-3", priority: 20 },
    { ...baseItem, id: "c", documentId: "doc-4", priority: 30 },
  ];
  const priorityOf = (id: string) =>
    useQueueStore.getState().items.find((i) => i.id === id)?.priority;

  beforeEach(() => {
    const items = rows();
    useQueueStore.setState({
      items,
      filteredItems: items,
      selectedIds: new Set(["a", "b"]),
      lastSelectedId: "b",
      selectionBase: new Set(["a", "b"]),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "priority", direction: "desc" },
      hasLocalDeltas: false,
      loadStats: async () => {},
    });
  });

  it("applyItemDeltas patches every id in one pass and marks dirty", () => {
    useQueueStore.getState().applyItemDeltas(["a", "c"], { priority: 99 });
    expect(priorityOf("a")).toBe(99);
    expect(priorityOf("c")).toBe(99);
    expect(priorityOf("b")).toBe(20);
    expect(useQueueStore.getState().hasLocalDeltas).toBe(true);
  });

  it("applyItemDeltas with no ids is a no-op", () => {
    useQueueStore.getState().applyItemDeltas([], { priority: 99 });
    expect(priorityOf("a")).toBe(10);
    expect(useQueueStore.getState().hasLocalDeltas).toBe(false);
  });

  it("patches optimistically before the dispatch resolves", async () => {
    let observed: number | undefined;
    const pending = useQueueStore.getState().runBulkPatch(
      ["priority"],
      { priority: 75 },
      async () => {
        // Runs after the optimistic patch, before the store settles.
        observed = priorityOf("a");
        return { succeeded: ["a", "b"], failed: [], errors: [] };
      },
    );
    await pending;
    expect(observed).toBe(75);
    expect(priorityOf("a")).toBe(75);
    expect(priorityOf("b")).toBe(75);
  });

  it("rolls back only the ids the backend reported as failed", async () => {
    await useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async () => ({
      succeeded: ["a"],
      failed: ["b"],
      errors: ["b: nope"],
    }));

    expect(priorityOf("a")).toBe(75);
    // b reverts to its pre-submission value, a keeps the applied one.
    expect(priorityOf("b")).toBe(20);
  });

  it("rolls the whole patch back when the dispatch throws", async () => {
    await expect(
      useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async () => {
        throw new Error("ipc down");
      }),
    ).rejects.toThrow("ipc down");

    expect(priorityOf("a")).toBe(10);
    expect(priorityOf("b")).toBe(20);
    expect(useQueueStore.getState().error).toBe("ipc down");
  });

  it("clears the selection after a successful bulk mutation", async () => {
    await useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async () => ({
      succeeded: ["a", "b"],
      failed: [],
      errors: [],
    }));
    expect(useQueueStore.getState().selectedIds.size).toBe(0);
    expect(useQueueStore.getState().lastSelectedId).toBeNull();
  });

  it("keeps the selection when a dispatch fails, so the user can retry", async () => {
    await expect(
      useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async () => {
        throw new Error("ipc down");
      }),
    ).rejects.toThrow();
    expect(useQueueStore.getState().selectedIds.size).toBe(2);
  });

  it("dispatches exactly one call for the whole selection", async () => {
    let calls = 0;
    let receivedIds: string[] = [];
    await useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async (ids) => {
      calls += 1;
      receivedIds = ids;
      return { succeeded: ids, failed: [], errors: [] };
    });
    expect(calls).toBe(1);
    expect(receivedIds.sort()).toEqual(["a", "b"]);
  });

  it("does nothing when the selection is empty", async () => {
    useQueueStore.setState({ selectedIds: new Set<string>() });
    let calls = 0;
    const result = await useQueueStore.getState().runBulkPatch(["priority"], { priority: 75 }, async () => {
      calls += 1;
      return { succeeded: [], failed: [], errors: [] };
    });
    expect(calls).toBe(0);
    expect(result.succeeded).toEqual([]);
  });
});

describe("queueStore overdue sorting (queue-overdue-sort)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const order = () => useQueueStore.getState().filteredItems.map((i) => i.id);

  const seed = (items: any[]) => {
    useQueueStore.setState({
      items,
      filteredItems: items,
      selectedIds: new Set<string>(),
      lastSelectedId: null,
      selectionBase: new Set<string>(),
      searchQuery: "",
      filters: {},
      sortOptions: { field: "overdue", direction: "desc" },
    });
    useQueueStore.getState().applyFilters();
  };

  it("puts the most overdue item first when descending", () => {
    seed([
      { ...baseItem, id: "d10", documentId: "doc-2", dueDate: daysAgo(10) },
      { ...baseItem, id: "d3", documentId: "doc-3", dueDate: daysAgo(3) },
      { ...baseItem, id: "d25", documentId: "doc-4", dueDate: daysAgo(25) },
    ]);
    expect(order()).toEqual(["d25", "d10", "d3"]);
  });

  it("reverses the order when ascending", () => {
    seed([
      { ...baseItem, id: "d10", documentId: "doc-2", dueDate: daysAgo(10) },
      { ...baseItem, id: "d3", documentId: "doc-3", dueDate: daysAgo(3) },
      { ...baseItem, id: "d25", documentId: "doc-4", dueDate: daysAgo(25) },
    ]);
    useQueueStore.getState().setSortOptions({ field: "overdue", direction: "asc" });
    expect(order()).toEqual(["d3", "d10", "d25"]);
  });

  it("treats future-due, due-today and undated items as zero overdue", () => {
    seed([
      { ...baseItem, id: "future", documentId: "doc-2", dueDate: daysAhead(5) },
      { ...baseItem, id: "overdue5", documentId: "doc-3", dueDate: daysAgo(5) },
      { ...baseItem, id: "undated", documentId: "doc-4" },
      { ...baseItem, id: "today", documentId: "doc-5", dueDate: new Date().toISOString() },
    ]);
    // The genuinely overdue item leads; the three zero-overdue rows follow it.
    expect(order()[0]).toBe("overdue5");
    expect(order().slice(1).sort()).toEqual(["future", "today", "undated"]);
  });

  it("breaks ties deterministically so repeated renders match", () => {
    seed([
      { ...baseItem, id: "lo", documentId: "doc-2", dueDate: daysAgo(7), priority: 1 },
      { ...baseItem, id: "hi", documentId: "doc-3", dueDate: daysAgo(7), priority: 9 },
      { ...baseItem, id: "mid", documentId: "doc-4", dueDate: daysAgo(7), priority: 5 },
    ]);
    const first = order();
    useQueueStore.getState().applyFilters();
    expect(order()).toEqual(first);
    // Equal overdue days fall through to priority.
    expect(first).toEqual(["hi", "mid", "lo"]);
  });
});
