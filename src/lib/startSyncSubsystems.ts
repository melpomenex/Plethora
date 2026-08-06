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
 *
 * The delta-log cutover orchestrator (step 4a) and the outbox drain loop (step
 * 6) are additionally gated on `isYjsSyncEnabled()`, so with real-time sync OFF
 * they never start and emit no telemetry; the drain loop also re-checks the
 * flag every tick so toggling OFF mid-session halts it within one tick.
 */

import { scheduleProgressiveSyncWork } from "./sync/progressiveScheduler";
import { measureStartupPhase, installSyncLongTaskObserver, removeSyncLongTaskObserver } from "./sync/syncTelemetry";
import { getSyncFeatureFlags } from "./sync/featureFlags";
import { drainSyncOutboxBatch } from "./sync/syncJournal";
import { registerSyncAdapter } from "./sync/coverageRegistry";
import { compactYjsPersistence, needsCompaction } from "./sync/yjsCompaction";

let startPromise: Promise<void> | null = null;
let outboxDrainTimer: ReturnType<typeof setTimeout> | null = null;
let outboxDrainActive = false;
let compactionTimer: ReturnType<typeof setInterval> | null = null;

/** How often the recurring compaction sweep runs while the app is open. */
const COMPACTION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Stop the outbox drain loop and clear its pending timer. Called from the
 * sync-off path (stopDeltaLogTransport) so that toggling real-time sync off
 * mid-session halts every recurring sync activity within one tick — including
 * the delta-log-push-drain telemetry the drain emits on every iteration.
 * Safe to call when the loop was never started (no-op).
 */
export function stopOutboxDrainLoop(): void {
  outboxDrainActive = false;
  if (outboxDrainTimer) {
    clearTimeout(outboxDrainTimer);
    outboxDrainTimer = null;
  }
}

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
    const { getYjsSync, isYjsSyncEnabled } = await import("./yjsSync");
    const sync = await scheduleProgressiveSyncWork({
      id: "sync:provider-setup",
      lane: "P1",
      maxRetries: 0,
      kind: "atomic",
      run: async (context) => {
        if (context.shouldYield()) await context.yield();
        return measureStartupPhase("provider-setup", () => withTimeout(
          getYjsSync(),
          4000,
          "[startSyncSubsystems] getYjsSync timed out (4s), continuing in degraded mode",
        ));
      },
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
      await measureStartupPhase("clock-cache-init", () => syncClockCache.initialize());
    } catch (err) {
      console.warn("[startSyncSubsystems] clock cache warmup failed (non-fatal):", err);
    }

    // Compact the y-indexeddb update log before the entity maps replay the doc.
    // On a long-lived install the log can hold millions of update rows that
    // fetchUpdates already materialized into the heap during getYjsSync();
    // snapshotting now collapses them to a single row so every FUTURE cold boot
    // replays one row instead of the whole history. Skipped when the log is
    // small or the feature flag is off. Non-fatal and non-blocking.
    if (getSyncFeatureFlags().yjsCompaction && sync.persistence) {
      const persistence = sync.persistence;
      await scheduleProgressiveSyncWork({
        id: "sync:yjs-compaction",
        lane: "P3",
        kind: "sliceable",
        run: () => compactYjsPersistence(persistence),
      }).catch((err) =>
        console.warn("[startSyncSubsystems] yjs compaction failed (non-fatal):", err),
      );
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
    ] = await measureStartupPhase("module-imports", () => Promise.all([
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
    ]));

    // 3. Run replicators through the scheduler in small waves. They all touch
    // the same Yjs document, so an unbounded Promise.all only compounds their
    // peak memory; two-at-a-time preserves useful overlap without nine-way
    // amplification. The order favors surfaces users open first.
    const { startAutoFileSyncDownload } = await import("./autoFileSyncDownload");

    registerSyncAdapter("documents", ensureDocumentReplicationReady);
    registerSyncAdapter("collections", ensureCollectionSyncReady);
    registerSyncAdapter("extracts", ensureExtractSyncReady);
    registerSyncAdapter("conversations", ensureConversationSyncReady);
    registerSyncAdapter("learningItems", ensureFlashcardSyncReady);
    registerSyncAdapter("rssFeeds", ensureRssSyncReady);
    registerSyncAdapter("podcastFeeds", ensurePodcastSyncReady);
    registerSyncAdapter("fileAvailabilityIntent", ensureFileAvailabilityIntentReady);

    const replicators: Array<[string, () => Promise<void>]> = [
      ["collections", ensureCollectionSyncReady],
      ["documents", ensureDocumentReplicationReady],
      ["flashcards", ensureFlashcardSyncReady],
      ["extracts", ensureExtractSyncReady],
      ["conversations", ensureConversationSyncReady],
      ["rss", ensureRssSyncReady],
      ["podcasts", ensurePodcastSyncReady],
      ["fileSync", ensureFileSyncReady],
      ["fileAvailabilityIntent", ensureFileAvailabilityIntentReady],
    ];
    const runReplicator = ([label, ensureReady]: [string, () => Promise<void>]) =>
      scheduleProgressiveSyncWork({
        id: `sync:replicator:${label}`,
        lane: "P2",
        kind: "sliceable",
        maxRetries: 0,
        run: async (context) => {
          if (context.shouldYield()) await context.yield();
          await measureStartupPhase(`replicator:${label}`, ensureReady);
        },
      }).catch((err) => console.warn(`[startSyncSubsystems] ${label} init failed:`, err));
    for (let i = 0; i < replicators.length; i += 2) {
      await Promise.all(replicators.slice(i, i + 2).map(runReplicator));
    }

    // 4a. Delta-log cutover orchestrator (migrate-sync-to-delta-log Phase 6).
    // Only runs when the user has opted a room in (deltaLogSync flag). It
    // starts the delta-log transport (pull loop, presence, outbox publishers)
    // and advances the room's cutover state machine one phase per boot up to
    // `verified`; P5+ stay user-driven from the migration panel. Purely
    // additive — when the flag is off this is a complete no-op and the Yjs
    // path is untouched, so rollback stays safe. Placed after the replicators
    // so the drain targets (each replicated map) are initialized, and before
    // the first-join backfill so a fresh room seeds into both transports.
    if (getSyncFeatureFlags().deltaLogSync && isYjsSyncEnabled()) {
      try {
        // Register drain targets from the already-initialized adapters so
        // runDrainPhase can enumerate every domain. count() is diagnostic-only
        // (the gate is scheduler quiescence + zero dead-letters, not count),
        // and the live map size isn't exposed without threading accessors
        // through every entity module — report 0, which the drain result still
        // records as a per-domain placeholder.
        const { registerCutoverDrainTarget } = await import("./sync/cutoverTargets");
        const drainAdapter: Array<[string, () => Promise<void>]> = [
          ["documents", ensureDocumentReplicationReady],
          ["collections", ensureCollectionSyncReady],
          ["extracts", ensureExtractSyncReady],
          ["learningItems", ensureFlashcardSyncReady],
          ["assistantConversations", ensureConversationSyncReady],
          ["rssFeeds", ensureRssSyncReady],
          ["podcastFeeds", ensurePodcastSyncReady],
          ["fileAvailabilityIntent", ensureFileAvailabilityIntentReady],
        ];
        for (const [domain, ensureReady] of drainAdapter) {
          registerCutoverDrainTarget({ domain, ensureReady, count: () => 0 });
        }
      } catch (err) {
        console.warn("[startSyncSubsystems] cutover drain-target registration failed (non-fatal)", err);
      }
      // Fire-and-forget: the orchestrator must NOT block the boot chain. It
      // reads ~thousands of SQLite rows during the P2 seed phase, and awaiting
      // it here made first-paint stall ~19s (the seed ran on the critical
      // path instead of in the background). Schedule it and move on — the
      // transport start + phase advance happen asynchronously after the UI is
      // interactive. The scheduler still yields to input between slices.
      void scheduleProgressiveSyncWork({
        id: "sync:delta-log-cutover",
        lane: "P2",
        kind: "sliceable",
        run: async (context) => {
          if (context.shouldYield()) await context.yield();
          await measureStartupPhase("delta-log-cutover", () =>
            import("./sync/deltaLog/cutoverOrchestrator").then((m) => m.runCutoverOrchestrator()),
          );
        },
      }).catch((err) =>
        console.warn("[startSyncSubsystems] delta-log cutover orchestrator failed (non-fatal)", err),
      );
    }

    // 4b. Auto-download watcher — needs file sync ready.
    await scheduleProgressiveSyncWork({
      id: "sync:auto-download-watch",
      lane: "P2",
      kind: "sliceable",
      run: (context) => measureStartupPhase("auto-download-watch", () => startAutoFileSyncDownload(context)),
    }).catch((err) =>
      console.warn("[startSyncSubsystems] auto-download init failed", err),
    );

    // 5. First-join backfill: publish the local library into the shared doc so
    //    other devices receive it. Background, non-fatal.
    const { runSyncMigrationIfNeeded } = await import("./sync/migrate");
    await scheduleProgressiveSyncWork({
      id: "sync:first-join-migration",
      lane: "P2",
      kind: "sliceable",
      run: (context) => measureStartupPhase("first-join-migration", () => runSyncMigrationIfNeeded(undefined, context)),
    }).catch((e) =>
      console.warn("[startSyncSubsystems] sync migration failed (non-fatal)", e),
    );
    // The outbox drain loop runs when journaled projection is on OR when the
    // delta-log cutover is active — the seed phase (P2) enqueues its rows
    // through the same outbox, and the delta-log outbox publishers (registered
    // by the orchestrator's transport start) are what turn those rows into
    // POST /ops pushes. Without a running drain, seed rows would sit pending.
    // The loop RE-CHECKS isYjsSyncEnabled() on every iteration (and before
    // re-arming) so toggling real-time sync OFF mid-session halts the drain —
    // and its delta-log-push-drain telemetry — within one tick instead of
    // firing forever.
    if ((getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) && isYjsSyncEnabled()) {
      outboxDrainActive = true;
      const drain = () => {
        if (!outboxDrainActive || !isYjsSyncEnabled()) {
          outboxDrainActive = false;
          if (outboxDrainTimer) {
            clearTimeout(outboxDrainTimer);
            outboxDrainTimer = null;
          }
          return;
        }
        void scheduleProgressiveSyncWork({
          id: "sync:outbox-drain",
          lane: "P2",
          run: () => drainSyncOutboxBatch(50),
        })
          .catch((e) => console.warn("[startSyncSubsystems] outbox drain failed", e))
          .finally(() => {
            if (!outboxDrainActive || !isYjsSyncEnabled()) {
              if (outboxDrainTimer) {
                clearTimeout(outboxDrainTimer);
                outboxDrainTimer = null;
              }
              return;
            }
            outboxDrainTimer = setTimeout(drain, 1500);
          });
      };
      drain();
    }

    // Recurring y-indexeddb compaction sweep. Long-running sessions keep
    // accumulating update rows (the library's auto-trim only fires for local
    // non-persistence-origin updates, never for network replay). This collapses
    // the log periodically so the NEXT cold boot stays cheap. The sweep no-ops
    // when the log is under the threshold (see needsCompaction).
    if (getSyncFeatureFlags().yjsCompaction && sync.persistence) {
      const persistence = sync.persistence;
      compactionTimer = setInterval(() => {
        if (!needsCompaction(persistence)) return;
        void scheduleProgressiveSyncWork({
          id: "sync:yjs-compaction-recurring",
          lane: "P3",
          run: () => compactYjsPersistence(persistence),
        }).catch((err) =>
          console.warn("[startSyncSubsystems] recurring yjs compaction failed (non-fatal):", err),
        );
      }, COMPACTION_INTERVAL_MS);
    }

    removeLongTaskObserver();
  })().catch((error) => {
    // Reset so a later caller can retry. The individual ensure*Ready() helpers
    // are themselves idempotent and will short-circuit whatever already came up.
    console.error("[startSyncSubsystems] sync subsystem initialization failed:", error);
    // A failed boot must not leave a PerformanceObserver attached forever.
    removeSyncLongTaskObserver();
    if (compactionTimer) {
      clearInterval(compactionTimer);
      compactionTimer = null;
    }
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
      const error = new Error("timeout");
      error.name = "StartupTimeoutError";
      reject(error);
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
  stopOutboxDrainLoop();
}
