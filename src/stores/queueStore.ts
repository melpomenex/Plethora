import { create } from "zustand";
import {
  getQueue,
  getDueDocumentsOnly,
  getDueQueueItems,
  getQueueStats,
  postponeItem,
  bulkSuspendItems,
  bulkUnsuspendItems,
  bulkDeleteItems,
  bulkUpdateItemPriorities,
  bulkPostponeItems,
  bulkMoveItemsToCollection,
  bulkUpdateItemTags,
  bulkSetItemLifecycle,
  type LifecycleTransition,
  type BulkOperationResult,
  type QueueStats
} from "../api/queue";
import { getLearningItem, getLearningItemsForPostpone } from "../api/learning-items";
import { useCollectionStore } from "./collectionStore";
import type { QueueItem, SortOptions, SearchFilters } from "../types";
import { useDocumentStore } from "./documentStore";
import { useSettingsStore } from "./settingsStore";
import { storeDueCountForSW } from "../utils/pushSubscription";
import { updateDueBadgeCount } from "../lib/feedback";
import {
  postponeElement,
  postponeAll as enginePostponeAll,
  computePriority,
  type PostponeConfig,
  type PostponeInput,
  type PostponeStats,
} from "../lib/postpone";

export type QueueFilterMode = "due-today" | "all-items" | "new-only" | "due-all";

/**
 * In-flight load dedupe. The queue views historically fired 2-3 overlapping
 * loads on every mount (multiple useEffects + setQueueFilterMode's internal
 * reload), which showed up as paired get_queue_items IPC calls ~30×/min and
 * caused sustained CPU + GC pressure (heating/jank) on mobile. Each loader
 * below coalesces concurrent calls with the same key into a single IPC round
 * trip — callers all await the same promise.
 */
const inflightLoads = new Map<string, Promise<void>>();

function dedupeLoad(key: string, run: () => Promise<void>): Promise<void> {
  const existing = inflightLoads.get(key);
  if (existing) return existing;
  const p = run().finally(() => {
    if (inflightLoads.get(key) === p) inflightLoads.delete(key);
  });
  inflightLoads.set(key, p);
  return p;
}

type DocRef = { id: string; isArchived?: boolean; isDismissed?: boolean };
let lastDocsRef: DocRef[] | null = null;
let lastArchivedSet: Set<string> = new Set();
let lastDismissedSet: Set<string> = new Set();

function getArchivedDismissedSets(documents: DocRef[]) {
  if (lastDocsRef === documents) {
    return { archived: lastArchivedSet, dismissed: lastDismissedSet };
  }
  const archived = new Set<string>();
  const dismissed = new Set<string>();
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (doc.isArchived) archived.add(doc.id);
    if (doc.isDismissed) dismissed.add(doc.id);
  }
  lastDocsRef = documents;
  lastArchivedSet = archived;
  lastDismissedSet = dismissed;
  return { archived, dismissed };
}

/**
 * Snapshot the fields a bulk action is about to overwrite, for exactly the ids
 * it touches. Rolling back from this is cheaper and more precise than cloning
 * the whole `items` array: on a partial failure only the ids the backend
 * reported as failed get restored.
 */
function snapshotFields(
  items: QueueItem[],
  ids: string[],
  fields: (keyof QueueItem)[],
): Map<string, Partial<QueueItem>> {
  const wanted = new Set(ids);
  const snapshot = new Map<string, Partial<QueueItem>>();
  for (const item of items) {
    if (!wanted.has(item.id)) continue;
    const before: Partial<QueueItem> = {};
    for (const field of fields) {
      (before as Record<string, unknown>)[field as string] = item[field];
    }
    snapshot.set(item.id, before);
  }
  return snapshot;
}

async function parallelWithLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (true) {
      const current = index++;
      if (current >= tasks.length) break;
      results[current] = await tasks[current]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}


/** Modifier keys that decide what a click does to the selection. */
export interface SelectionModifiers {
  /** Shift — extend from the anchor to the clicked row. */
  shift?: boolean;
  /** Cmd on macOS, Ctrl elsewhere — toggle one row, leave the rest. */
  meta?: boolean;
}

interface QueueState {
  // Data
  items: QueueItem[];
  filteredItems: QueueItem[];
  selectedIds: Set<string>;
  /**
   * Anchor for Shift+Click ranges, held as an item id rather than a list index.
   * The queue surfaces do not render the same list — ReviewQueueView layers
   * session-customization filters on top of `filteredItems` — so an index owned
   * by the store would address a different row depending on who asked. Callers
   * pass their own rendered id order to `setSelectionFromClick` instead.
   */
  lastSelectedId: string | null;
  /**
   * Selection as it stood when the anchor was last set. Shift+Click unions the
   * range onto *this*, not onto the live selection, which is what makes
   * successive Shift+Clicks re-derive the range (shrinking as well as growing)
   * while still preserving rows an earlier Cmd+Click picked out.
   */
  selectionBase: Set<string>;
  stats: QueueStats | null;
  customSubset: QueueItem[] | null;

  // UI State
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filters: SearchFilters;
  sortOptions: SortOptions;
  queueFilterMode: QueueFilterMode; // FSRS queue filter mode
  /**
   * Canonical key (JSON of the active query identity) of the query whose
   * results are currently in `items`, or null before the first load. Lives in
   * the store — not in component refs — so closing and reopening the Queue tab
   * does NOT reset it and re-run the first-load path (incl. the bounded startup
   * snapshot) against an already-loaded queue. See design decision D3.
   */
  loadedQueryKey: string | null;
  /**
   * True once the queue has completed its first load for the current session.
   * Gates the bounded startup-snapshot fast-path so it runs only on a genuine
   * first load — never re-applied over an already-loaded queue after a tab
   * close/reopen. Lives in the store (not a component ref) for the same reason
   * as `loadedQueryKey`: refs reset on unmount. See design D3.
   */
  hasCompletedFirstLoad: boolean;
  bulkOperationLoading: boolean;
  bulkOperationResult: BulkOperationResult | null;

  // Postpone state
  postponeLoading: boolean;
  postponeStats: PostponeStats | null;
  showAutoPostponePrompt: boolean;

  /**
   * True when single-item mutations have been applied to local state without
   * a queue reload (design D2). Queue views reconcile with a full reload when
   * they regain focus while this is set — see reconcileIfDirty.
   */
  hasLocalDeltas: boolean;

  /**
   * Apply a single-item mutation result to local queue state (no IPC): patch
   * the item, re-run filters/sort, and mark the store for focus reconcile.
   */
  applyItemDelta: (id: string, updates: Partial<QueueItem>) => void;
  /**
   * Batched `applyItemDelta`: one array pass and one `applyFilters()` for the
   * whole set, instead of one of each per item.
   */
  applyItemDeltas: (ids: string[], updates: Partial<QueueItem>) => void;
  /** Remove items from local queue state (suspend/delete mutations). */
  removeItemsLocally: (ids: string[]) => void;
  /** Full reload iff local deltas were applied since the last load. */
  reconcileIfDirty: () => Promise<void>;

  // Actions
  loadQueue: (forceAllItems?: boolean) => Promise<void>;
  loadDueDocumentsOnly: () => Promise<void>;
  loadDueQueueItems: () => Promise<void>;
  setQueueFilterMode: (mode: QueueFilterMode) => void;
  /**
   * The single shared, mode-aware chokepoint for reloading the queue after a
   * mutation or navigation. Re-issues the ACTIVE filter mode's query (not some
   * other query's result set) by delegating to the existing mode-specific
   * loader. Every post-mutation / reconcile reload MUST route through here
   * instead of calling `loadQueue()` directly — `loadQueue()` is mode-aware but
   * its intent is implicit, and a raw `loadQueue()` in a reconcile context is
   * exactly what has repeatedly swapped the displayed list out from under the
   * user (see openspec/changes/stabilize-queue-order-on-reactivation).
   */
  reloadForCurrentMode: () => Promise<void>;
  /** Record the canonical query key now loaded into `items` (see D3). */
  setLoadedQueryKey: (key: string | null) => void;
  /** Mark that the first load has completed, gating the startup snapshot path. */
  setHasCompletedFirstLoad: (done: boolean) => void;
  loadStats: () => Promise<void>;
  setItems: (items: QueueItem[]) => void;
  hydrateStartupQueue: (items: QueueItem[]) => void;
  setSelected: (id: string, selected: boolean) => void;
  /**
   * Resolve a row click into a new selection. `renderedIds` is the caller's own
   * visible row order — the store stays agnostic about how each surface filters.
   */
  setSelectionFromClick: (id: string, renderedIds: string[], mods?: SelectionModifiers) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setCustomSubset: (items: QueueItem[] | null) => void;
  setSearchQuery: (query: string) => void;
  setFilters: (filters: SearchFilters) => void;
  setSortOptions: (sort: SortOptions) => void;
  applyFilters: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Bulk operations
  postponeItem: (id: string, days: number) => Promise<void>;
  postponeItemSmart: (queueItem: QueueItem) => Promise<{ increase: number; newInterval: number }>;
  postponeAllItems: () => Promise<PostponeStats>;
  dismissAutoPostponePrompt: () => void;
  bulkSuspend: () => Promise<void>;
  bulkUnsuspend: () => Promise<void>;
  bulkDelete: () => Promise<void>;
  /** Internal: shared optimistic-patch + dispatch + partial-rollback path. */
  runBulkPatch: (
    fields: (keyof QueueItem)[],
    optimistic: Partial<QueueItem>,
    dispatch: (ids: string[]) => Promise<BulkOperationResult>,
  ) => Promise<BulkOperationResult>;
  bulkSetPriority: (slider: number) => Promise<BulkOperationResult>;
  bulkPostpone: (days: number) => Promise<BulkOperationResult>;
  bulkMoveToCollection: (collectionId: string) => Promise<BulkOperationResult>;
  bulkUpdateTags: (add: string[], remove: string[]) => Promise<BulkOperationResult>;
  bulkSetLifecycle: (transition: LifecycleTransition) => Promise<BulkOperationResult>;
  clearBulkResult: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  // Initial State
  items: [],
  filteredItems: [],
  selectedIds: new Set<string>(),
  lastSelectedId: null,
  selectionBase: new Set<string>(),
  stats: null,
  customSubset: null,
  isLoading: false,
  error: null,
  searchQuery: "",
  filters: {},
  sortOptions: {
    field: "priority",
    direction: "desc",
  },
  queueFilterMode: "due-all", // Default to due-only to avoid resurfacing reviewed items
  loadedQueryKey: null,
  hasCompletedFirstLoad: false,
  bulkOperationLoading: false,
  bulkOperationResult: null,
  postponeLoading: false,
  postponeStats: null,
  showAutoPostponePrompt: false,

  // Actions
  loadQueue: async (forceAllItems?: boolean) => {
    const mode = forceAllItems ? "all-items" : get().queueFilterMode;
    const collectionId = useCollectionStore.getState().activeCollectionId;
    return dedupeLoad(`loadQueue:${mode}:${collectionId ?? "default"}`, async () => {
      set({ isLoading: true, error: null });
      try {
        let items: QueueItem[] = [];
        switch (mode) {
          case "due-today":
            items = await getDueDocumentsOnly(collectionId);
            break;
          case "due-all":
            items = await getDueQueueItems(undefined, collectionId);
            break;
          case "all-items":
          case "new-only":
          default:
            items = await getQueue(collectionId);
            break;
        }
        const now = new Date();
        set({
          items,
          isLoading: false,
          // A fresh listing is server truth; clear the focus-reconcile flag.
          hasLocalDeltas: false,
          // ...and the rows it replaces, so a stale selection can't outlive them.
          selectedIds: new Set<string>(),
          lastSelectedId: null,
          selectionBase: new Set<string>(),
        });
        get().applyFilters();

        const settings = useSettingsStore.getState().settings;
        if (settings.learning.postpone.autoPostponeEnabled) {
          const overdueCount = items.filter((i) => {
            if (!i.dueDate) return true;
            return new Date(i.dueDate) < now;
          }).length;
          if (overdueCount > 0) {
            set({ showAutoPostponePrompt: true });
          }
        }
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load queue",
          isLoading: false,
        });
      }
    });
  },

  loadStats: async () => {
    try {
      const stats = await getQueueStats();
      set({ stats });
      void storeDueCountForSW(stats.due_today);
      void updateDueBadgeCount(stats.due_today);
    } catch (error) {
      console.error("Failed to load queue stats:", error);
    }
  },

  // Load only due documents (FSRS-scheduled with next_reading_date <= now or never read)
  loadDueDocumentsOnly: async () => {
    const collectionId = useCollectionStore.getState().activeCollectionId;
    return dedupeLoad(`loadDueDocumentsOnly:${collectionId ?? "default"}`, async () => {
      set({ isLoading: true, error: null });
      try {
        const items = await getDueDocumentsOnly(collectionId);
        set({
          items,
          isLoading: false,
          selectedIds: new Set<string>(),
          lastSelectedId: null,
          selectionBase: new Set<string>(),
        });
        get().applyFilters();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load due documents",
          isLoading: false,
        });
      }
    });
  },

  // Load due queue items (includes documents, extracts, and learning items)
  loadDueQueueItems: async () => {
    const collectionId = useCollectionStore.getState().activeCollectionId;
    return dedupeLoad(`loadDueQueueItems:${collectionId ?? "default"}`, async () => {
      set({ isLoading: true, error: null });
      try {
        const items = await getDueQueueItems(undefined, collectionId);
        set({
          items,
          isLoading: false,
          selectedIds: new Set<string>(),
          lastSelectedId: null,
          selectionBase: new Set<string>(),
        });
        get().applyFilters();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Failed to load due items",
          isLoading: false,
        });
      }
    });
  },

  // Set the queue filter mode and reload accordingly
  setQueueFilterMode: async (mode: QueueFilterMode) => {
    // No-op when the mode isn't actually changing. Callers that re-run this
    // on every tab-focus change (e.g. returning from Scroll Mode) would
    // otherwise force a full backend refetch — and thus a visible
    // reload/reorder of the list — for a selection that never changed.
    if (get().queueFilterMode === mode) return;
    set({ queueFilterMode: mode });
    // Reload queue based on the new filter mode, through the shared chokepoint
    // so the mode→loader mapping lives in exactly one place.
    await get().reloadForCurrentMode();
  },

  // The single shared, mode-aware reload chokepoint. Delegates to the loader
  // for the ACTIVE filter mode so a post-mutation / navigation reconcile always
  // re-issues the current query — never a different query's result set, which
  // is what has repeatedly reordered the list out from under the user.
  // Concurrent callers are safe: each underlying loader coalesces via
  // dedupeLoad. See design decision D1.
  reloadForCurrentMode: async () => {
    switch (get().queueFilterMode) {
      case "due-today":
        await get().loadDueDocumentsOnly();
        break;
      case "due-all":
        await get().loadDueQueueItems();
        break;
      case "all-items":
      case "new-only":
      default:
        await get().loadQueue();
        break;
    }
  },

  // Record the canonical key of the query whose results are now in `items`.
  // Computed by the view (it owns the inputs — queueMode, collection, semantic
  // study) and persisted here so it survives tab unmount. See design D3.
  setLoadedQueryKey: (key: string | null) => set({ loadedQueryKey: key }),
  setHasCompletedFirstLoad: (done: boolean) => set({ hasCompletedFirstLoad: done }),

  setItems: (items) =>
    set({
      items,
      filteredItems: items,
    }),

  hydrateStartupQueue: (items) => {
    const existing = get().items;
    if (existing.length > items.length && items.length <= 50) {
      return;
    }
    set({ items, filteredItems: items, isLoading: false, error: null });
    get().applyFilters();
  },

  setSelected: (id, selected) =>
    set((state) => {
      const newSelected = new Set(state.selectedIds);
      if (selected) {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
      return { selectedIds: newSelected, lastSelectedId: id, selectionBase: new Set(newSelected) };
    }),

  setSelectionFromClick: (id, renderedIds, mods) =>
    set((state) => {
      // Cmd/Ctrl+Click: toggle this row only, and re-anchor here so a following
      // Shift+Click extends from where the user actually last clicked.
      if (mods?.meta) {
        const next = new Set(state.selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { selectedIds: next, lastSelectedId: id, selectionBase: new Set(next) };
      }

      // Shift+Click: base ∪ [anchor..clicked]. The anchor deliberately does not
      // move, so repeated Shift+Clicks pivot around it.
      if (mods?.shift && state.lastSelectedId !== null) {
        const from = renderedIds.indexOf(state.lastSelectedId);
        const to = renderedIds.indexOf(id);
        if (from !== -1 && to !== -1) {
          const next = new Set(state.selectionBase);
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
            next.add(renderedIds[i]);
          }
          return { selectedIds: next, lastSelectedId: state.lastSelectedId, selectionBase: state.selectionBase };
        }
      }

      // Plain click — and Shift with no usable anchor, which per spec degrades
      // to a plain click rather than doing nothing.
      const single = new Set([id]);
      return { selectedIds: single, lastSelectedId: id, selectionBase: new Set(single) };
    }),

  // Every rendered item, not just learning items: the bulk actions all accept
  // mixed types, so narrowing here made documents and extracts unselectable
  // through select-all for no reason. Callers wanting one type filter their own.
  selectAll: () =>
    set((state) => {
      const newSelected = new Set(state.filteredItems.map((item) => item.id));
      return { selectedIds: newSelected, lastSelectedId: null, selectionBase: new Set(newSelected) };
    }),

  clearSelection: () =>
    set({ selectedIds: new Set<string>(), lastSelectedId: null, selectionBase: new Set<string>() }),
  setCustomSubset: (items) => set({ customSubset: items }),

  setSearchQuery: (query) => {
    set({ searchQuery: query });
    get().applyFilters();
  },

  setFilters: (filters) => {
    set({ filters });
    get().applyFilters();
  },

  setSortOptions: (sort) => {
    set({ sortOptions: sort });
    get().applyFilters();
  },

  hasLocalDeltas: false,

  applyItemDelta: (id, updates) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
      hasLocalDeltas: true,
    }));
    get().applyFilters();
  },

  applyItemDeltas: (ids, updates) => {
    if (ids.length === 0) return;
    // One pass and one applyFilters for the whole batch. Looping applyItemDelta
    // would copy the array and re-run every filter once per selected item —
    // 200 array copies and 200 filter passes for a 200-item bulk action.
    const target = new Set(ids);
    set((state) => ({
      items: state.items.map((item) => (target.has(item.id) ? { ...item, ...updates } : item)),
      hasLocalDeltas: true,
    }));
    get().applyFilters();
  },

  removeItemsLocally: (ids) => {
    if (ids.length === 0) return;
    const remove = new Set(ids);
    set((state) => ({
      items: state.items.filter((item) => !remove.has(item.id)),
      hasLocalDeltas: true,
    }));
    get().applyFilters();
  },

  reconcileIfDirty: async () => {
    if (!get().hasLocalDeltas) return;
    await get().reloadForCurrentMode();
  },

  applyFilters: () => {
    const { items, searchQuery, filters, sortOptions } = get();
    const documents = useDocumentStore.getState().documents;
    const { archived: archivedDocumentIds, dismissed: dismissedDocumentIds } = getArchivedDismissedSets(documents as any);

    const hasArchived = archivedDocumentIds.size > 0;
    const hasDismissed = dismissedDocumentIds.size > 0;
    const query = searchQuery ? searchQuery.toLowerCase() : "";
    const hasQuery = query.length > 0;
    const categoryFilter = filters.categories && filters.categories.length > 0 ? new Set(filters.categories) : null;
    const tagFilter = filters.tags && filters.tags.length > 0 ? new Set(filters.tags) : null;
    const minP = filters.minPriority;
    const maxP = filters.maxPriority;

    const filtered: QueueItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (hasArchived && item.documentId && archivedDocumentIds.has(item.documentId)) continue;
      if (hasDismissed && item.documentId && dismissedDocumentIds.has(item.documentId)) continue;
      if (hasQuery) {
        const title = item.documentTitle;
        const lowerTitle = title.toLowerCase();
        if (!lowerTitle.includes(query)) {
          const tags = item.tags;
          if (!tags || !tags.some((t) => t.toLowerCase().includes(query))) continue;
        }
      }
      if (categoryFilter && !categoryFilter.has(item.category || "")) continue;
      if (tagFilter) {
        const tags = item.tags;
        if (!tags || !tags.some((t) => tagFilter.has(t))) continue;
      }
      if (minP !== undefined && item.priority < minP) continue;
      if (maxP !== undefined && item.priority > maxP) continue;
      filtered.push(item);
    }

    const field = sortOptions.field;
    const dir = sortOptions.direction === "asc" ? 1 : -1;
    if (field === "priority") {
      filtered.sort((a, b) => dir * (a.priority - b.priority));
    } else if (field === "overdue") {
      // Whole days past due, same expression as reviewUx.ts. Items due today,
      // due later, or with no due date at all are 0, so they never displace a
      // genuinely overdue item from the top of a descending sort. Ties fall
      // through to priority so repeated renders stay stable.
      const now = Date.now();
      const overdueDays = (item: QueueItem) => {
        if (!item.dueDate) return 0;
        const due = new Date(item.dueDate).getTime();
        if (Number.isNaN(due)) return 0;
        return Math.max(0, Math.floor((now - due) / 86_400_000));
      };
      filtered.sort((a, b) => {
        const delta = overdueDays(a) - overdueDays(b);
        return delta !== 0 ? dir * delta : b.priority - a.priority;
      });
    } else {
      filtered.sort((a, b) => {
        const av = a.documentTitle;
        const bv = b.documentTitle;
        return dir * av.localeCompare(bv);
      });
    }

    // A row the user can no longer see must not stay selected, or a bulk action
    // would silently hit items outside the visible queue. Only pay for the
    // pruning pass when something is actually selected — applyFilters runs on
    // every search keystroke.
    const { selectedIds, lastSelectedId } = get();
    if (selectedIds.size === 0) {
      set({ filteredItems: filtered });
      return;
    }

    const visible = new Set(filtered.map((item) => item.id));
    let dropped = false;
    const stillSelected = new Set<string>();
    selectedIds.forEach((id) => {
      if (visible.has(id)) stillSelected.add(id);
      else dropped = true;
    });

    set({
      filteredItems: filtered,
      ...(dropped
        ? {
            selectedIds: stillSelected,
            selectionBase: new Set(stillSelected),
          }
        : {}),
      // Keep the anchor across a re-sort — only give it up once the row it
      // points at is gone, otherwise a background delta would quietly downgrade
      // the next Shift+Click to a plain click.
      ...(lastSelectedId !== null && !visible.has(lastSelectedId) ? { lastSelectedId: null } : {}),
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  /**
   * Map queue items to PostponeInput using settings and available data.
   * For learning items, fetches full data from the API.
   * For documents, uses the document store.
   */
  postponeItemSmart: async (queueItem) => {
    const settings = useSettingsStore.getState().settings;
    const ps = settings.learning.postpone;
    const config: PostponeConfig = {
      itemIncrease: ps.itemIncrease,
      itemMinIncrease: ps.itemMinIncrease,
      itemMaxIncrease: ps.itemMaxIncrease,
      itemCap: ps.itemCap,
      itemFloor: ps.itemFloor,
      topicIncrease: ps.topicIncrease,
      topicMinIncrease: ps.topicMinIncrease,
      topicMaxIncrease: ps.topicMaxIncrease,
      topicCap: ps.topicCap,
      topicFloor: ps.topicFloor,
      minElapsed: ps.minElapsed,
      minPriority: ps.minPriority,
      minPriority2: ps.minPriority2,
      minStability: ps.minStability,
      topicPriorityMin: ps.topicPriorityMin,
      topicRepMin: ps.topicRepMin,
      topicElapsedMin: ps.topicElapsedMin,
      randomize: ps.randomize,
      simpleMode: ps.simpleMode,
      checkItemSkip: true,
      checkTopicSkip: true,
      skipTopics: false,
    };

    const now = new Date();

    if (queueItem.itemType === "document") {
      const docs = useDocumentStore.getState().documents;
      const doc = docs.find((d) => d.id === queueItem.documentId);
      if (!doc) throw new Error("Document not found");

      const lastReview = doc.dateLastReviewed ? new Date(doc.dateLastReviewed) : null;
      const daysSinceReview = lastReview
        ? Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86400000))
        : 0;
      const interval = doc.nextReadingDate
        ? Math.max(0, Math.floor((new Date(doc.nextReadingDate).getTime() - now.getTime()) / 86400000))
        : 0;

      const input: PostponeInput = {
        id: queueItem.id,
        type: "topic",
        interval,
        priority: queueItem.priority,
        stability: doc.stability ?? 1,
        difficulty: doc.difficulty ?? 3,
        reviewCount: doc.reps ?? doc.readingCount ?? 0,
        lapses: 0,
        daysSinceReview,
      };

      const result = postponeElement(input, config);
      if (result.postponed) {
        // Single-item mutation: apply the server-returned due date locally
        // instead of re-fetching the whole queue (design D2); fall back to a
        // full reload if the response can't be mapped onto this item.
        const newDueDate = await postponeItem(queueItem.id, result.increase, "document");
        if (newDueDate) {
          get().applyItemDelta(queueItem.id, { dueDate: newDueDate });
        } else {
          await get().reloadForCurrentMode();
        }
      }
      return { increase: result.increase, newInterval: result.newInterval };
    }

    // Learning item
    const itemId = queueItem.learningItemId ?? queueItem.id;
    // Fetch a single item by id instead of pulling the entire learning_items table.
    const item = await getLearningItem(itemId);
    if (!item) throw new Error("Learning item not found");

    const stability = item.memory_state?.stability ?? 1;
    const difficulty = item.memory_state?.difficulty ?? item.difficulty ?? 3;
    const lastReview = item.last_review_date ? new Date(item.last_review_date) : null;
    const daysSinceReview = lastReview
      ? Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86400000))
      : 0;

    const input: PostponeInput = {
      id: queueItem.id,
      type: "item",
      interval: item.interval,
      priority: computePriority(stability, difficulty, item.lapses),
      stability,
      difficulty,
      reviewCount: item.review_count,
      lapses: item.lapses,
      daysSinceReview,
    };

    const result = postponeElement(input, config);
    if (result.postponed) {
      const newDueDate = await postponeItem(queueItem.id, result.increase);
      if (newDueDate) {
        get().applyItemDelta(queueItem.id, { dueDate: newDueDate });
      } else {
        await get().reloadForCurrentMode();
      }
    }
    return { increase: result.increase, newInterval: result.newInterval };
  },

  /**
   * Postpone all items in the current queue using the algorithm-aware engine.
   */
  postponeAllItems: async () => {
    const { filteredItems } = get();
    if (filteredItems.length === 0) {
      return { totalItems: 0, postponedCount: 0, skippedCount: 0, totalIncrease: 0, averageIncrease: 0 };
    }

    set({ postponeLoading: true, error: null, postponeStats: null });
    try {
      const settings = useSettingsStore.getState().settings;
      const ps = settings.learning.postpone;
      const config: PostponeConfig = {
        itemIncrease: ps.itemIncrease,
        itemMinIncrease: ps.itemMinIncrease,
        itemMaxIncrease: ps.itemMaxIncrease,
        itemCap: ps.itemCap,
        itemFloor: ps.itemFloor,
        topicIncrease: ps.topicIncrease,
        topicMinIncrease: ps.topicMinIncrease,
        topicMaxIncrease: ps.topicMaxIncrease,
        topicCap: ps.topicCap,
        topicFloor: ps.topicFloor,
        minElapsed: ps.minElapsed,
        minPriority: ps.minPriority,
        minPriority2: ps.minPriority2,
        minStability: ps.minStability,
        topicPriorityMin: ps.topicPriorityMin,
        topicRepMin: ps.topicRepMin,
        topicElapsedMin: ps.topicElapsedMin,
        randomize: ps.randomize,
        simpleMode: ps.simpleMode,
        checkItemSkip: true,
        checkTopicSkip: true,
        skipTopics: false,
      };

      const now = new Date();
      const docs = useDocumentStore.getState().documents;
      const docMap = new Map(docs.map((d) => [d.id, d]));

      // Fetch only the scheduling fields for the learning items that are
      // actually in the filtered queue. The previous path called
      // getAllLearningItems (a full SELECT * including all card text) and built
      // a Map of full rows just to read a few fields — pulling the entire
      // library into the heap. This projection returns only what the postpone
      // engine reads.
      const queueLearningItemIds = filteredItems
        .map((qi) => qi.learningItemId)
        .filter((id): id is string => !!id);
      const postponeItems = queueLearningItemIds.length > 0
        ? await getLearningItemsForPostpone(queueLearningItemIds)
        : [];
      const liMap = new Map(postponeItems.map((li) => [li.id, li]));

      const inputs: PostponeInput[] = [];
      const queueItemMap = new Map<string, QueueItem>();

      for (const qi of filteredItems) {
        queueItemMap.set(qi.id, qi);

        if (qi.itemType === "document") {
          const doc = docMap.get(qi.documentId);
          if (!doc) continue;

          const lastReview = doc.dateLastReviewed ? new Date(doc.dateLastReviewed) : null;
          const daysSinceReview = lastReview
            ? Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86400000))
            : 0;
          const interval = doc.nextReadingDate
            ? Math.max(0, Math.floor((new Date(doc.nextReadingDate).getTime() - now.getTime()) / 86400000))
            : 0;

          inputs.push({
            id: qi.id,
            type: "topic",
            interval,
            priority: qi.priority,
            stability: doc.stability ?? 1,
            difficulty: doc.difficulty ?? 3,
            reviewCount: doc.reps ?? doc.readingCount ?? 0,
            lapses: 0,
            daysSinceReview,
          });
        } else if (qi.learningItemId) {
          const item = liMap.get(qi.learningItemId);
          if (!item) continue;

          const stability = item.memory_state_stability ?? 1;
          const difficulty = item.memory_state_difficulty ?? item.difficulty ?? 3;
          const lastReview = item.last_review_date ? new Date(item.last_review_date) : null;
          const daysSinceReview = lastReview
            ? Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86400000))
            : 0;

          inputs.push({
            id: qi.id,
            type: "item",
            interval: item.interval,
            priority: computePriority(stability, difficulty, item.lapses),
            stability,
            difficulty,
            reviewCount: item.review_count,
            lapses: item.lapses,
            daysSinceReview,
          });
        }
      }

      const { results, stats } = enginePostponeAll(inputs, config);

      const toPersist = results.filter((r) => r.postponed);
      if (toPersist.length > 0) {
        const tasks = toPersist.map((result) => () => postponeItem(result.id, result.increase));
        await parallelWithLimit(tasks, 6);
      }

      set({ postponeStats: stats, postponeLoading: false });
      await get().reloadForCurrentMode();
      await get().loadStats();
      return stats;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to postpone items",
        postponeLoading: false,
      });
      throw error;
    }
  },

  dismissAutoPostponePrompt: () => set({ showAutoPostponePrompt: false }),

  postponeItem: async (id, days) => {
    try {
      const item = get().items.find((i) => i.id === id);
      const newDueDate = await postponeItem(
        id,
        days,
        item?.itemType === "document" ? "document" : undefined,
      );
      if (newDueDate) {
        // Apply the mutation locally instead of reloading the whole queue
        // (design D2); fall back to a reload when the response is unmappable.
        get().applyItemDelta(id, { dueDate: newDueDate });
      } else {
        await get().reloadForCurrentMode();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to postpone item",
      });
      throw error;
    }
  },

  bulkSuspend: async () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;

    set({ bulkOperationLoading: true, error: null, bulkOperationResult: null });
    try {
      const result = await bulkSuspendItems(Array.from(selectedIds));
      set({ bulkOperationResult: result, bulkOperationLoading: false });

      // Release the selection so the action bar does not survive its own
      // action, matching bulkDelete.
      set({ selectedIds: new Set<string>(), lastSelectedId: null, selectionBase: new Set<string>() });
      // Suspended items leave the queue: drop exactly the succeeded ids
      // locally instead of re-transferring the whole listing (design D2).
      get().removeItemsLocally(result.succeeded);
      await get().loadStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to suspend items",
        bulkOperationLoading: false,
      });
      throw error;
    }
  },

  bulkUnsuspend: async () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;

    set({ bulkOperationLoading: true, error: null, bulkOperationResult: null });
    try {
      const result = await bulkUnsuspendItems(Array.from(selectedIds));
      set({ bulkOperationResult: result, bulkOperationLoading: false });

      // Release the selection so the action bar does not survive its own
      // action, matching bulkDelete.
      set({ selectedIds: new Set<string>(), lastSelectedId: null, selectionBase: new Set<string>() });
      // Reload queue to get updated data
      await get().reloadForCurrentMode();
      await get().loadStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to unsuspend items",
        bulkOperationLoading: false,
      });
      throw error;
    }
  },

  bulkDelete: async () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;

    set({ bulkOperationLoading: true, error: null, bulkOperationResult: null });
    try {
      const result = await bulkDeleteItems(Array.from(selectedIds));
      set({ bulkOperationResult: result, bulkOperationLoading: false });

      // Clear selection and drop exactly the deleted ids locally (design D2).
      set({ selectedIds: new Set<string>(), lastSelectedId: null, selectionBase: new Set<string>() });
      get().removeItemsLocally(result.succeeded);
      await get().loadStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete items",
        bulkOperationLoading: false,
      });
      throw error;
    }
  },

  /**
   * Shared path for the bulk actions that mutate items in place (as opposed to
   * removing them, which suspend/delete already handle). Patches local state
   * immediately, dispatches one IPC call, then rolls back exactly the ids the
   * backend reported as failed — a batch that half-succeeds leaves the half
   * that worked applied.
   */
  runBulkPatch: async (
    fields: (keyof QueueItem)[],
    optimistic: Partial<QueueItem>,
    dispatch: (ids: string[]) => Promise<BulkOperationResult>,
  ): Promise<BulkOperationResult> => {
    const ids = Array.from(get().selectedIds);
    const empty: BulkOperationResult = { succeeded: [], failed: [], errors: [] };
    if (ids.length === 0) return empty;

    const before = snapshotFields(get().items, ids, fields);
    set({ bulkOperationLoading: true, error: null, bulkOperationResult: null });
    get().applyItemDeltas(ids, optimistic);

    try {
      const result = await dispatch(ids);
      // Restore only what the backend refused; everything else stays patched.
      for (const id of result.failed) {
        const original = before.get(id);
        if (original) get().applyItemDelta(id, original);
      }
      set({
        bulkOperationResult: result,
        bulkOperationLoading: false,
        selectedIds: new Set<string>(),
        lastSelectedId: null,
        selectionBase: new Set<string>(),
      });
      await get().loadStats();
      return result;
    } catch (error) {
      // Total failure: undo the whole optimistic patch.
      for (const [id, original] of before) get().applyItemDelta(id, original);
      set({
        error: error instanceof Error ? error.message : "Bulk operation failed",
        bulkOperationLoading: false,
      });
      throw error;
    }
  },

  bulkSetPriority: async (slider) =>
    get().runBulkPatch(["priority"], { priority: Math.max(0, Math.min(100, slider)) }, (ids) =>
      bulkUpdateItemPriorities(ids, slider),
    ),

  bulkPostpone: async (days) => {
    // The new due date is the backend's to decide (it scales documents by their
    // interval_modifier), so patch nothing optimistically beyond marking the
    // rows dirty; the reconcile reload brings back exact dates.
    const result = await get().runBulkPatch([], {}, (ids) => bulkPostponeItems(ids, days));
    await get().reloadForCurrentMode();
    return result;
  },

  bulkMoveToCollection: async (collectionId) =>
    get().runBulkPatch([], {}, (ids) => bulkMoveItemsToCollection(ids, collectionId)),

  bulkUpdateTags: async (add, remove) =>
    get().runBulkPatch([], {}, (ids) => bulkUpdateItemTags(ids, add, remove)),

  bulkSetLifecycle: async (transition) => {
    const ids = Array.from(get().selectedIds);
    const empty: BulkOperationResult = { succeeded: [], failed: [], errors: [] };
    if (ids.length === 0) return empty;

    set({ bulkOperationLoading: true, error: null, bulkOperationResult: null });
    try {
      const result = await bulkSetItemLifecycle(ids, transition);
      set({
        bulkOperationResult: result,
        bulkOperationLoading: false,
        selectedIds: new Set<string>(),
        lastSelectedId: null,
        selectionBase: new Set<string>(),
      });
      // Done and Dismiss take items out of the queue; Forget keeps them but
      // resets their schedule, so it needs a reload rather than a removal.
      if (transition === "forget") {
        await get().reloadForCurrentMode();
      } else {
        get().removeItemsLocally(result.succeeded);
      }
      await get().loadStats();
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update items",
        bulkOperationLoading: false,
      });
      throw error;
    }
  },

  clearBulkResult: () => set({ bulkOperationResult: null }),
}));
