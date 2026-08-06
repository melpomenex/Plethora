import { create } from "zustand";
import {
  getCollections,
  createCollection as apiCreateCollection,
  updateCollection as apiUpdateCollection,
  deleteCollection as apiDeleteCollection,
  getActiveCollection,
  setActiveCollection as apiSetActiveCollection,
  getCollectionDueCount,
} from "../api/collections";
import { DEFAULT_COLLECTION_ID, type Collection } from "../types/collection";
import { useQueueStore } from "./queueStore";
import { useAnalyticsStore } from "./analyticsStore";
import { useDocumentStore } from "./documentStore";

interface CollectionState {
  collections: Collection[];
  activeCollectionId: string;
  dueCounts: Record<string, number>;
  loaded: boolean;

  loadCollections: () => Promise<void>;
  hydrateStartup: (collections: Collection[], activeCollectionId: string, dueCount: number) => void;
  createCollection: (name: string, icon?: string, color?: string) => Promise<Collection>;
  /** Like createCollection, but doesn't switch into it or reload documents/queue/stats. */
  createCollectionInBackground: (name: string, icon?: string, color?: string) => Promise<Collection>;
  renameCollection: (id: string, name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  switchCollection: (id: string) => Promise<void>;
  refreshDueCounts: () => Promise<void>;
}

export const useCollectionStore = create<CollectionState>()((set, get) => ({
  collections: [],
  activeCollectionId: DEFAULT_COLLECTION_ID,
  dueCounts: {},
  loaded: false,

  loadCollections: async () => {
    try {
      const [collections, activeId] = await Promise.all([
        getCollections(),
        getActiveCollection(),
      ]);
      set({
        collections,
        activeCollectionId: activeId || DEFAULT_COLLECTION_ID,
        loaded: true,
      });
    } catch (e) {
      console.error("Failed to load collections:", e);
      set({ loaded: true });
    }
  },

  hydrateStartup: (collections, activeCollectionId, dueCount) =>
    set((state) => ({
      collections,
      activeCollectionId: activeCollectionId || DEFAULT_COLLECTION_ID,
      dueCounts: {
        ...state.dueCounts,
        [activeCollectionId || DEFAULT_COLLECTION_ID]: dueCount,
      },
      loaded: true,
    })),

  createCollection: async (name, icon, color) => {
    const collection = await apiCreateCollection(name, icon, color);
    set((state) => ({
      collections: [...state.collections, collection],
      activeCollectionId: collection.id,
    }));
    await apiSetActiveCollection(collection.id);
    // Reload data for the new (empty) collection so stale documents don't linger.
    // Route through the shared, mode-aware chokepoint so the reload re-issues
    // the ACTIVE filter mode's query (see queueStore.reloadForCurrentMode).
    useDocumentStore.getState().loadDocuments();
    useQueueStore.getState().reloadForCurrentMode();
    useAnalyticsStore.getState().loadDashboardStats();
    return collection;
  },

  createCollectionInBackground: async (name, icon, color) => {
    const collection = await apiCreateCollection(name, icon, color);
    set((state) => ({ collections: [...state.collections, collection] }));
    return collection;
  },

  renameCollection: async (id, name) => {
    const updated = await apiUpdateCollection(id, name);
    set((state) => ({
      collections: state.collections.map((c) => (c.id === id ? updated : c)),
    }));
  },

  deleteCollection: async (id) => {
    await apiDeleteCollection(id);
    const state = get();
    const newCollections = state.collections.filter((c) => c.id !== id);
    const newActiveId =
      state.activeCollectionId === id
        ? DEFAULT_COLLECTION_ID
        : state.activeCollectionId;
    set({ collections: newCollections, activeCollectionId: newActiveId });
    if (state.activeCollectionId === id) {
      await apiSetActiveCollection(DEFAULT_COLLECTION_ID);
    }
  },

  switchCollection: async (id) => {
    set({ activeCollectionId: id });
    await apiSetActiveCollection(id);
    // loadDocuments() itself is authoritative for the new scope (and safely
    // discards a stale in-flight response if the user switches again before
    // it resolves) — it doesn't need help here. Pre-emptively clearing
    // documents before this fetch previously left the list stuck empty
    // whenever the fetch failed or was slow, which looked like the
    // collection's documents had vanished.
    useDocumentStore.getState().loadDocuments();
    // Route through the shared, mode-aware chokepoint so a collection switch
    // re-issues the ACTIVE filter mode's query rather than a raw loadQueue()
    // (see queueStore.reloadForCurrentMode). The view's load effect also
    // reconciles on activeCollectionId change; concurrent calls coalesce via
    // dedupeLoad.
    useQueueStore.getState().reloadForCurrentMode();
    useAnalyticsStore.getState().loadDashboardStats();
  },

  refreshDueCounts: async () => {
    const { collections } = get();
    const counts: Record<string, number> = {};
    await Promise.all(
      collections.map(async (c) => {
        try {
          counts[c.id] = await getCollectionDueCount(c.id);
        } catch {
          counts[c.id] = 0;
        }
      })
    );
    set({ dueCounts: counts });
  },
}));

// This subscription must be registered from this module. queueStore imports
// collectionStore too, so reading useCollectionStore while queueStore is
// evaluating hits the temporal-dead-zone and prevents the app from starting.
useCollectionStore.subscribe(() => {
  useQueueStore.getState().applyFilters();
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-device sync: refresh the store when a collection arrives from another
// device. The replication layer (src/lib/sync/entities/collections.ts) writes
// the row to SQLite then dispatches `incrementum:synced-collection(-deleted)`.
// Without this listener the sidebar / collection switcher wouldn't reflect the
// new collection until a manual reload. Debounced so a burst of arrivals (e.g.
// first-join backfill) triggers one reload, not N.
//
// Guarded to Tauri: in the browser/PWA dev shell there's no sync subsystem and
// getCollections() would hit a missing-invoke error.
let _collectionSyncReloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCollectionSyncReload(): void {
  if (typeof window === "undefined") return;
  if (_collectionSyncReloadTimer) clearTimeout(_collectionSyncReloadTimer);
  _collectionSyncReloadTimer = setTimeout(() => {
    _collectionSyncReloadTimer = null;
    void useCollectionStore.getState().loadCollections().catch(() => {
      /* best-effort; a transient failure just leaves the stale list until the
         next sync event or manual reload */
    });
  }, 200);
}

if (typeof window !== "undefined" &&
  (window as any).__incrementumCollectionSyncWired !== true) {
  (window as any).__incrementumCollectionSyncWired = true;
  window.addEventListener("incrementum:synced-collection", scheduleCollectionSyncReload);
  window.addEventListener("incrementum:synced-collection-deleted", scheduleCollectionSyncReload);
}
