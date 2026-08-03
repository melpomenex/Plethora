/**
 * Rollout switches for the progressive sync architecture.
 *
 * The scheduler is intentionally enabled by default: it is a safety boundary
 * around existing sync work and does not change the wire format. Features that
 * change persistence or room compatibility stay opt-in until their migration
 * and rollback paths are proven.
 */
export interface SyncFeatureFlags {
  progressiveScheduling: boolean;
  journaledProjection: boolean;
  shardedRooms: boolean;
  dualWriteMigration: boolean;
  compaction: boolean;
  /**
   * y-indexeddb update-log compaction on boot + a long-interval recurring
   * sweep. This snapshots the live doc and trims the raw update log so cold
   * boots replay one row instead of the entire accumulated CRDT history. It is
   * a safe, in-place snapshot (no wire-format change), so it ships enabled.
   */
  yjsCompaction: boolean;
  /**
   * migrate-sync-to-delta-log: read/write through the delta-log transport
   * (src/lib/sync/deltaLog/) instead of Yjs. Off by default until the
   * cutover machinery (Phase 6) exists to drive rooms through it safely.
   */
  deltaLogSync: boolean;
  /**
   * migrate-sync-to-delta-log P3: publish every mutation to BOTH the Yjs
   * relay and the delta log (design.md §6). Only meaningful alongside
   * deltaLogSync; lets not-yet-upgraded devices keep receiving writes during
   * a staged rollout.
   */
  deltaLogDualWrite: boolean;
}

const STORAGE_KEY = "incrementum.sync.feature-flags";

const DEFAULT_FLAGS: SyncFeatureFlags = {
  progressiveScheduling: true,
  journaledProjection: false,
  shardedRooms: false,
  dualWriteMigration: false,
  compaction: false,
  yjsCompaction: true,
  deltaLogSync: false,
  deltaLogDualWrite: false,
};

function envFlag(name: string): boolean | undefined {
  try {
    const value = (import.meta.env as Record<string, string | undefined>)[name];
    if (value === undefined) return undefined;
    return value === "1" || value.toLowerCase() === "true";
  } catch {
    return undefined;
  }
}

export function getSyncFeatureFlags(): SyncFeatureFlags {
  const flags = { ...DEFAULT_FLAGS };
  try {
    const stored = typeof localStorage !== "undefined"
      ? JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
      : null;
    if (stored && typeof stored === "object") {
      for (const key of Object.keys(flags) as Array<keyof SyncFeatureFlags>) {
        if (typeof stored[key] === "boolean") flags[key] = stored[key];
      }
    }
  } catch {
    // A malformed debug override must never prevent the app from starting.
  }

  const envNames: Record<keyof SyncFeatureFlags, string> = {
    progressiveScheduling: "VITE_SYNC_PROGRESSIVE_SCHEDULING",
    journaledProjection: "VITE_SYNC_JOURNALED_PROJECTION",
    shardedRooms: "VITE_SYNC_SHARDED_ROOMS",
    dualWriteMigration: "VITE_SYNC_DUAL_WRITE_MIGRATION",
    compaction: "VITE_SYNC_COMPACTION",
    yjsCompaction: "VITE_SYNC_YJS_COMPACTION",
    deltaLogSync: "VITE_SYNC_DELTA_LOG",
    deltaLogDualWrite: "VITE_SYNC_DELTA_LOG_DUAL_WRITE",
  };
  for (const key of Object.keys(flags) as Array<keyof SyncFeatureFlags>) {
    const override = envFlag(envNames[key]);
    if (override !== undefined) flags[key] = override;
  }
  return flags;
}

export function __resetSyncFeatureFlagsForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable storage in tests and WebViews.
  }
}

export const syncFeatureDefaults = DEFAULT_FLAGS;
