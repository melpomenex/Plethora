/**
 * Idempotent boot chain for the cross-device sync subsystems.
 *
 * This wires the shared Yjs doc to every entity that replicates across devices:
 *   getYjsSync → file sync + entities (parallel) → auto-download → backfill.
 *
 * Each `ensure*Ready()` / `start*()` call is itself idempotent, and we further
 * guard the whole chain with a single module-level promise so repeated callers
 * (boot, the SyncSettings toggle, the room-join handler) share one in-flight
 * initialization. This matters on mobile: the chain must NOT run eagerly during
 * bootstrap (it allocates a large heap footprint that has caused boot OOM on
 * Android — see commit 524f087a), but it MUST run before the user expects
 * flashcards / documents to mirror across devices.
 *
 * Callers:
 *   - `main.tsx` (desktop): deferred past first paint.
 *   - `main.tsx` (mobile): deferred past first paint to keep the cold-start
 *     memory spike off the critical path.
 *   - `SyncSettings.tsx`: when the user toggles real-time sync ON or joins a
 *     room, so the subsystems come up immediately on a first-time enable.
 */

import { scheduleProgressiveSyncWork } from "./sync/progressiveScheduler";
import { measureSyncPhase, installSyncLongTaskObserver, removeSyncLongTaskObserver } from "./sync/syncTelemetry";
import { getSyncFeatureFlags } from "./sync/featureFlags";
import { drainSyncOutboxBatch } from "./sync/syncJournal";
import { registerSyncAdapter } from "./sync/coverageRegistry";

let startPromise: Promise<void> | null = null;
let outboxDrainTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Run the sync subsystem boot chain exactly once per session. Subsequent calls
 * return the same promise. Never throws — every step is internally best-effort
 * and a failure in one entity must not prevent the others from initializing.
 */
export function startSyncSubsystems(): Promise<void> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const removeLongTaskObserver = installSyncLongTaskObserver();
    // 1. Shared Yjs doc + websocket provider + IndexedDB persistence.
    //    Everything below depends on the doc, so this runs first.
    const { getYjsSync } = await import("./yjsSync");
    const sync = await scheduleProgressiveSyncWork({
      id: "sync:provider-setup",
      lane: "P1",
      maxRetries: 0,
      run: () => measureSyncPhase("provider-setup", () => withTimeout(
        getYjsSync(),
        4000,
        "[startSyncSubsystems] getYjsSync timed out (4s), continuing in degraded mode",
      )),
    }).catch((err) => {
      console.warn("[startSyncSubsystems] getYjsSync failed, sync will be unavailable:", err);
      return null;
    });

    if (!sync) {
      // getYjsSync failed — nothing below can work. Return early so the
      // startPromise is marked resolved; the caller (main.tsx) continues
      // normally without sync. A later room-join / toggle will retry.
      removeLongTaskObserver();
      return;
    }

    // Warm up the clock cache before replaying entity maps
    try {
      const { syncClockCache } = await import("./sync/clockCache");
      await measureSyncPhase("clock-cache-init", () => syncClockCache.initialize());
    } catch (err) {
      console.warn("[startSyncSubsystems] clock cache warmup failed (non-fatal):", err);
    }

    // 2. Prepare all entity init modules in parallel (dynamic imports).
    const [
      { ensureFileSyncReady },
      { ensureDocumentReplicationReady },
      { ensureCollectionSyncReady },
      { ensureExtractSyncReady },
      { ensureConversationSyncReady },
      { ensureFlashcardSyncReady },
      { ensureRssSyncReady },
      { ensurePodcastSyncReady },
      { ensureFileAvailabilityIntentReady },
    ] = await Promise.all([
      import("./useFileSync").then((m) => ({ ensureFileSyncReady: m.ensureFileSyncReady })),
      import("./documentReplication").then((m) => ({
        ensureDocumentReplicationReady: m.ensureDocumentReplicationReady,
      })),
      import("./sync/entities/collections").then((m) => ({
        ensureCollectionSyncReady: m.ensureCollectionSyncReady,
      })),
      import("./sync/entities/extracts").then((m) => ({
        ensureExtractSyncReady: m.ensureExtractSyncReady,
      })),
      import("./sync/entities/conversations").then((m) => ({
        ensureConversationSyncReady: m.ensureConversationSyncReady,
      })),
      import("./sync/entities/flashcards").then((m) => ({
        ensureFlashcardSyncReady: m.ensureFlashcardSyncReady,
      })),
      import("./sync/entities/rss").then((m) => ({ ensureRssSyncReady: m.ensureRssSyncReady })),
      import("./sync/entities/podcasts").then((m) => ({
        ensurePodcastSyncReady: m.ensurePodcastSyncReady,
      })),
      import("./sync/fileAvailabilityIntent").then((m) => ({
        ensureFileAvailabilityIntentReady: m.ensureFileAvailabilityIntentReady,
      })),
    ]);

    // 3. Run file sync AND all entity initializations concurrently.
    //    File sync depends on the Yjs doc (already ready), entity init depends
    //    on the Yjs doc (already ready). They are independent of each other.
    const { startAutoFileSyncDownload } = await import("./autoFileSyncDownload");

    registerSyncAdapter("documents", ensureDocumentReplicationReady);
    registerSyncAdapter("collections", ensureCollectionSyncReady);
    registerSyncAdapter("extracts", ensureExtractSyncReady);
    registerSyncAdapter("conversations", ensureConversationSyncReady);
    registerSyncAdapter("learningItems", ensureFlashcardSyncReady);
    registerSyncAdapter("rssFeeds", ensureRssSyncReady);
    registerSyncAdapter("podcastFeeds", ensurePodcastSyncReady);
    registerSyncAdapter("fileAvailabilityIntent", ensureFileAvailabilityIntentReady);

    await Promise.all([
      measureSyncPhase("map-ready", () => ensureFileSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] file sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureDocumentReplicationReady()).catch((err) =>
        console.warn("[startSyncSubsystems] document replication init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureCollectionSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] collection sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureExtractSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] extract sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureConversationSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] conversation sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureFlashcardSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] flashcard sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureRssSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] RSS sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensurePodcastSyncReady()).catch((err) =>
        console.warn("[startSyncSubsystems] podcast sync init failed:", err),
      ),
      measureSyncPhase("map-ready", () => ensureFileAvailabilityIntentReady()).catch((err) =>
        console.warn("[startSyncSubsystems] file availability intent init failed:", err),
      ),
    ]);

    // 4. Auto-download watcher — needs file sync ready.
    await scheduleProgressiveSyncWork({
      id: "sync:auto-download-watch",
      lane: "P2",
      run: () => startAutoFileSyncDownload(),
    }).catch((err) =>
      console.warn("[startSyncSubsystems] auto-download init failed:", err),
    );

    // 5. First-join backfill: publish the local library into the shared doc so
    //    other devices receive it. Background, non-fatal.
    const { runSyncMigrationIfNeeded } = await import("./sync/migrate");
    await scheduleProgressiveSyncWork({
      id: "sync:first-join-migration",
      lane: "P2",
      run: () => measureSyncPhase("migration", () => runSyncMigrationIfNeeded()),
    }).catch((e) =>
      console.warn("[startSyncSubsystems] sync migration failed (non-fatal)", e),
    );
    if (getSyncFeatureFlags().journaledProjection) {
      const drain = () => {
        void scheduleProgressiveSyncWork({
          id: "sync:outbox-drain",
          lane: "P2",
          run: () => drainSyncOutboxBatch(50),
        })
          .catch((e) => console.warn("[startSyncSubsystems] outbox drain failed", e))
          .finally(() => {
            outboxDrainTimer = setTimeout(drain, 1500);
          });
      };
      drain();
    }
    removeLongTaskObserver();
  })().catch((error) => {
    // Reset so a later caller can retry. The individual ensure*Ready() helpers
    // are themselves idempotent and will short-circuit whatever already came up.
    console.error("[startSyncSubsystems] sync subsystem initialization failed:", error);
    // A failed boot must not leave a PerformanceObserver attached forever.
    removeSyncLongTaskObserver();
    startPromise = null;
    throw error;
  });

  return startPromise;
}

/**
 * Run a timeout guard around a promise. If the promise doesn't settle within
 * `ms`, we log a warning and continue. This ensures the sync boot can't block
 * app startup indefinitely (e.g. if IndexedDB is slow or Argon2id stalls).
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  warnMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn(warnMessage);
      reject(new Error("timeout"));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether the sync subsystem boot chain has already been kicked off this
 * session. UI code uses this to decide whether a toggle/room-join needs to
 * explicitly call `startSyncSubsystems()` (it does when this is false).
 */
export function isSyncSubsystemsStarted(): boolean {
  return startPromise !== null;
}

/** Test-only: reset the singleton so a fresh chain can be exercised. */
export function __resetSyncSubsystemsForTest(): void {
  startPromise = null;
}
