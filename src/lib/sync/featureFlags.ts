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
}

const STORAGE_KEY = "incrementum.sync.feature-flags";

const DEFAULT_FLAGS: SyncFeatureFlags = {
  progressiveScheduling: true,
  journaledProjection: false,
  shardedRooms: false,
  dualWriteMigration: false,
  compaction: false,
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
