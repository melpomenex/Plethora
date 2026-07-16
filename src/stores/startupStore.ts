import { create } from "zustand";
import { getStartupSnapshot } from "../api/startup";
import type { StartupSnapshot, StartupSurface } from "../types/startup";
import { markSyncPhaseStart } from "../lib/sync/syncTelemetry";
import { useCollectionStore } from "./collectionStore";
import { useDocumentStore } from "./documentStore";
import { useQueueStore } from "./queueStore";

export type StartupStatus = "idle" | "loading" | "ready" | "error";

interface StartupState {
  status: StartupStatus;
  error: string | null;
  snapshot: StartupSnapshot | null;
  collectionId: string | null;
  lastSurface: StartupSurface | null;
  lastQueueMode: "due-today" | "due-all" | null;
  ensureStartup: (surface: StartupSurface, options?: { queueMode?: "due-today" | "due-all" }) => Promise<StartupSnapshot | null>;
  retryStartup: (surface?: StartupSurface) => Promise<StartupSnapshot | null>;
}

const inflight = new Map<string, Promise<StartupSnapshot | null>>();

function requestKey(collectionId: string, surface: StartupSurface, queueMode?: string): string {
  return `${collectionId}:${surface === "queue" ? `queue:${queueMode ?? "due-all"}` : "base"}`;
}

async function fallbackToLegacyLoads(surface: StartupSurface, queueMode?: "due-today" | "due-all"): Promise<void> {
  // A safe compatibility path for older native bundles or partially migrated
  // browser databases. Store loaders retain their existing error semantics and
  // this path runs once per failed coordinated request.
  await useCollectionStore.getState().loadCollections();
  await useDocumentStore.getState().loadDocuments();
  if (surface === "queue") {
    if (queueMode === "due-today") {
      await useQueueStore.getState().loadDueDocumentsOnly();
    } else {
      await useQueueStore.getState().loadQueue();
    }
  }
}

export const useStartupStore = create<StartupState>((set, get) => ({
  status: "idle",
  error: null,
  snapshot: null,
  collectionId: null,
  lastSurface: null,
  lastQueueMode: null,

  ensureStartup: (surface, options) => {
    const collectionId = useCollectionStore.getState().activeCollectionId;
    const key = requestKey(collectionId, surface, options?.queueMode);
    const existing = inflight.get(key);
    if (existing) return existing;

    const current = get();
    const alreadyReady =
      current.status === "ready" &&
      current.collectionId === collectionId &&
      (surface !== "queue" || (
        current.lastQueueMode === (options?.queueMode ?? "due-all") &&
        (current.snapshot?.queue.items.length !== 0 || current.snapshot?.queue.total === 0)
      ));
    if (alreadyReady && current.snapshot) return Promise.resolve(current.snapshot);

    set({
      status: "loading",
      error: null,
      lastSurface: surface,
      lastQueueMode: surface === "queue" ? (options?.queueMode ?? "due-all") : null,
    });
    const endCollectionPhase = markSyncPhaseStart("collections-ready");
    const endDocumentPhase = markSyncPhaseStart("first-document-data");
    const endQueuePhase = surface === "queue" ? markSyncPhaseStart("first-queue-data") : null;
    const promise = getStartupSnapshot({ surface, queueMode: options?.queueMode })
      .then((snapshot) => {
        // A collection switch during the request makes the response stale.
        // Before the first snapshot, the collection store starts with the
        // default id while the persisted active collection is still unknown;
        // do not reject the first authoritative response in that state.
        const collectionState = useCollectionStore.getState();
        if (collectionState.loaded && collectionState.activeCollectionId !== snapshot.activeCollectionId) {
          endCollectionPhase({ request: "get_startup_snapshot", surface });
          endDocumentPhase({ request: "get_startup_snapshot", surface });
          endQueuePhase?.({ request: "get_startup_snapshot", surface });
          return null;
        }
        useCollectionStore.getState().hydrateStartup(
          snapshot.collections,
          snapshot.activeCollectionId,
          snapshot.dueCount,
        );
        endCollectionPhase({
          records: snapshot.collections.length,
          request: "get_startup_snapshot",
          surface,
        });
        useDocumentStore.getState().hydrateStartupDocuments(snapshot.documents.items);
        if (surface === "queue") {
          useQueueStore.getState().hydrateStartupQueue(snapshot.queue.items);
        }
        set({
          status: "ready",
          error: null,
          snapshot,
          collectionId: snapshot.activeCollectionId,
          lastSurface: surface,
          lastQueueMode: surface === "queue" ? (options?.queueMode ?? "due-all") : null,
        });
        endDocumentPhase({
          records: snapshot.documents.items.length,
          hasMore: snapshot.documents.hasMore,
          request: "get_startup_snapshot",
          surface,
        });
        endQueuePhase?.({
          records: snapshot.queue.items.length,
          hasMore: snapshot.queue.hasMore,
          request: "get_startup_snapshot",
          surface,
        });
        return snapshot;
      })
      .catch(async (error) => {
        endCollectionPhase({ request: "get_startup_snapshot", surface });
        endDocumentPhase({ request: "get_startup_snapshot", surface });
        endQueuePhase?.({ request: "get_startup_snapshot", surface });
        try {
          await fallbackToLegacyLoads(surface, options?.queueMode);
          set({
            status: "ready",
            error: error instanceof Error ? error.message : "Startup snapshot unavailable; used legacy loads",
            collectionId: useCollectionStore.getState().activeCollectionId,
            lastSurface: surface,
            lastQueueMode: surface === "queue" ? (options?.queueMode ?? "due-all") : null,
          });
        } catch (fallbackError) {
          set({
            status: "error",
            error: fallbackError instanceof Error ? fallbackError.message : "Failed to load startup data",
            lastSurface: surface,
          });
        }
        return null;
      })
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  },

  retryStartup: (surface = get().lastSurface ?? "dashboard") => {
    set({ status: "idle", error: null });
    const queueMode = get().lastQueueMode;
    return get().ensureStartup(
      surface,
      surface === "queue" && queueMode ? { queueMode } : undefined,
    );
  },
}));

// A collection switch invalidates every collection-scoped startup response.
// The visible surface will request the new snapshot through a new key; late
// responses for the old collection are ignored by the coordinator above.
useCollectionStore.subscribe((state, previousState) => {
  if (state.activeCollectionId === previousState.activeCollectionId) return;
  useStartupStore.setState({
    status: "idle",
    error: null,
    snapshot: null,
    collectionId: state.activeCollectionId,
    lastQueueMode: null,
  });
});
