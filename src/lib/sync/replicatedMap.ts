/**
 * Generic Yjs replication factory for "one row per key" entity types.
 *
 * This factors out the exact pattern proven by `documentReplication.ts` so each
 * new entity (flashcards, reviews, RSS, podcasts) needs only a small declarative
 * config instead of a copy of the whole module. The pattern is:
 *
 *   1. `doc.getMap<T>(name)` — one shared map per entity.
 *   2. `ensureReady()` — lazily attach an `observe` handler, replaying the
 *      existing map contents on first init; rebuild on room switch
 *      (`map.doc !== sync.doc`).
 *   3. `publish(row)` — write a local row to the map so peers receive it.
 *      The caller must stamp the row's sync-clock field (e.g. `updatedAt`)
 *      with `nowHLC()` *before* publishing; the receiver re-applies that same
 *      timestamp, so a re-broadcast of our own write no-ops (echo guard).
 *   4. `observe → handleRemote(key)` — for each changed key, read the remote
 *      value; skip tombstones already applied; skip rows not newer than local;
 *      otherwise call `config.apply` (which invokes a `upsert_synced_*` Tauri
 *      command). Tombstones call `config.applyDelete`.
 *
 * Conflict resolution is whole-row last-writer-wins on the configured clock
 * field, plus tombstones for deletes. Entities needing append-only or
 * field-level merge (review_results, rss_articles read/queued state) use the
 * `mode` option.
 *
 * CRITICAL doc-size discipline: the shared Yjs doc grows monotonically (every
 * mutation is a permanent tombstone). Never publish large/regenerable fields
 * (article HTML, audio bytes, cover data-URLs). `config.strip` removes those
 * before publishing, mirroring how `documentReplication` drops
 * `content`/`coverImageUrl`/`currentViewState`.
 */

import type * as Y from "yjs";
import { getYjsSync, registerRoomChangeListener, getSyncRoomId } from "../yjsSync";
import { recordYjsActivity } from "./cutover";
import { isTauri } from "../tauri";
import { getProgressiveSyncScheduler, type SyncLane } from "./progressiveScheduler";
import { getSyncFeatureFlags } from "./featureFlags";
import { enqueueSyncOperation, registerSyncOutboxPublisher } from "./syncJournal";
import { recordSyncWorkSize } from "./syncTelemetry";
import {
  isTombstone,
  writeTombstone as writeTombstoneHelper,
  type Tombstoned,
} from "./tombstone";
import { syncClockCache } from "./clockCache";
import {
  createProjector,
  mergeFieldLww,
  type MergeMode,
  type Projector,
  type ApplyContext,
} from "./projector";
import { registerDomainHandler } from "./deltaLog/domainRegistry";
import { isYjsPublishSuppressed } from "./deltaLog/yjsPublishGate";

export type { MergeMode, ApplyContext };
// Re-exported for existing importers — canonical home is now projector.ts
// (task 5.1: it is transport-neutral and used by both Yjs and delta-log).
export { mergeFieldLww };

export interface ReplicatedMapConfig<T extends { updatedAt: string }> {
  /** Yjs map name, e.g. "learningItems". */
  name: string;
  /** Stable label for logs. */
  label: string;
  /**
   * Merge strategy:
   *   - `row-lww`     — whole row wins if newer (default; cards, feeds).
   *   - `append-only` — always upsert by key, never skip by timestamp
   *                     (review_results keyed by deterministic id).
   *   - `field-lww`   — merge individual timestamped fields; `fieldClocks`
   *                     supplies the per-field clock fields (rss article
   *                     read/queued state, podcast position/played).
   */
  mode?: MergeMode;
  /** Clock field used for row-lww comparison. Defaults to "updatedAt". */
  clockField?: keyof T;
  /**
   * For `field-lww`: the fields whose values each carry their own clock (the
   * `*_at` companion columns). Receiver applies a remote field only if its
   * clock is newer than local. Each entry is `[valueField, clockField]`.
   */
  fieldClocks?: Array<[keyof T, keyof T]>;
  /**
   * Strip large/regenerable fields before publishing. Mirrors the
   * content/coverImageUrl/currentViewState strip in documentReplication.
   * Returns a shallow-cloned row with those fields removed.
   */
  strip?: (row: T) => Partial<T>;
  /**
   * Apply a remote row to local SQLite. Called only after the conflict check
   * passes. Receives the (possibly stripped) row plus the id under which it
   * was published. Implementations invoke a `upsert_synced_*` Tauri command.
   */
  apply: (key: string, row: T, ctx: ApplyContext) => Promise<void>;
  /** Apply a batch of remote rows to local SQLite. Implementations invoke a bulk Tauri command. */
  applyBatch?: (rows: Array<[string, T]>) => Promise<void>;
  /** Apply a delete (tombstone) to local SQLite. Optional. */
  applyDelete?: (key: string, ctx: ApplyContext) => Promise<void>;
  /**
   * Read the local row for a key (used to decide if remote is newer). Return
   * null if absent. Implementations query SQLite or a store. For
   * `append-only` mode this can be omitted (apply is always called).
   */
  getLocal?: (key: string) => Promise<T | null>;
  /** Trailing debounce for high-churn publishes (position ticks), in ms. 0 = none. */
  debounceMs?: number;
  /** Whether to log verbose activity for debugging. */
  verbose?: boolean;
  /** Priority for replaying existing rows. Remote changes are always P0. */
  replayLane?: SyncLane;
  /**
   * For `append-only` maps only: prune entries whose `clockField` is older than
   * this many days from the SHARED sync map during the init sweep. The local
   * SQLite projection is untouched — once a row has been projected (its `apply`
   * ran), it is permanent in each device's local database. This only bounds the
   * size of the in-memory CRDT document / delivery buffer, which otherwise
   * grows monotonically forever (append-only maps have no tombstone path, so
   * the tombstone GC never touches them).
   *
   * The `clockField` value is parsed as an HLC (`"<epoch-ms>.<counter>"`); rows
   * whose clock prefix predates the cutoff are deleted from the shared map.
   */
  maxAgeDays?: number;
}

interface InternalState<T> {
  map: Y.Map<Tombstoned<T>> | null;
  initialized: boolean;
  initPromise: Promise<void> | null;
  pendingPublish: Map<string, ReturnType<typeof setTimeout>>;
  unregisterRoomChange: (() => void) | null;
  unregisterOutboxPublisher: (() => void) | null;
}

export interface ReplicatedMap<T extends { updatedAt: string }> {
  ensureReady: () => Promise<void>;
  publish: (key: string, row: T) => Promise<void>;
  publishDebounced: (key: string, row: () => Promise<T>) => Promise<void>;
  delete: (key: string) => Promise<void>;
  gc: () => number;
  teardown: () => void;
  /** Direct map access (read-only intent) for migration/backfill callers. */
  getMap: () => Y.Map<Tombstoned<T>> | null;
}

/**
 * Create a replicated map for an entity. Registers a room-change listener so
 * the map re-inits against the new doc on room switch (mirrors documents).
 */
export function createReplicatedMap<T extends { updatedAt: string }>(
  config: ReplicatedMapConfig<T>,
): ReplicatedMap<T> {
  const mode = config.mode ?? "row-lww";
  const clockField = (config.clockField ?? "updatedAt") as keyof T;
  const debounceMs = config.debounceMs ?? 0;
  const replayLane = config.replayLane ?? "P1";
  const scheduler = getProgressiveSyncScheduler();
  const log = config.verbose
    ? (...a: unknown[]) => console.debug(`[replicatedMap:${config.label}]`, ...a)
    : () => {};

  // Transport-neutral merge/conflict logic (task 5.1). This Yjs adapter's
  // only jobs are: feed it remote values from map.observe/replay, and let it
  // drive map.set/tombstone writes on the publish side (below).
  const projector: Projector<T> = createProjector({
    name: config.name,
    label: config.label,
    mode: config.mode,
    clockField: config.clockField,
    fieldClocks: config.fieldClocks,
    apply: config.apply,
    applyBatch: config.applyBatch,
    applyDelete: config.applyDelete,
    getLocal: config.getLocal,
    verbose: config.verbose,
  });

  // Task 5.4: register so the delta-log router (deltaLog/router.ts) can
  // dispatch a decrypted op for this domain to the exact same merge logic
  // the Yjs path uses — same appliedClocks/appliedTombstoneClocks instance,
  // so double-delivery across transports during dual-run is a no-op.
  const unregisterDomainHandler = registerDomainHandler(config.name, (key, remote) =>
    projector.handleRemote(key, remote as Tombstoned<T> | undefined),
  );

  const state: InternalState<T> = {
    map: null,
    initialized: false,
    initPromise: null,
    pendingPublish: new Map(),
    unregisterRoomChange: null,
    unregisterOutboxPublisher: null,
  };

  if (getSyncFeatureFlags().journaledProjection) {
    state.unregisterOutboxPublisher = registerSyncOutboxPublisher(config.name, async (row, payload) => {
      if (!state.map) return;
      if (row.operation === "delete") {
        writeTombstoneHelper(state.map, row.entity_key);
      } else if (payload && typeof payload === "object") {
        state.map.set(row.entity_key, payload as Tombstoned<T>);
      }
    });
  }

  async function ensureReady(): Promise<void> {
    const sync = await getYjsSync();
    if (state.initialized && state.map && state.map.doc === sync.doc) return;

    // Room switched (or first init) — tear down the old binding.
    if (state.map && state.map.doc !== sync.doc) {
      state.initialized = false;
      state.initPromise = null;
      state.map = null;
      projector.reset();
    }

    if (!state.initPromise) {
      state.initPromise = (async () => {
        try {
          const sync = await getYjsSync();
          const map = sync.doc.getMap<Tombstoned<T>>(config.name);
          state.map = map;
          map.observe((event) => {
            // P6 quiesce tracking (task 6.6): an observe firing means a
            // change actually arrived over Yjs, as opposed to the boot-time
            // replay below (which just catches up on existing state, not
            // "someone is still writing via Yjs"). Fire-and-forget — this
            // must never add latency to the hot remote-apply path.
            void recordYjsActivity(getSyncRoomId());
            for (const key of event.keysChanged) {
              scheduler.enqueue({
                id: `${config.label}:remote:${key}`,
                // Projection work must yield to active tab navigation. The
                // Yjs map already owns the received state, so deferring this
                // SQLite projection cannot lose the remote update.
                lane: "P1",
                run: () => handleRemote(key),
              });
            }
          });
          // handleRemote wraps the transport-neutral projector: it re-reads
          // the map at execution time (not the value captured when the
          // scheduler item was enqueued), matching the original behavior —
          // by the time this runs, the map may have moved on again.
          function handleRemote(key: string): Promise<void> {
            if (!isTauri() || !state.map) return Promise.resolve();
            return projector.handleRemote(key, state.map.get(key));
          }
          // Replay existing entries (e.g. rows published before this device joined).
          let replayBytes = 0;
          let replayRecords = 0;
          map.forEach((value, key) => {
            replayRecords += 1;
            try { replayBytes += JSON.stringify(value)?.length ?? 0; } catch { /* diagnostic only */ }
            if (config.name === "learningItems" || config.name === "documents") {
              const remoteClock = String((value as any)?.[clockField] ?? "");
              if (remoteClock && !syncClockCache.isStale(config.name, key, remoteClock)) {
                return; // Local SQLite is already up-to-date!
              }
            }
            scheduler.enqueue({
              id: `${config.label}:replay:${key}`,
              lane: replayLane,
              run: () => handleRemote(key),
            });
          });
          if (replayRecords > 0) recordSyncWorkSize(replayBytes, replayRecords);
          // Opportunistic tombstone GC on init.
          try {
            const removed = gcTombstonesMap(map);
            if (removed > 0) log("gc'd", removed, "tombstones");
          } catch (err) {
            log("tombstone gc failed", err);
          }
          // Append-only maps with a maxAgeDays bound: schedule a deferred
          // prune of entries older than the cutoff. This must NOT run inline:
          // the replay loop above only *enqueues* projection (the scheduler
          // drains it asynchronously), and handleRemote re-reads the map entry
          // at execution time — pruning inline would make those entries vanish
          // before they reach SQLite. So we defer to a later task that itself
          // only prunes entries already projected (in appliedClocks), leaving
          // the rest for a subsequent sweep. Local SQLite is the permanent
          // record; this only bounds the shared CRDT delivery buffer, which
          // otherwise grows forever (append-only maps have no tombstone path).
          if (mode === "append-only" && config.maxAgeDays && config.maxAgeDays > 0) {
            const maxAgeDays = config.maxAgeDays;
            const runPrune = (): void => {
              try {
                const result = pruneAgedAppendEntries(
                  map,
                  clockField,
                  maxAgeDays,
                  projector.appliedClocks,
                );
                if (result.removed > 0) {
                  log("pruned", result.removed, `aged append-only entries (>${maxAgeDays}d)`);
                }
                // If some aged entries are still pending projection (not yet in
                // appliedClocks, e.g. batched writes still in their 50ms flush
                // window), re-schedule after a short delay so they get pruned
                // this session rather than waiting for the next cold boot.
                if (result.pending > 0) {
                  setTimeout(() => scheduler.enqueue({
                    id: `${config.label}:prune-aged-retry`,
                    lane: "P3",
                    run: runPrune,
                  }), 250);
                }
              } catch (err) {
                log("append-only prune failed", err);
              }
            };
            scheduler.enqueue({
              id: `${config.label}:prune-aged`,
              lane: "P3",
              run: runPrune,
            });
          }
          state.initialized = true;
        } catch (err) {
          state.initPromise = null;
          console.error(`[replicatedMap:${config.label}] init failed`, err);
          throw err;
        }
      })();
    }

    // Register the room-change listener once so a rejoin re-inits us.
    if (!state.unregisterRoomChange) {
      state.unregisterRoomChange = registerRoomChangeListener(async () => {
        // Defer slightly so yjsSync finishes rebuilding the doc/provider.
        await new Promise((r) => setTimeout(r, 100));
        try {
          await ensureReady();
        } catch (err) {
          log("room-change reinit failed", err);
        }
      });
    }

    return state.initPromise;
  }

  async function publish(key: string, row: T): Promise<void> {
    if (!isTauri()) return; // web/PWA doesn't publish via this path (v1).
    try {
      const wire = (config.strip ? config.strip(row) : row) as Tombstoned<T>;
      // Enqueue to the durable outbox BEFORE touching the Yjs map. The outbox
      // is what reaches the delta-log transport (and survives a future where
      // Yjs is removed); doing this first means a publish still drains to the
      // server even if the Yjs map isn't bound yet (state.map null) — the
      // previous ordering silently dropped the enqueue in that case.
      if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
        void enqueueSyncOperation({
          domain: config.name,
          entityKey: key,
          operation: mode === "append-only" ? "append" : "upsert",
          payload: wire,
          clock: String(row[clockField] ?? ""),
        });
      }
      await ensureReady();
      if (state.map) {
        // P5 cutover (task 6.6): stop writing to Yjs once the delta log is
        // verified, without touching the journaled-projection/outbox publish
        // above — that already reaches the delta log independently.
        if (!isYjsPublishSuppressed()) {
          state.map.set(key, wire);
        }
      }
      const clock = String(row[clockField] ?? "");
      if (clock && (config.name === "learningItems" || config.name === "documents")) {
        syncClockCache.updateClock(config.name, key, clock);
      }
      log("published", key);
    } catch (err) {
      console.warn(`[replicatedMap:${config.label}] publish failed`, key, err);
    }
  }

  /**
   * Debounced publish for high-churn writes (e.g. podcast `timeupdate` ticks).
   * `rowProducer` is called only when the debounce flushes, so callers can
   * cheaply call this on every tick without issuing a SQLite read each time.
   */
  async function publishDebounced(key: string, rowProducer: () => Promise<T>): Promise<void> {
    if (!isTauri() || debounceMs <= 0) {
      const row = await rowProducer();
      return publish(key, row);
    }
    const existing = state.pendingPublish.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      state.pendingPublish.delete(key);
      void (async () => {
        try {
          const row = await rowProducer();
          await publish(key, row);
        } catch (err) {
          console.warn(`[replicatedMap:${config.label}] debounced publish failed`, key, err);
        }
      })();
    }, debounceMs);
    state.pendingPublish.set(key, timer);
  }

  async function del(key: string): Promise<void> {
    if (!isTauri()) return;
    try {
      // Same reasoning as publish(): the durable outbox enqueue must precede
      // the Yjs map write so a tombstone still reaches the delta-log server
      // even when the map isn't bound.
      if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
        void enqueueSyncOperation({
          domain: config.name,
          entityKey: key,
          operation: "delete",
          payload: null,
          clock: new Date().toISOString(),
        });
      }
      await ensureReady();
      if (state.map && !isYjsPublishSuppressed()) {
        writeTombstoneHelper(state.map, key);
      }
      log("tombstoned", key);
    } catch (err) {
      console.warn(`[replicatedMap:${config.label}] delete failed`, key, err);
    }
  }

  function gc(): number {
    return state.map ? gcTombstonesMap(state.map) : 0;
  }

  function teardown(): void {
    if (state.unregisterRoomChange) {
      state.unregisterRoomChange();
      state.unregisterRoomChange = null;
    }
    state.unregisterOutboxPublisher?.();
    state.unregisterOutboxPublisher = null;
    for (const t of state.pendingPublish.values()) clearTimeout(t);
    state.pendingPublish.clear();
    void projector.flushBatch();
    unregisterDomainHandler();
    state.map = null;
    state.initialized = false;
    state.initPromise = null;
  }

  return {
    ensureReady,
    publish,
    publishDebounced,
    delete: del,
    gc,
    teardown,
    getMap: () => state.map,
  };
}

function gcTombstonesMap<T extends { updatedAt: string }>(
  map: Y.Map<Tombstoned<T>>,
): number {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const key of Array.from(map.keys())) {
    const value = map.get(key);
    if (isTombstone(value)) {
      const m = /^(\d{13})\./.exec(value.deletedAt);
      const ms = m ? Number(m[1]) : Date.parse(value.deletedAt);
      if (!Number.isNaN(ms) && ms < cutoff) {
        map.delete(key);
        removed += 1;
      }
    }
  }
  return removed;
}

/**
 * Prune entries from an append-only map whose clock field predates the age
 * cutoff. Used to bound append-only maps (e.g. review history) that have no
 * tombstone path and would otherwise grow the in-memory CRDT document forever.
 *
 * The clock field is an HLC string (`"<epoch-ms>.<counter>"`); we extract the
 * 13-digit epoch-ms prefix (same parse the tombstone GC uses). Entries whose
 * clock we cannot parse are left in place — never delete data we can't date.
 *
 * RACE-SAFETY: only deletes entries already projected to local SQLite (i.e.
 * present in `appliedClocks`). `handleRemote` re-reads the map entry at
 * execution time, so deleting an entry before its projection task runs would
 * silently drop it from SQLite. Entries that haven't been projected yet are
 * left for a subsequent sweep. Local SQLite is the permanent record; the
 * shared map is only a delivery buffer.
 */
export interface AppendPruneResult {
  /** Entries deleted from the shared map this pass. */
  removed: number;
  /** Aged entries left in place because they haven't projected to SQLite yet. */
  pending: number;
}

function pruneAgedAppendEntries<T extends { updatedAt: string }>(
  map: Y.Map<Tombstoned<T>>,
  clockField: keyof T,
  maxAgeDays: number,
  appliedClocks: Map<string, string>,
): AppendPruneResult {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let pending = 0;
  for (const key of Array.from(map.keys())) {
    const value = map.get(key);
    // Skip tombstones — those are the tombstone GC's responsibility.
    if (isTombstone(value)) continue;
    const rawClock = String((value as Record<string, unknown>)?.[clockField as string] ?? "");
    const m = /^(\d{13})\./.exec(rawClock);
    if (!m) continue; // can't date it — leave it
    const ms = Number(m[1]);
    if (Number.isNaN(ms) || ms >= cutoff) continue; // not aged — leave it
    // Aged. Only delete if already projected; otherwise leave for a retry.
    if (appliedClocks.has(key)) {
      map.delete(key);
      removed += 1;
    } else {
      pending += 1;
    }
  }
  return { removed, pending };
}
