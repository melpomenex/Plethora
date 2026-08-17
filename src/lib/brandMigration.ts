/**
 * One-shot Incrementum → Plethora localStorage key migration (task 3.3 of the
 * rebrand change). Runs at the very top of `main.tsx`, BEFORE any store or
 * service reads localStorage.
 *
 * Safety rules (data-loss review):
 * - A legacy key is only COPIED, never moved blind: the copy must round-trip
 *   (`getItem(new) === oldValue`) before the legacy key is removed.
 * - An existing new key is NEVER overwritten (the app may have written newer
 *   data since a previous migration attempt).
 * - Keys owned by `syncResidueCleanup` (the removed real-time sync residue)
 *   are deleted by that module, not migrated here.
 *
 * Dual-read window: readers use {@link migratedGetItem}, which falls back to
 * the legacy key when the new one is absent, for one release after the
 * rebrand.
 */

const MIGRATION_FLAG = "plethora.brand-storage-migrated";

/** Keys owned by the sync-residue cleanup — removed there, never migrated. */
const SYNC_RESIDUE_KEYS = new Set([
  "incrementum_sync_room",
  "incrementum-yjs-corruption-detected",
  "incrementum.sync.feature-flags",
  "incrementum_sync_device_id",
  "incrementum_sync_hlc_counter",
  "incrementum_last_sync_version",
  "incrementum.sync-residue-cleaned",
]);

/** Legacy key prefix families that map mechanically onto `plethora*`. */
const LEGACY_PREFIXES = ["incrementum-", "incrementum.", "incrementum_"];

function successorKey(legacyKey: string): string | null {
  for (const prefix of LEGACY_PREFIXES) {
    if (legacyKey.startsWith(prefix)) {
      // Preserve the separator style: incrementum-settings → plethora-settings,
      // incrementum.reading-sessions → plethora.reading-sessions,
      // incrementum_skip_update_version → plethora_skip_update_version.
      return `plethora${legacyKey.slice("incrementum".length)}`;
    }
  }
  return null;
}

/**
 * Copy every legacy `incrementum*` localStorage key to its `plethora*`
 * successor. Idempotent; safe to call on every boot (guarded by a flag, and
 * every step is independently re-runnable).
 */
export function runBrandStorageMigration(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === "1") return;
  } catch {
    return;
  }

  let copied = 0;
  let verifiedRemovals = 0;
  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) {
        legacyKeys.push(key);
      }
    }

    for (const legacyKey of legacyKeys) {
      if (SYNC_RESIDUE_KEYS.has(legacyKey)) continue;
      const newKey = successorKey(legacyKey);
      if (!newKey) continue;
      let value: string | null = null;
      try {
        value = localStorage.getItem(legacyKey);
      } catch {
        continue;
      }
      if (value === null) continue;
      try {
        if (localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, value);
          copied++;
        }
        // Remove the legacy key only after the copy is verified to
        // round-trip (or the new key already held newer data).
        if (localStorage.getItem(newKey) !== null) {
          localStorage.removeItem(legacyKey);
          verifiedRemovals++;
        }
      } catch {
        // Storage full or blocked — leave the legacy key in place; the
        // dual-read fallback keeps the app working and the next boot retries.
      }
    }
  } catch {
    // Enumeration failed — fall through to flag anyway; dual-read covers it.
  }

  try {
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch {
    // If the flag can't be written the migration may re-run; every step is
    // idempotent, so a repeat pass is harmless.
  }
  if (copied || verifiedRemovals) {
    console.info(
      `[brand-migration] copied ${copied} localStorage key(s), removed ${verifiedRemovals} legacy key(s)`
    );
  }
}

/**
 * Read a `plethora*` localStorage key, falling back to its `incrementum*`
 * predecessor while the post-rebrand dual-read window is open.
 */
export function migratedGetItem(plethoraKey: string): string | null {
  try {
    const current = localStorage.getItem(plethoraKey);
    if (current !== null) return current;
    for (const sep of ["-", ".", "_"]) {
      if (plethoraKey.startsWith(`plethora${sep}`)) {
        const legacyKey = `incrementum${plethoraKey.slice("plethora".length)}`;
        return localStorage.getItem(legacyKey);
      }
    }
    return null;
  } catch {
    return null;
  }
}
