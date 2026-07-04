/**
 * Idempotent boot chain for the cross-device sync subsystems.
 *
 * This wires the shared Yjs doc to every entity that replicates across devices:
 *   getYjsSync → file sync → auto-download → document replication →
 *   flashcard replication → RSS → podcasts → first-join backfill.
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
 *   - `main.tsx` (desktop): eager at boot.
 *   - `main.tsx` (mobile): deferred past first paint to keep the cold-start
 *     memory spike off the critical path.
 *   - `SyncSettings.tsx`: when the user toggles real-time sync ON or joins a
 *     room, so the subsystems come up immediately on a first-time enable.
 */

let startPromise: Promise<void> | null = null;

/**
 * Run the sync subsystem boot chain exactly once per session. Subsequent calls
 * return the same promise. Never throws — every step is internally best-effort
 * and a failure in one entity must not prevent the others from initializing.
 */
export function startSyncSubsystems(): Promise<void> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    // 1. Shared Yjs doc + websocket provider + IndexedDB persistence.
    const { getYjsSync } = await import("./yjsSync");
    await getYjsSync();

    // 2. File-sync subsystem (FileManifest + FileTransferManager). Idempotent
    //    via ensureFileSyncReady's guard. Without this, imported files can't be
    //    discovered or pulled across devices.
    const { ensureFileSyncReady } = await import("./useFileSync");
    await ensureFileSyncReady();

    // 3. Auto-download watcher (honors sync.autoDownloadMode).
    const { startAutoFileSyncDownload } = await import("./autoFileSyncDownload");
    await startAutoFileSyncDownload();

    // 4. Document-row replication. SQLite is per-device; without this, imported
    //    docs never appear on other devices even with file sync.
    const { ensureDocumentReplicationReady } = await import("./documentReplication");
    await ensureDocumentReplicationReady();

    // 5. Flashcard + review-history replication (the paramount cross-device
    //    case). Subscribes to the shared 'learningItems' and 'reviews' maps so a
    //    card reviewed on one device appears with its new schedule on every
    //    device. No-op outside Tauri.
    const { ensureFlashcardSyncReady } = await import("./sync/entities/flashcards");
    await ensureFlashcardSyncReady();

    // 6. RSS replication (feeds + article read/queued state).
    const { ensureRssSyncReady } = await import("./sync/entities/rss");
    await ensureRssSyncReady();

    // 7. Podcast replication (feeds + episode position/played/download-intent).
    //    Audio bytes are never replicated — each device downloads from the feed
    //    URL; we sync only state + intent.
    const { ensurePodcastSyncReady } = await import("./sync/entities/podcasts");
    await ensurePodcastSyncReady();

    // 8. First-join backfill: publish the local library into the shared doc so
    //    other devices receive it. Background, non-fatal.
    const { runSyncMigrationIfNeeded } = await import("./sync/migrate");
    await runSyncMigrationIfNeeded().catch((e) =>
      console.warn("[startSyncSubsystems] sync migration failed (non-fatal)", e),
    );
  })().catch((error) => {
    // Reset so a later caller can retry. The individual ensure*Ready() helpers
    // are themselves idempotent and will short-circuit whatever already came up.
    console.error("[startSyncSubsystems] sync subsystem initialization failed:", error);
    startPromise = null;
    throw error;
  });

  return startPromise;
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
