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
  type BulkOperationResult,
  type QueueStats
} from "../api/queue";
import { getAllLearningItems, getLearningItem } from "../api/learning-items";
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


interface QueueState {
  // Data
  items: QueueItem[];
  filteredItems: QueueItem[];
  selectedIds: Set<string>;
  stats: QueueStats | null;
  customSubset: QueueItem[] | null;

  // UI State
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filters: SearchFilters;
  sortOptions: SortOptions;
  queueFilterMode: QueueFilterMode; // FSRS queue filter mode
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
  /** Remove items from local queue state (suspend/delete mutations). */
  removeItemsLocally: (ids: string[]) => void;
  /** Full reload iff local deltas were applied since the last load. */
  reconcileIfDirty: () => Promise<void>;

  // Actions
  loadQueue: (forceAllItems?: boolean) => Promise<void>;
  loadDueDocumentsOnly: () => Promise<void>;
  loadDueQueueItems: () => Promise<void>;
  setQueueFilterMode: (mode: QueueFilterMode) => void;
  loadStats: () => Promise<void>;
  setItems: (items: QueueItem[]) => void;
  hydrateStartupQueue: (items: QueueItem[]) => void;
  setSelected: (id: string, selected: boolean) => void;
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
  clearBulkResult: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  // Initial State
  items: [],
  filteredItems: [],
  selectedIds: new Set<string>(),
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
    set({ queueFilterMode: mode });
    // Reload queue based on the new filter mode
    switch (mode) {
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

  setItems: (items) =>
    set({
      items,
      filteredItems: items,
    }),

  hydrateStartupQueue: (items) => {
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
      return { selectedIds: newSelected };
    }),

  selectAll: () =>
    set((state) => {
      const newSelected = new Set<string>();
      state.filteredItems.forEach((item) => {
        if (item.itemType === "learning-item") {
          newSelected.add(item.id);
        }
      });
      return { selectedIds: newSelected };
    }),

  clearSelection: () => set({ selectedIds: new Set<string>() }),
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
    await get().loadQueue();
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
    } else {
      filtered.sort((a, b) => {
        const av = a.documentTitle;
        const bv = b.documentTitle;
        return dir * av.localeCompare(bv);
      });
    }

    set({ filteredItems: filtered });
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
          await get().loadQueue();
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
        await get().loadQueue();
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

      const allLearningItems = await getAllLearningItems();
      const liMap = new Map(allLearningItems.map((li) => [li.id, li]));

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

          const stability = item.memory_state?.stability ?? 1;
          const difficulty = item.memory_state?.difficulty ?? item.difficulty ?? 3;
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
      await get().loadQueue();
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
        await get().loadQueue();
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

      // Reload queue to get updated data
      await get().loadQueue();
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
      set({ selectedIds: new Set<string>() });
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

  clearBulkResult: () => set({ bulkOperationResult: null }),
}));
