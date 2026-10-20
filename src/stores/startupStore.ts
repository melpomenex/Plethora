import { create } from "zustand";
import { getStartupSnapshot } from "../api/startup";
import { isNativeAndroid, waitForBackendReady } from "../lib/tauri";
import {
  classifyAndroidStartupFailure,
  recordAndroidStartupDiagnostic,
} from "../lib/startupDiagnostics";
import type { StartupSnapshot, StartupSurface } from "../types/startup";
import { useCollectionStore } from "./collectionStore";
import { useDocumentStore } from "./documentStore";
import { useQueueStore } from "./queueStore";
import { useSavedQueueStore } from "./savedQueueStore";

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
const requestGenerations = new Map<string, number>();
const surfaceGenerations = new Map<string, number>();
let collectionEpoch = 0;

// The Android readiness gate can take longer than an individual data query,
// so only start this watchdog after the shared backend-ready gate succeeds.
const SNAPSHOT_REQUEST_TIMEOUT_MS = 8_000;
const ANDROID_STARTUP_MAX_ATTEMPTS = 3;
const ANDROID_STARTUP_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const SNAPSHOT_TIMEOUT = Symbol("snapshot-timeout");

function requestKey(collectionId: string, surface: StartupSurface, queueMode?: string): string {
  return `${collectionEpoch}:${collectionId}:${surface === "queue" ? `queue:${queueMode ?? "due-all"}` : "base"}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestSnapshotWithTimeout(
  surface: StartupSurface,
  options?: { queueMode?: "due-today" | "due-all" },
): Promise<StartupSnapshot> {
  const request = getStartupSnapshot({ surface, queueMode: options?.queueMode });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      request,
      new Promise<typeof SNAPSHOT_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(SNAPSHOT_TIMEOUT), SNAPSHOT_REQUEST_TIMEOUT_MS);
      }),
    ]);
    if (result === SNAPSHOT_TIMEOUT) throw new Error("Startup snapshot request timed out");
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fallbackToLegacyLoads(surface: StartupSurface, queueMode?: "due-today" | "due-all"): Promise<void> {
  // A safe compatibility path for older native bundles or partially migrated
  // browser databases. Store loaders retain their existing error semantics and
  // this path runs once per failed coordinated request.
  await useCollectionStore.getState().loadCollections();
  await useDocumentStore.getState().loadDocuments();
  await useSavedQueueStore.getState().loadSavedQueues(useCollectionStore.getState().activeCollectionId);
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
    const generation = (requestGenerations.get(key) ?? 0) + 1;
    requestGenerations.set(key, generation);
    const surfaceKey = `${collectionEpoch}:${collectionId}:${surface === "queue" ? "queue" : "base"}`;
    const surfaceGeneration = (surfaceGenerations.get(surfaceKey) ?? 0) + 1;
    surfaceGenerations.set(surfaceKey, surfaceGeneration);
    const android = isNativeAndroid();

    if (android) {
      const documentState = useDocumentStore.getState();
      if (!documentState.hasCompletedFirstLoad && documentState.documents.length === 0) {
        useDocumentStore.setState({ isLoading: true, error: null });
      }
      if (surface === "queue") {
        const queueState = useQueueStore.getState();
        if (!queueState.hasCompletedFirstLoad && queueState.items.length === 0) {
          useQueueStore.setState({ isLoading: true, error: null });
        }
      }
    }

    const isCurrentRequest = () =>
      requestGenerations.get(key) === generation &&
      surfaceGenerations.get(surfaceKey) === surfaceGeneration &&
      key.startsWith(`${collectionEpoch}:`);

    const applySnapshot = async (snapshot: StartupSnapshot): Promise<StartupSnapshot | null> => {
      if (!isCurrentRequest()) return null;
      // Before first hydration, the collection store starts with the default
      // id while the persisted active collection is still unknown. Accept the
      // first authoritative snapshot, then reject any stale scoped response.
      const collectionState = useCollectionStore.getState();
      if (collectionState.loaded && collectionState.activeCollectionId !== snapshot.activeCollectionId) return null;

      useCollectionStore.getState().hydrateStartup(
        snapshot.collections,
        snapshot.activeCollectionId,
        snapshot.dueCount,
      );
      await useDocumentStore.getState().hydrateStartupDocuments(snapshot.documents.items, isCurrentRequest);
      if (!isCurrentRequest()) return null;
      if (surface === "queue") {
        useQueueStore.getState().hydrateStartupQueue(snapshot.queue.items);
      }
      void useSavedQueueStore.getState().loadSavedQueues(snapshot.activeCollectionId);
      if (android) {
        recordAndroidStartupDiagnostic("snapshot-hydrated", {
          surface,
          outcome: snapshot.documents.items.length + snapshot.queue.items.length > 0 ? "populated" : "empty",
          documents: snapshot.documents.items.length,
          queueItems: snapshot.queue.items.length,
          dueCount: snapshot.dueCount,
        });
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
    };

    const runAndroidStartup = async (): Promise<StartupSnapshot | null> => {
      let lastError: unknown = new Error("Failed to load startup data");
      for (let attempt = 1; attempt <= ANDROID_STARTUP_MAX_ATTEMPTS; attempt += 1) {
        try {
          // This gate is shared with every invokeCommand. Waiting before the
          // request watchdog avoids treating slow database migrations as a
          // failed/empty startup query.
          await waitForBackendReady();
          const snapshot = await requestSnapshotWithTimeout(surface, options);
          const applied = await applySnapshot(snapshot);
          if (applied) return applied;
          return null;
        } catch (error) {
          lastError = error;
          if (!isCurrentRequest()) return null;
          if (attempt < ANDROID_STARTUP_MAX_ATTEMPTS) {
            const backoffMs = ANDROID_STARTUP_RETRY_DELAYS_MS[attempt - 1];
            recordAndroidStartupDiagnostic("snapshot-retry", {
              surface,
              attempt,
              outcome: "retrying",
              failureKind: classifyAndroidStartupFailure(error),
            });
            await delay(backoffMs);
            continue;
          }
        }
      }

      if (!isCurrentRequest()) return null;
      const message = lastError instanceof Error ? lastError.message : "Failed to load startup data";
      // A failed refresh must leave the last successful rows intact while
      // still exposing the terminal error and manual retry affordance.
      useDocumentStore.setState({ isLoading: false, error: message });
      if (surface === "queue") {
        useQueueStore.setState({ isLoading: false, error: message });
      }
      recordAndroidStartupDiagnostic("snapshot-request-failed", {
        surface,
        attempt: ANDROID_STARTUP_MAX_ATTEMPTS,
        outcome: "error",
        failureKind: classifyAndroidStartupFailure(lastError),
      });
      set({
        status: "error",
        error: message,
        lastSurface: surface,
        lastQueueMode: surface === "queue" ? (options?.queueMode ?? "due-all") : null,
      });
      return null;
    };

    const runLegacyStartup = async (): Promise<StartupSnapshot | null> => {
      let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
      const snapshotTimeout = new Promise<null>((resolve) => {
        snapshotTimer = setTimeout(() => resolve(null), SNAPSHOT_REQUEST_TIMEOUT_MS);
      });
      try {
        const snapshot = await Promise.race([
          getStartupSnapshot({ surface, queueMode: options?.queueMode }),
          snapshotTimeout,
        ]);
        if (snapshot === null) {
          set({ status: "idle" });
          return null;
        }
        return await applySnapshot(snapshot);
      } catch (error) {
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
      } finally {
        if (snapshotTimer !== undefined) clearTimeout(snapshotTimer);
      }
    };

    const promise = (android ? runAndroidStartup() : runLegacyStartup())
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
  collectionEpoch += 1;
  useDocumentStore.setState({ hasCompletedFirstLoad: false, isLoading: false, error: null });
  useQueueStore.setState({ hasCompletedFirstLoad: false, loadedQueryKey: null, isLoading: false, error: null });
  useStartupStore.setState({
    status: "idle",
    error: null,
    snapshot: null,
    collectionId: state.activeCollectionId,
    lastQueueMode: null,
  });
  void useSavedQueueStore.getState().loadSavedQueues(state.activeCollectionId);
});
