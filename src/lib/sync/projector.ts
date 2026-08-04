/**

 Transport-neutral projection (task 5.1), extracted from replicatedMap.ts so
 the same merge/conflict logic drives both transports (Yjs today, the
 delta-log client eventually). This module knows nothing about Yjs — it
 takes an already-decrypted/deserialized remote row (or `undefined` for "no
 value") and decides whether/how to apply it to local SQLite. Every
 `upsert_synced_*` call and merge mode from before this extraction is
 unchanged: this is a straight lift of handleRemote/runApply/
 enqueueBatch+flushBatch/mergeFieldLww, not a rewrite.

 What stays on the Yjs side (src/lib/sync/replicatedMap.ts): `map.observe`,
 `map.set`/tombstone writes, `gcTombstonesMap`, `pruneAgedAppendEntries`, and
 doc rebinding on room switch — all inherently CRDT-shaped concerns with no
 delta-log equivalent (the delta-log server has no in-memory document to
 observe or rebind).

*/

import { isNewer, compareClock } from "./syncClock";
import { measureSyncPhase, recordSyncWorkSize } from "./syncTelemetry";
import { getSyncFeatureFlags } from "./featureFlags";
import { recordIncomingSyncOperation, markIncomingApplied } from "./syncJournal";
import { isTombstone, type Tombstoned } from "./tombstone";
import { syncClockCache } from "./clockCache";

export type MergeMode = "row-lww" | "append-only" | "field-lww";

export interface ApplyContext {
  /** True when the receiver should treat this as a tombstone delete. */
}

export interface ProjectorConfig<T extends { updatedAt: string }> {
  /** Sync domain name, e.g. "learningItems". Used as the journal domain and the syncClockCache key. */
  name: string;
  /** Stable label for logs. */
  label: string;
  mode?: MergeMode;
  clockField?: keyof T;
  fieldClocks?: Array<[keyof T, keyof T]>;
  apply: (key: string, row: T, ctx: ApplyContext) => Promise<void>;
  applyBatch?: (rows: Array<[string, T]>) => Promise<void>;
  applyDelete?: (key: string, ctx: ApplyContext) => Promise<void>;
  getLocal?: (key: string) => Promise<T | null>;
  verbose?: boolean;
}

export interface Projector<T extends { updatedAt: string }> {
  /**
   * Handle one remote value for `key` — the same value a Yjs `map.observe`
   * callback or a decrypted delta-log op would supply. `undefined` means
   * "absent" (delete already applied, or never existed) and is a no-op,
   * matching the original `if (!remote) return`.
   */
  handleRemote: (key: string, remote: Tombstoned<T> | undefined) => Promise<void>;
  /** Exposed so a transport-specific prune/GC pass (e.g. pruneAgedAppendEntries) can check what's already been safely projected. */
  appliedClocks: Map<string, string>;
  appliedTombstoneClocks: Map<string, string>;
  /** Flush any rows still queued for a batched apply. Call on teardown so nothing is lost mid-debounce. */
  flushBatch: () => Promise<void>;
  /** Clear all applied-state (echo-guard clocks, tombstone dedup, pending batch). Call on room switch — this projector's history belongs to the room it was tracking, not the new one. */
  reset: () => void;
}

export function createProjector<T extends { updatedAt: string }>(
  config: ProjectorConfig<T>,
): Projector<T> {
  const mode = config.mode ?? "row-lww";
  const clockField = (config.clockField ?? "updatedAt") as keyof T;
  const log = config.verbose
    ? (...a: unknown[]) => console.debug(`[projector:${config.label}]`, ...a)
    : () => {};

  const appliedTombstones = new Set<string>();
  const appliedTombstoneClocks = new Map<string, string>();
  const appliedClocks = new Map<string, string>();

  const batchQueue: Array<{ key: string; row: T; clock: string; journalId: string | null }> = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  async function enqueueBatch(key: string, row: T, clock: string, journalId: string | null): Promise<void> {
    const prev = appliedClocks.get(key);
    if (prev && compareClock(clock, prev) <= 0) {
      return;
    }
    batchQueue.push({ key, row, clock, journalId });
    if (!batchTimer) {
      batchTimer = setTimeout(() => void flushBatch(), 50);
    }
  }

  async function flushBatch(): Promise<void> {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    const items = [...batchQueue];
    batchQueue.length = 0;
    if (items.length === 0) return;

    if (config.applyBatch) {
      try {
        const rows = items.map((item) => [item.key, item.row] as [string, T]);
        await measureSyncPhase("projection-batch", () => config.applyBatch!(rows));
        for (const item of items) {
          appliedClocks.set(item.key, item.clock);
          if (config.name === "learningItems" || config.name === "documents") {
            syncClockCache.updateClock(config.name, item.key, item.clock);
          }
          if (item.journalId) {
            await markIncomingApplied({ operationId: item.journalId, domain: config.name, entityKey: item.key });
          }
          log("applied (batch)", item.key);
        }
      } catch (err) {
        console.warn(`[projector:${config.label}] applyBatch failed, falling back to individual writes`, err);
        for (const item of items) {
          await runApply(item.key, item.row, item.clock, item.journalId);
        }
      }
    } else {
      for (const item of items) {
        await runApply(item.key, item.row, item.clock, item.journalId);
      }
    }
  }

  async function runApply(key: string, row: T, clock: string, journalId: string | null = null): Promise<void> {
    // Idempotency for rapid re-broadcasts: skip if we already applied this clock.
    const prev = appliedClocks.get(key);
    if (prev && compareClock(clock, prev) <= 0) {
      return;
    }
    try {
      try {
        recordSyncWorkSize(JSON.stringify(row).length, 1);
      } catch {
        // Diagnostic sizing must never make a valid sync row fail.
      }
      await measureSyncPhase("projection", () => config.apply(key, row, {}));
      appliedClocks.set(key, clock);
      if (config.name === "learningItems" || config.name === "documents") {
        syncClockCache.updateClock(config.name, key, clock);
      }
      if (journalId) {
        await markIncomingApplied({ operationId: journalId, domain: config.name, entityKey: key });
      }
      log("applied", key);
    } catch (err) {
      console.warn(`[projector:${config.label}] apply failed`, key, err);
      // The transport must know the row was not projected. In particular the
      // delta-log cursor may only advance after a success or after the failed
      // row has been durably deferred; swallowing here previously lost child
      // rows (notably extracts whose parent document had not arrived yet).
      throw err;
    }
  }

  async function safeGetLocal(key: string): Promise<T | null> {
    try {
      return (await config.getLocal!(key)) ?? null;
    } catch (err) {
      log("getLocal failed", key, err);
      return null;
    }
  }

  async function handleRemote(key: string, remote: Tombstoned<T> | undefined): Promise<void> {
    if (!remote) return; // absent — nothing to do (delete already applied or never existed)
    const journalId = getSyncFeatureFlags().journaledProjection
      ? `${config.name}:${key}:${String(isTombstone(remote) ? remote.deletedAt : remote[clockField] ?? "remote")}`
      : null;
    if (journalId) {
      await recordIncomingSyncOperation({
        operationId: journalId,
        domain: config.name,
        entityKey: key,
        operation: isTombstone(remote) ? "delete" : mode === "append-only" ? "append" : "upsert",
        payload: remote,
      });
    }

    if (isTombstone(remote)) {
      // Idempotent: only apply the delete once per tombstone (keyed by deletedAt).
      const marker = `${key}:${remote.deletedAt}`;
      if (appliedTombstones.has(marker)) return;
      if (!config.applyDelete) return; // entity doesn't replicate deletes
      appliedTombstones.add(marker);
      appliedTombstoneClocks.set(key, remote.deletedAt);
      try {
        await measureSyncPhase("projection", () => config.applyDelete!(key, {}));
        if (journalId) {
          await markIncomingApplied({ operationId: journalId, domain: config.name, entityKey: key });
        }
        log("applied delete", key);
      } catch (err) {
        appliedTombstones.delete(marker); // allow retry
        console.warn(`[projector:${config.label}] applyDelete failed`, key, err);
        throw err;
      }
      return;
    }

    const remoteClock = String(remote[clockField] ?? "");
    const tombstoneClock = appliedTombstoneClocks.get(key);
    if (tombstoneClock && compareClock(remoteClock, tombstoneClock) <= 0) {
      return; // stale offline update must not resurrect a deleted entity
    }

    if (mode === "append-only") {
      // Reviews: always upsert by deterministic id; INSERT OR IGNORE dedupes.
      if (config.applyBatch) {
        await enqueueBatch(key, remote, remoteClock, journalId);
      } else {
        await runApply(key, remote, remoteClock, journalId);
      }
      return;
    }

    if (mode === "field-lww") {
      // Fetch local once, then decide per-field.
      const local = config.getLocal ? await safeGetLocal(key) : null;
      const merged = local ? mergeFieldLww(local, remote, config.fieldClocks ?? []) : remote;
      if (config.applyBatch) {
        await enqueueBatch(key, merged, remoteClock, journalId);
      } else {
        await runApply(key, merged, remoteClock, journalId);
      }
      return;
    }

    // row-lww
    const local = config.getLocal ? await safeGetLocal(key) : null;
    if (local) {
      const localClock = String(local[clockField] ?? "");
      if (!isNewer(remoteClock, localClock)) {
        return; // local is at least as new — don't clobber (echo guard lives here too)
      }
    }
    if (config.applyBatch) {
      await enqueueBatch(key, remote, remoteClock, journalId);
    } else {
      await runApply(key, remote, remoteClock, journalId);
    }
  }

  function reset(): void {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    batchQueue.length = 0;
    appliedTombstones.clear();
    appliedTombstoneClocks.clear();
    appliedClocks.clear();
  }

  return { handleRemote, appliedClocks, appliedTombstoneClocks, flushBatch, reset };
}

/**
 * Merge remote fields into a local row under field-level LWW. For each
 * `[valueField, clockField]` pair, the remote value wins only if its clock is
 * newer than the local clock. Fields not listed are taken from the row whose
 * `updatedAt` is newer (so non-churn metadata still converges via row-LWW).
 */
export function mergeFieldLww<T extends { updatedAt: string }>(
  local: T,
  remote: T,
  fieldClocks: Array<[keyof T, keyof T]>,
): T {
  const rowNewer = isNewer(remote.updatedAt, local.updatedAt);
  const base = (rowNewer ? { ...remote } : { ...local }) as T;

  for (const [valueField, clockField] of fieldClocks) {
    const remoteFieldClock = String(remote[clockField] ?? "");
    const localFieldClock = String(local[clockField] ?? "");
    // Take the remote value if its per-field clock is newer, OR if local has
    // no clock for this field yet (newly added by a migration).
    if (isNewer(remoteFieldClock, localFieldClock) || (!localFieldClock && remoteFieldClock)) {
      (base as Record<string, unknown>)[valueField as string] =
        remote[valueField as unknown as keyof T];
      (base as Record<string, unknown>)[clockField as string] = remoteFieldClock;
    } else {
      (base as Record<string, unknown>)[valueField as string] =
        local[valueField as unknown as keyof T];
      (base as Record<string, unknown>)[clockField as string] = localFieldClock;
    }
  }
  return base;
}
