import { create } from "zustand";
import { getStartupSnapshot } from "../api/startup";
import type { StartupSnapshot, StartupSurface } from "../types/startup";
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

// On a cold Android WebView the first IPC round-trip can stall ~30s inside
// the bridge even though the backend is up (see the retrying readiness gate
// in lib/tauri.ts). A hung snapshot request would also pin this module's
// inflight entry — every later ensureStartup with the same key would share
// the dead promise forever. Race the request against this timeout and
// resolve null: the finally below frees the inflight slot, so the next call
// issues a fresh request instead of waiting for the user to navigate away
// and back.
const SNAPSHOT_REQUEST_TIMEOUT_MS = 8_000;

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
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    const snapshotTimeout = new Promise<null>((resolve) => {
      snapshotTimer = setTimeout(() => resolve(null), SNAPSHOT_REQUEST_TIMEOUT_MS);
    });
    const promise = Promise.race([
      getStartupSnapshot({ surface, queueMode: options?.queueMode }),
      snapshotTimeout,
    ])
      .then((snapshot) => {
        if (snapshot === null) {
          // Transport stall, not a data error: free the telemetry phases and
          // reset the status machine so a retry starts cleanly. The legacy
          // fallback deliberately does NOT run — its invokes would queue
          // behind the same stalled bridge.
          set({ status: "idle" });
          return null;
        }
        // A collection switch during the request makes the response stale.
        // Before the first snapshot, the collection store starts with the
        // default id while the persisted active collection is still unknown;
        // do not reject the first authoritative response in that state.
        const collectionState = useCollectionStore.getState();
        if (collectionState.loaded && collectionState.activeCollectionId !== snapshot.activeCollectionId) {
          return null;
        }
        useCollectionStore.getState().hydrateStartup(
          snapshot.collections,
          snapshot.activeCollectionId,
          snapshot.dueCount,
        );
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
        return snapshot;
      })
      .catch(async (error) => {
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
        if (snapshotTimer !== undefined) clearTimeout(snapshotTimer);
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
