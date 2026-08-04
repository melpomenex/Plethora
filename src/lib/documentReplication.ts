/**
 * Document-row replication across devices via the shared Yjs doc.
 *
 * Background: the document library is backed by per-device SQLite, NOT
 * localStorage, so the localStorage bridge (which syncs settings/collections/
 * highlights) never carried document rows. Devices in the same room therefore
 * saw disjoint libraries — even with file sync working, the receiving device
 * had no row to show in its Documents tab.
 *
 * This layer closes that gap with a `documents` Y.Map keyed by document id:
 *   - publishDocument(doc): writes the local doc to the map. Called from the
 *     import path and on local edits.
 *   - remote entries are observed and upserted into local SQLite via the
 *     `upsert_synced_document` Tauri command (conflict resolution: only write
 *     when the remote dateModified is newer than local, or local is absent).
 *   - after an upsert, the documentStore reloads so the new row appears in the
 *     library UI immediately.
 *
 * The `filePath` of a remote doc is the SOURCE device's path — meaningless on
 * the receiver. We preserve the doc row (id, title, type, fileId, …) but leave
 * the receiver's filePath as-is; the file-transfer path (`fileId` → download)
 * supplies the actual bytes and writes the receiver's own path via
 * update_document_file_path once downloaded. Until then the row shows in the
 * library with an "available to download" badge.
 *
 * We store the full Document shape (minus the large `content` extracted-text
 * field, which is regenerable) so the Rust `Document` struct deserializes
 * cleanly. Best-effort by design: every failure is logged and swallowed so a
 * single bad row can never wedge replication or break local DB writes.
 */

import * as Y from "yjs";
import { invokeCommand, isTauri } from "./tauri";
import { getYjsSync, getSyncRoomId } from "./yjsSync";
import { recordYjsActivity } from "./sync/cutover";
import { getProgressiveSyncScheduler } from "./sync/progressiveScheduler";
import type { Document } from "../types";
import { useDocumentStore } from "../stores/documentStore";
import { getDocument, getDocuments } from "../api/documents";
import { writeTombstone, isTombstone, type Tombstoned } from "./sync/tombstone";
import { getDeviceId } from "./file-manifest";
import { syncClockCache } from "./sync/clockCache";
import { recordSyncWorkSize } from "./sync/syncTelemetry";
import { registerDomainHandler } from "./sync/deltaLog/domainRegistry";
import { getSyncFeatureFlags } from "./sync/featureFlags";
import { enqueueSyncOperation } from "./sync/syncJournal";
import { isYjsPublishSuppressed } from "./sync/deltaLog/yjsPublishGate";
import { nowHLC } from "./sync/syncClock";
import { isPortableFilePath } from "./sync/filePathPortability";

// Task 5.4: documents predates createReplicatedMap/createProjector and has
// bespoke conflict logic (fileId dedup, filePath/cover-image preservation)
// that doesn't fit the generic row-lww shape, so it isn't retargeted onto
// the projector — instead it registers its own handler directly, in the
// same domain registry, so the delta-log router can reach it identically.
registerDomainHandler("documents", (key, remote) =>
  handleRemoteDocument(key, remote as Tombstoned<Document> | undefined),
);

let initialized = false;
let initPromise: Promise<void> | null = null;
let documentsMap: Y.Map<Document> | null = null;

/**
 * Cached snapshot of the local documents list, used by the fileId dedup in
 * handleRemoteDocument. Loading all docs per-remote-row was the cold-boot
 * projection bottleneck (O(n) SQLite round-trips per doc). Invalidated on
 * room switch and after each upsert (the next dedup re-loads it lazily).
 */
let persistedDocsCache: Document[] | null = null;

const DEFAULT_COLLECTION_ID = "00000000-0000-0000-0000-000000000001";
const SYNCED_DOCUMENT_FILE_TYPES = new Set<Document["fileType"]>([
  "pdf",
  "epub",
  "markdown",
  "html",
  "youtube",
  "audio",
  "video",
  "other",
]);

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function syncedDocumentDate(value: unknown, fallback: unknown): string {
  for (const candidate of [value, fallback]) {
    if (typeof candidate !== "string" && !(candidate instanceof Date)) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Convert a potentially old journal/Yjs document shape into the complete DTO
 * required by Rust's `Document` command argument. Several Rust fields were
 * added after document sync first shipped while the TypeScript interface kept
 * them optional for compatibility. Passing an old compacted row through
 * unchanged makes Tauri reject the command before its Rust body runs.
 */
function normalizeSyncedDocument(document: Document): Document {
  const raw = document as Document & Record<string, unknown>;
  const dateAdded = syncedDocumentDate(raw.dateAdded, raw.dateModified);
  const dateModified = syncedDocumentDate(raw.dateModified, dateAdded);
  const fileId =
    (typeof raw.fileId === "string" && raw.fileId) ||
    (typeof raw.metadata?.fileId === "string" && raw.metadata.fileId) ||
    undefined;
  const currentViewState = raw.currentViewState;

  return {
    ...document,
    id: typeof raw.id === "string" ? raw.id : "",
    collectionId:
      typeof raw.collectionId === "string" && raw.collectionId
        ? raw.collectionId
        : DEFAULT_COLLECTION_ID,
    title: typeof raw.title === "string" ? raw.title : "",
    filePath: typeof raw.filePath === "string" ? raw.filePath : "",
    fileType: SYNCED_DOCUMENT_FILE_TYPES.has(raw.fileType as Document["fileType"])
      ? (raw.fileType as Document["fileType"])
      : "other",
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    dateAdded,
    dateModified,
    extractCount: finiteNumber(raw.extractCount),
    learningItemCount: finiteNumber(raw.learningItemCount),
    priorityRating: finiteNumber(raw.priorityRating),
    prioritySlider: finiteNumber(raw.prioritySlider),
    priorityScore: finiteNumber(raw.priorityScore),
    priorityExplicitlySet: raw.priorityExplicitlySet === true,
    isArchived: raw.isArchived === true,
    isFavorite: raw.isFavorite === true,
    isDismissed: raw.isDismissed === true,
    readingCount: finiteNumber(raw.readingCount),
    currentViewState:
      currentViewState && typeof currentViewState === "object"
        ? JSON.stringify(currentViewState)
        : currentViewState,
    fileId,
    metadata: fileId
      ? { ...(raw.metadata ?? {}), fileId }
      : raw.metadata,
  };
}

/**
 * filePath schemes that are the document's CONTENT rather than a device-local
 * filesystem location, and therefore must survive replication to other devices.
 * YouTube imports store the watch URL in filePath (the viewer extracts the video
 * id from it); web/URL imports use `browser-fetched://`; the clipboard inbox and
 * screenshot/bundle imports use their own schemes. Absolute paths (/home/...,
 * C:\...) and bare filenames are device-local and excluded — those docs reach
 * peers through the file-sync layer, not via filePath.
 *
 * Lives in its own dependency-free module (filePathPortability.ts) so
 * seedReaders.ts can use this exact same check without pulling in this
 * file's full module graph (stores, Yjs, i18n) — re-exported here so
 * existing importers of `isPortableFilePath` from this module keep working.
 */
export { isPortableFilePath } from "./sync/filePathPortability";

/**
 * Initialize the replication layer: attach to the shared yjs doc's `documents`
 * map and subscribe to remote changes. Idempotent; safe to call from boot and
 * lazily from the publish path.
 */
export async function ensureDocumentReplicationReady(): Promise<void> {
  const sync = await getYjsSync();
  if (initialized && documentsMap && documentsMap.doc === sync.doc) return;

  if (documentsMap && documentsMap.doc !== sync.doc) {
    initialized = false;
    initPromise = null;
    documentsMap = null;
    persistedDocsCache = null; // invalidate on room switch
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        const sync = await getYjsSync();
        documentsMap = sync.doc.getMap<Document>("documents");
        documentsMap.observe((event) => {
          // P6 quiesce tracking (task 6.6) — see the same call in replicatedMap.ts.
          void recordYjsActivity(getSyncRoomId());
          for (const key of event.keysChanged) {
            // Don't re-process our own writes: handleRemoteDocument checks
            // dateModified against local and no-ops if we're already current.
            getProgressiveSyncScheduler().enqueue({
              id: `documents:remote:${key}`,
              // Remote document projection is important but not interactive-
              // critical: keeping it in P1 lets the scheduler yield while the
              // user is switching tabs, without dropping the Yjs update.
              lane: "P1",
              run: () => handleRemoteDocument(key),
            });
          }
        });
        // Process anything already in the map (e.g. docs published before this
        // device joined the room).
        let replayBytes = 0;
        let replayRecords = 0;
        documentsMap.forEach((value, key) => {
          replayRecords += 1;
          try { replayBytes += JSON.stringify(value)?.length ?? 0; } catch { /* diagnostic only */ }
          const remoteClock = value.dateModified || value.dateAdded;
          if (remoteClock) {
            const clockStr = typeof remoteClock === "string" ? remoteClock : new Date(remoteClock).toISOString();
            if (!syncClockCache.isStale("documents", key, clockStr)) {
              return; // Local SQLite is already up-to-date!
            }
          }
          getProgressiveSyncScheduler().enqueue({
            id: `documents:replay:${key}`,
            lane: "P1",
            run: () => handleRemoteDocument(key),
          });
        });
        if (replayRecords > 0) recordSyncWorkSize(replayBytes, replayRecords);
        initialized = true;
      } catch (err) {
        // Reset so a later call can retry — mirrors the file-sync fix.
        initPromise = null;
        console.error("[documentReplication] init failed", err);
        throw err;
      }
    })();
  }
  return initPromise;
}

/**
 * Publish a local document to the shared map so other devices receive it.
 * No-op outside Tauri (web/PWA has no docs to share via this path). Strips the
 * large `content` field (regenerable extracted text) to keep the wire small.
 */
export async function publishDocument(
  doc: Document,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isTauri()) return;
  try {
    // Skip the write entirely when this doc's clock hasn't advanced since the
    // last publish/remote-apply we recorded for it. Without this, callers that
    // re-publish the whole library unconditionally (e.g. registerExistingFilesSync
    // on every Documents-tab activation) turn every unchanged document into a
    // Yjs write, which in turn fires documentsMap.observe() and re-enqueues
    // handleRemoteDocument for that key — hundreds of no-op round trips for a
    // library that hasn't changed at all. syncClockCache already tracks the
    // last-known clock per doc id (updated both here and on remote apply), so
    // reuse isStale as an "unchanged" check: not stale means the clock we'd be
    // writing is not newer than what's already recorded, i.e. nothing to publish.
    const rawClock = doc.dateModified || doc.dateAdded;
    const clockStr = rawClock
      ? typeof rawClock === "string"
        ? rawClock
        : new Date(rawClock).toISOString()
      : null;
    if (!options.force && clockStr && !syncClockCache.isStale("documents", doc.id, clockStr)) {
      return;
    }
    // Drop fields that are large and either regenerable or device-specific, so
    // the shared CRDT document stays small. The Yjs doc grows monotonically
    // (deletes are permanent tombstones), so publishing a few hundred-KB
    // cover-image data-URLs here bloats the doc to multiple MB — which then
    // makes the sync exchange so large that connections drop before the
    // handshake completes, breaking replication entirely. This was the actual
    // root cause of the "nothing syncs" failure in the field.
    //
    //   content          — extracted text; receiver re-extracts from the file.
    //   coverImageUrl    — often a 100KB+ base64 data-URL; receiver regenerates
    //                      its own cover from the downloaded file.
    //   currentViewState — device-specific (window size, zoom).
    const {
      content: _content,
      coverImageUrl: _coverImageUrl,
      currentViewState: _currentViewState,
      ...lightweight
    } = doc;
    // A device-local filePath (the common case: an imported PDF/EPUB) must
    // not go out on the wire at all — the outbox's privacy filter
    // (syncPrivacy.ts) rejects the WHOLE payload if it does, silently
    // dropping the entire document rather than just the path. Only a
    // portable filePath (a YouTube/web/clipboard/screenshot URL, which IS
    // meaningful content on the receiver) is worth sending; a local path is
    // meaningless there anyway (see the module doc comment above) and
    // omitting the key lets handleRemoteDocument's existing "keep local
    // filePath" fallback apply.
    if (!isPortableFilePath(lightweight.filePath, lightweight.fileType)) {
      delete (lightweight as { filePath?: string }).filePath;
    }
    // Never put `metadata: null` on the wire. An explicit null reads to the
    // receiver as "blank your metadata", which unlinks its fileId; omitting
    // the key lets the receiver keep what it has. See handleRemoteDocument.
    if (lightweight.metadata == null) {
      delete (lightweight as { metadata?: unknown }).metadata;
    }
    // Enqueue to the durable outbox BEFORE the Yjs map write and before the
    // map-binding await. The outbox reaches the delta-log transport
    // independently and must survive a future where the Yjs map is absent
    // (state/map null) — previously this sat after `if (!documentsMap) return`
    // and silently dropped every document write when the map wasn't bound.
    if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
      const clockForJournal = doc.dateModified || doc.dateAdded;
      void enqueueSyncOperation({
        domain: "documents",
        entityKey: doc.id,
        operation: "upsert",
        payload: lightweight,
        clock: clockForJournal
          ? typeof clockForJournal === "string"
            ? clockForJournal
            : new Date(clockForJournal).toISOString()
          : nowHLC(),
      });
    }
    await ensureDocumentReplicationReady();
    if (documentsMap && !isYjsPublishSuppressed()) {
      documentsMap.set(doc.id, lightweight as Document);
    }
    const clock = doc.dateModified || doc.dateAdded;
    if (clock) {
      const clockStr = typeof clock === "string" ? clock : new Date(clock).toISOString();
      syncClockCache.updateClock("documents", doc.id, clockStr);
    }
  } catch (err) {
    console.warn("[documentReplication] publish failed", doc.id, err);
  }
}

/**
 * Publish a deletion (tombstone) to Yjs so other devices delete their local copies.
 */
export async function deleteDocumentSync(docId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    // Enqueue the tombstone to the outbox before the Yjs map write, mirroring
    // publishDocument — the durable delete must reach the delta-log server
    // even when the Yjs map isn't bound.
    if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
      void enqueueSyncOperation({
        domain: "documents",
        entityKey: docId,
        operation: "delete",
        payload: null,
        clock: nowHLC(),
      });
    }
    await ensureDocumentReplicationReady();
    if (documentsMap && !isYjsPublishSuppressed()) {
      writeTombstone(documentsMap, docId, getDeviceId());
    }
    // Forget the cached clock: a later undo/restore publishes the document
    // with its pre-delete dateModified, which would otherwise look
    // "unchanged" to publishDocument's clock-skip check and never overwrite
    // the tombstone we just wrote.
    syncClockCache.clearClock("documents", docId);
  } catch (err) {
    console.warn("[documentReplication] delete publish failed", docId, err);
  }
}

/**
 * Trailing debounce window for position re-publishes. Reading-position saves
 * fire frequently (scroll/timeupdate/relocate tick many times per second), and
 * every publish appends a Y.Map entry that the CRDT retains forever as a
 * tombstone — so collapsing a burst of saves into one publish is what keeps
 * the shared doc from ballooning into multi-MB sync exchanges that drop the
 * connection before handshake completes (the original "nothing syncs" failure).
 */
const POSITION_REPUBLISH_DEBOUNCE_MS = 1500;
const pendingPositionRepublish = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Trailing debounce for the in-memory document-store refresh after a remote
 * upsert. `handleRemoteDocument` runs once per incoming Yjs map entry, and the
 * init map-replay (`forEach` over every row in the room) fires it for ALL rows
 * on cold boot. Without coalescing, N rows trigger N sequential
 * `loadDocuments()` calls — each a full SQLite read + a Zustand `set` that
 * re-renders every library component + a `registerExistingFilesSync` sweep that
 * re-hashes every local file and re-publishes every doc back to Yjs. That
 * N×(reload + re-render + re-hash) storm is the dominant startup-lag cause.
 *
 * The remote row is already persisted to SQLite by `upsert_synced_document`
 * before this fires, so deferring only the in-memory refresh by 200ms keeps the
 * library-update latency imperceptible while collapsing any burst (init replay
 * or a multi-doc import on another device) into a single reload. Chosen below
 * the other debounce windows in this stack (350/400/500ms) so they can't compound.
 */
const STORE_RELOAD_DEBOUNCE_MS = 200;
let storeReloadTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDocumentStoreReload(): void {
  if (storeReloadTimer) clearTimeout(storeReloadTimer);
  storeReloadTimer = setTimeout(() => {
    storeReloadTimer = null;
    // Keep the coalesced refresh on the same input-aware scheduler as remote
    // projections. A timer alone still wakes in the middle of a tab-switch
    // burst; the scheduler can defer this single UI refresh until input rests.
    getProgressiveSyncScheduler().enqueue({
      id: "documents:store-reload",
      lane: "P2",
      run: () => useDocumentStore.getState().loadDocuments(),
    });
  }, STORE_RELOAD_DEBOUNCE_MS);
}

/**
 * Re-publish a document to the shared `documents` map after a reading-position
 * change, so other devices in the room learn the new CFI / page / scroll /
 * time position. This is the missing link for cross-device position sync:
 * `publishDocument` only runs at import time, but position is written later by
 * the viewers via `update_document_progress` / `save_document_position`, which
 * until now touched only local SQLite.
 *
 * Accepts either the full updated Document (preferred — avoids a SQLite
 * round-trip) or just the id (refetched via `getDocument`). Fire-and-forget by
 * design: callers (viewer save paths) must never block on sync. Coalesces
 * rapid successive calls for the same doc id via a trailing debounce.
 *
 * The existing `handleRemoteDocument` conflict check (dateModified newest-wins)
 * prevents an echo loop: the receiver upserts the remote row verbatim
 * (including its `dateModified`), so a re-broadcast of that same timestamp is
 * a no-op. `publishDocument` also strips device-local fields, so position is
 * the only thing that actually changes on the wire.
 */
export function republishDocumentPosition(docOrId: Document | string): void {
  if (!isTauri()) return;
  const docId = typeof docOrId === "string" ? docOrId : docOrId.id;
  if (!docId) return;

  const existing = pendingPositionRepublish.get(docId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingPositionRepublish.delete(docId);
    void (async () => {
      try {
        await ensureDocumentReplicationReady();
        const doc =
          typeof docOrId === "string" ? await getDocument(docOrId) : docOrId;
        if (doc) await publishDocument(doc);
      } catch (err) {
        console.warn(
          "[documentReplication] position republish failed",
          docId,
          err,
        );
      }
    })();
  }, POSITION_REPUBLISH_DEBOUNCE_MS);

  pendingPositionRepublish.set(docId, timer);
}

/**
 * Handle a document entry from the shared map: if it's newer than the local
 * row (or local doesn't have it), upsert into SQLite and reload the store so
 * the library reflects it. Skips our own writes (handled by dateModified check
 * — our publish stamped the same timestamp we'd be receiving back).
 */
async function handleRemoteDocument(
  docId: string,
  remoteOverride?: Tombstoned<Document>,
): Promise<void> {
  if (!isTauri()) return;
  // The Yjs path (map.observe/replay) omits remoteOverride and re-reads the
  // map at execution time, matching the original behavior. The delta-log
  // router (Phase 5.4) supplies the decrypted value directly instead.
  const remote = remoteOverride !== undefined ? remoteOverride : documentsMap?.get(docId);
  if (!remote) {
    return; // entry was deleted; deletion sync is out of scope here.
  }

  const localDocs = useDocumentStore.getState().documents ?? [];

  if (isTombstone(remote)) {
    try {
      const local = localDocs.find((d) => d.id === docId) || (await getDocument(docId).catch(() => null));
      if (local) {
        await invokeCommand("delete_document", { id: docId });
        const fileId = local.fileId;
        if (fileId) {
          try {
            const { getFileTransferManager, ensureFileSyncReady } = await import("./useFileSync");
            const { deleteCachedFile } = await import("./file-transfer");
            await ensureFileSyncReady();
            getFileTransferManager().unregisterLocalFile(fileId);
            await deleteCachedFile(fileId);
          } catch (e) {
            console.warn("[documentReplication] failed to clean up sync files on remote delete", e);
          }
        }
        scheduleDocumentStoreReload();
      }
    } catch (err) {
      console.warn("[documentReplication] failed to apply remote delete", docId, err);
      throw err;
    }
    return;
  }

  // Dedupe by fileId: each book has one sync-manifest fileId shared across
  // devices, but each device originally created its own document row with its
  // own id. If a local row already exists for the same fileId under a DIFFERENT
  // id, upserting `remote` as-is would create a duplicate (one row per device
  // id). Instead, adopt the local row's id so `INSERT OR REPLACE` updates the
  // existing row in place, and preserve device-local state (filePath, reading
  // position). Falls back to the remote id when there's no local match.
  const remoteFileId = remote.fileId ?? remote.metadata?.fileId;
  let sameFileIdLocal = remoteFileId
    ? localDocs.find((d) => d.fileId === remoteFileId)
    : undefined;

  let local = localDocs.find((d) => d.id === docId) ?? sameFileIdLocal;

  // The replication layer can initialize before the document store has loaded
  // from SQLite on cold startup. Consult SQLite before deciding "local absent";
  // otherwise a remote row can overwrite a valid local filePath with "".
  if (!local) {
    try {
      local = (await getDocument(docId)) ?? undefined;
    } catch (err) {
      console.warn("[documentReplication] failed to load local document by id", docId, err);
    }
  }

  if (!local && remoteFileId) {
    // The fileId dedup needs the full local document list, but loading it via
    // getDocuments() for EVERY remote doc is O(n) SQLite round-trips per doc —
    // on a cold boot pulling 273 docs that's hundreds of synchronous command
    // hops through the Tauri bridge, making projection take minutes instead of
    // seconds. Cache the snapshot once and reuse it; invalidate on room switch.
    try {
      if (!persistedDocsCache) {
        persistedDocsCache = await getDocuments();
      }
      sameFileIdLocal = persistedDocsCache.find((d) => d.fileId === remoteFileId);
      local = sameFileIdLocal;
    } catch (err) {
      console.warn("[documentReplication] failed to load local documents for fileId dedupe", docId, err);
    }
  }

  // Conflict check: only write if remote is newer than local (or local absent).
  if (local) {
    const localMs = Date.parse(local.dateModified || local.dateAdded);
    const remoteMs = Date.parse(remote.dateModified || remote.dateAdded);
    if (!Number.isNaN(localMs) && !Number.isNaN(remoteMs) && remoteMs <= localMs) {
      // The row clock can already be current while its file-manifest linkage
      // is missing locally. Older receivers persisted only `metadata` through
      // Rust but the wire document carried `fileId` at the top level, so the
      // initial projection silently lost that linkage. A cursor replay then
      // used to return here forever, leaving auto-download unable to map any
      // manifest entry to its document. Reconcile only the missing fileId from
      // the remote row while retaining every other local field.
      if (remoteFileId && local.fileId !== remoteFileId) {
        const linkedLocal = normalizeSyncedDocument({
          ...local,
          fileId: remoteFileId,
          metadata: { ...local.metadata, fileId: remoteFileId },
        });
        await invokeCommand("upsert_synced_document", { document: linkedLocal });
        scheduleDocumentStoreReload();
      }
      return; // local is at least as new — don't clobber.
    }
  }

  try {
    const docToUpsert = { ...remote };
    // Reuse the local row's id when deduping by fileId (see above).
    if (local && local.id !== docToUpsert.id) {
      docToUpsert.id = local.id;
    }
    // Decide the receiver's filePath. Three cases:
    //  1. Local already has a filePath → keep it (it's this device's own path
    //     or the URL it already resolved). Never let a remote update blank it.
    //  2. Local has none, remote has a portable (URL/identifier) filePath →
    //     adopt the remote value (it's the content: YouTube URL, web article…).
    //  3. Local has none, remote filePath is a device-local path or absent → "".
    //
    // CRITICAL: a remote publish that is MISSING filePath (a partial republish,
    // observed in the field) must NOT overwrite a portable filePath we already
    // hold. For youtube/web docs the filePath IS the content — blanking it
    // makes the doc unopenable ("player broken" symptom). So when the doc is of
    // a portable type and the remote value is empty, fall back to any local
    // portable filePath before accepting "".
    if (local && local.filePath) {
      docToUpsert.filePath = local.filePath;
    } else if (remote.filePath && isPortableFilePath(remote.filePath, remote.fileType)) {
      docToUpsert.filePath = remote.filePath;
    } else if (
      isPortableFilePath(undefined, remote.fileType) &&
      local && isPortableFilePath(local.filePath, local.fileType)
    ) {
      // Portable-type doc, remote sent no filePath: preserve our existing URL
      // rather than clobbering it with "".
      docToUpsert.filePath = local.filePath;
    } else {
      docToUpsert.filePath = "";
    }
    // Preserve device-local fields the sender intentionally strips (see
    // publishDocument): coverImageUrl is regenerated by each device from its
    // own copy of the file, and currentViewState is screen-size-specific. The
    // remote payload omits these, so without preserving them here the
    // INSERT OR REPLACE would blank the receiver's cover on every sync.
    if (local) {
      if (local.coverImageUrl) docToUpsert.coverImageUrl = local.coverImageUrl;
      if (local.coverImageSource) docToUpsert.coverImageSource = local.coverImageSource;
      if (local.currentViewState) docToUpsert.currentViewState = local.currentViewState;
    }
    // `fileId` lives only inside `metadata` (the documents table has no
    // file_id column) and it is the ONLY link between a document row and its
    // file-manifest entry — without it auto-download can never match a
    // manifest entry to a document, so the file bytes never arrive and the
    // viewer falls back to "preview coming soon".
    //
    // Whole-row LWW made that link fragile: a publisher whose own copy had
    // lost `metadata` would overwrite everyone else's link at an equal clock,
    // and `publishDocument`'s unchanged-clock skip then stopped any device
    // from ever putting it back (dateModified never advances). Treat the link
    // as absent → present only: a remote row that carries no fileId must
    // never unlink what this device already has.
    const localFileId = local?.fileId ?? local?.metadata?.fileId;
    if (!remoteFileId && localFileId) {
      docToUpsert.fileId = localFileId;
      docToUpsert.metadata = { ...(local?.metadata ?? {}), ...(docToUpsert.metadata ?? {}), fileId: localFileId };
    } else if (local?.metadata && (docToUpsert.metadata === undefined || docToUpsert.metadata === null)) {
      // Same reasoning for the whole object: a publisher that sends no
      // metadata at all must not blank the receiver's.
      docToUpsert.metadata = local.metadata;
    }

    const normalizedDocument = normalizeSyncedDocument(docToUpsert);
    await invokeCommand("upsert_synced_document", { document: normalizedDocument });
    // Note: we deliberately do NOT invalidate persistedDocsCache here. The
    // cache is an optimization for the fileId dedup during a pull burst;
    // invalidating per-row would reintroduce the O(n) per-doc cost. Correctness
    // is preserved by INSERT OR REPLACE semantics — a missed dedup just means
    // the row upserts under its own remote id rather than adopting a local id,
    // which is harmless (the next room-switch/refresh re-syncs). The cache is
    // invalidated on room switch (the only case where staleness matters).
    const clock = normalizedDocument.dateModified || normalizedDocument.dateAdded;
    if (clock) {
      const clockStr = typeof clock === "string" ? clock : new Date(clock).toISOString();
      syncClockCache.updateClock("documents", normalizedDocument.id, clockStr);
    }
    // Coalesce the in-memory library refresh: reload once after the burst
    // settles, not once per row. Each incoming row previously triggered its own
    // loadDocuments() (full SQLite read + React re-render + registerExisting-
    // FilesSync re-hash sweep); on cold boot N rows = N reloads = the lag.
    scheduleDocumentStoreReload();
  } catch (err) {
    console.warn("[documentReplication] upsert failed", docId, err);
    throw err;
  }
}
