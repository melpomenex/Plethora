/**
 * One-time cleanup of residue left behind by the removed real-time sync
 * subsystem (Yjs rooms, delta-log transport, sync clock). Long-lived installs
 * can carry multi-megabyte y-indexeddb databases and stale localStorage keys;
 * deleting them once reclaims that space. Guarded by a localStorage flag so it
 * runs exactly once per install and never touches anything else.
 */

const CLEANUP_FLAG_KEY = "incrementum.sync-residue-cleaned";
const LOCAL_STORAGE_KEYS = [
  "incrementum_sync_room",
  "incrementum-yjs-corruption-detected",
  "incrementum.sync.feature-flags",
  "incrementum_sync_device_id",
  "incrementum_sync_hlc_counter",
  "incrementum_last_sync_version",
];
const INDEXEDDB_PREFIX = "incrementum-yjs:";
const SETTINGS_KEY = "incrementum-settings";

function stripSyncFromSettingsBlob(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      state?: Record<string, unknown>;
      settings?: Record<string, unknown>;
      sync?: unknown;
    };
    let changed = false;
    for (const holder of [parsed, parsed.state, parsed.settings]) {
      if (holder && "sync" in holder) {
        delete holder.sync;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    // Malformed blob or storage unavailable — nothing to clean.
  }
}

function deleteSyncIndexedDatabases(): void {
  try {
    const enumerate = (indexedDB as unknown as {
      databases?: () => Promise<Array<{ name?: string }>>;
    }).databases;
    if (typeof enumerate !== "function") return; // Safari lacks it; residue stays, harmless.
    void enumerate()
      .then((dbs) => {
        for (const db of dbs) {
          if (db.name?.startsWith(INDEXEDDB_PREFIX)) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      })
      .catch(() => {
        // Enumeration failed — leave the databases; they are inert without sync.
      });
  } catch {
    // IndexedDB unavailable (SSR/test) — nothing to do.
  }
}

/** Runs at most once per install. Safe to call on every boot. */
export function runSyncResidueCleanup(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (localStorage.getItem(CLEANUP_FLAG_KEY) === "1") return;
  } catch {
    return;
  }

  for (const key of LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage full or blocked — the flag below still guards re-runs.
    }
  }
  stripSyncFromSettingsBlob();
  deleteSyncIndexedDatabases();

  try {
    localStorage.setItem(CLEANUP_FLAG_KEY, "1");
  } catch {
    // If the flag can't be written the cleanup may re-run; every step above is
    // idempotent, so a repeat pass is harmless.
  }
}
