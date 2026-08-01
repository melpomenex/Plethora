/**
 * y-indexeddb update-log compaction.
 *
 * y-indexeddb stores every CRDT update as a separate row in a single `updates`
 * object store and replays all of them into the Y.Doc at boot
 * (`fetchUpdates` → `idb.getAll` + `forEach(applyUpdate)`). The library's own
 * auto-trim only fires for updates whose origin is *not* the persistence
 * instance, so updates that arrive via the network replay (applied under
 * origin `this`) never trigger compaction. On a long-lived single-room install
 * the update log therefore grows without bound, and the boot replay
 * materializes the entire history into the WebView heap at once — the dominant
 * cause of the multi-GB cold-start memory spike.
 *
 * This module wraps y-indexeddb's own `storeState` primitive, which snapshots
 * the live doc via `Y.encodeStateAsUpdate`, appends that single merged update,
 * and deletes everything below the auto-increment cursor. After a compaction
 * the next cold boot replays one row instead of millions.
 *
 * Note: `storeState` calls `fetchUpdates` internally, so the very first
 * compaction after a long-lived install still pays the replay cost once. That
 * is unavoidable — the existing log must be read to be merged — but it only
 * happens once, and every subsequent boot replays the compacted snapshot.
 */
import { storeState, PREFERRED_TRIM_SIZE } from "y-indexeddb";
import type { IndexeddbPersistence } from "y-indexeddb";
import { markSyncPhaseStart } from "./syncTelemetry";

/**
 * Minimum number of accumulated update rows before a compaction is worth
 * running. y-indexeddb's own trim threshold is `PREFERRED_TRIM_SIZE` (500); we
 * use the same value so we don't fight the library's auto-trim and don't waste
 * work compacting a small, cheap-to-replay log.
 */
export const COMPACTION_MIN_UPDATES = PREFERRED_TRIM_SIZE;

export interface CompactionResult {
  /** Whether a compaction actually ran. */
  compacted: boolean;
  /** Update-row count before compaction (best-effort, from `_dbsize`). */
  beforeSize: number;
  /** Update-row count after compaction (best-effort, from `_dbsize`). */
  afterSize: number;
}

/**
 * Read the persistence instance's best-effort row count. `_dbsize` is updated
 * by y-indexeddb after `fetchUpdates`/`storeState`; it is an in-memory cache of
 * the `updates` store row count, not a live query.
 */
function dbsizeOf(p: IndexeddbPersistence): number {
  return (p as unknown as { _dbsize?: number })._dbsize ?? 0;
}

/**
 * Compact the update log for a persistence instance if it has grown past the
 * threshold. Safe to call repeatedly — it no-ops when the log is small or when
 * the persistence instance has been destroyed. Never throws; a compaction
 * failure is logged and reported via telemetry but does not break sync.
 */
export async function compactYjsPersistence(
  persistence: IndexeddbPersistence | null | undefined,
): Promise<CompactionResult> {
  const noop: CompactionResult = { compacted: false, beforeSize: 0, afterSize: 0 };
  if (!persistence) return noop;
  if ((persistence as unknown as { _destroyed?: boolean })._destroyed) return noop;

  const beforeSize = dbsizeOf(persistence);
  if (beforeSize < COMPACTION_MIN_UPDATES) {
    return { compacted: false, beforeSize, afterSize: beforeSize };
  }

  const endPhase = markSyncPhaseStart("indexeddb-compact");
  try {
    // `forceStore = true` writes a fresh snapshot regardless of the current
    // `_dbsize`, then deletes everything below the cursor. This collapses the
    // entire history into a single merged update row.
    await storeState(persistence, true);
    const afterSize = dbsizeOf(persistence);
    endPhase({
      outcome: "ok",
      bytes: beforeSize,
      records: afterSize,
    });
    if (afterSize < beforeSize) {
      console.info(
        `[yjsCompaction] compacted update log: ${beforeSize} → ${afterSize} rows`,
      );
    }
    return { compacted: true, beforeSize, afterSize };
  } catch (err) {
    // A compaction failure is non-fatal: the log is still valid, just larger
    // than we'd like. The next attempt (boot or recurring) will retry.
    console.warn("[yjsCompaction] compaction failed (non-fatal):", err);
    endPhase({ outcome: "error", bytes: beforeSize });
    return { compacted: false, beforeSize, afterSize: beforeSize };
  }
}

/** Threshold check exposed so callers can decide whether to schedule work. */
export function needsCompaction(persistence: IndexeddbPersistence | null | undefined): boolean {
  if (!persistence) return false;
  if ((persistence as unknown as { _destroyed?: boolean })._destroyed) return false;
  return dbsizeOf(persistence) >= COMPACTION_MIN_UPDATES;
}
