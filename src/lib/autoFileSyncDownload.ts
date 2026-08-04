/**
 * Auto-download controller for file sync.
 *
 * Honors the `sync.autoDownloadMode` setting ("always" | "wifi-only" | "manual")
 * by subscribing to manifest events. When a file appears on another device and
 * the mode allows, the file is fetched + persisted automatically. "manual"
 * disables this entirely (the user taps Download in the UI).
 *
 * The mapping from manifest `fileId` → document (needed to persist + update
 * filePath) is resolved via the document store's `fileId` index. Files that
 * don't correspond to a known document on this device are skipped — they may
 * be pre-import manifests from a device this one hasn't synced state with yet.
 */

import type { FileManifestEvent, FileManifest } from "./file-manifest";
import { getFileManifest, ensureFileSyncReady, getFileTransferManager } from "./useFileSync";
import { saveReceivedFileSync } from "./fileSyncRegistration";
import { useSettingsStore } from "../stores/settingsStore";
import { useDocumentStore } from "../stores/documentStore";
import { registerRoomChangeListener } from "./yjsSync";
import {
  ensureFileAvailabilityIntentReady,
  listActiveFileAvailabilityIntents,
  selectQueuePrefetchDocuments,
  subscribeFileAvailabilityIntent,
  syncQueueFileAvailabilityIntents,
} from "./sync/fileAvailabilityIntent";
import { scheduleProgressiveSyncWork, type SyncWorkContext } from "./sync/progressiveScheduler";
import type { Document } from "../types";
import { getDocuments } from "../api/documents";
import { invokeCommand, isTauri } from "./tauri";

let started = false;
let unsubscribe: (() => void) | null = null;
let roomChangeListenerRegistered = false;
let activeManifest: FileManifest | null = null;
let intentListenerRegistered = false;
const inFlightDownloads = new Set<string>();
const pendingIntents = new Map<string, { fileId: string; requestedByDevice: string }>();
// Manifest rows and document rows are projected independently. A manifest can
// therefore arrive (or be hydrated from SQLite) before its document exists in
// the Zustand store. Keep those candidates until the document projection
// catches up instead of dropping the only download trigger.
const pendingManifestDocuments = new Map<string, string>();
// The Zustand document list is scoped to the currently loaded collection/page
// and can be empty on a cold mobile boot. File sync must resolve manifest
// entries against durable SQLite, not require the user to visit Documents
// first. This bounded index is refreshed once when the watcher starts.
const durableDocumentsByFileId = new Map<string, Document>();
let documentStoreListenerRegistered = false;
let lastPrefetchSignature = "";
let queuedPrefetchPromise: Promise<void> | null = null;
let autoDownloadPass: Promise<void> | null = null;
const pendingAutoDownloads = new Map<string, string>();
const MAX_CONCURRENT_AUTO_TRANSFERS = 2;

/**
 * Begin watching the manifest for newly-available files and auto-download them
 * per the user's setting. Idempotent — safe to call from the boot path and
 * again if sync reinitializes. The subscription lives for the session.
 */
export async function startAutoFileSyncDownload(context?: SyncWorkContext): Promise<void> {
  if (!roomChangeListenerRegistered) {
    roomChangeListenerRegistered = true;
    registerRoomChangeListener(() => {
      // Defer slightly to let ensureFileSyncReady rebuild the manifest first
      setTimeout(() => {
        void startAutoFileSyncDownload();
      }, 100);
    });
  }

  try {
    await ensureFileSyncReady();
    await ensureFileAvailabilityIntentReady();
  } catch (err) {
    console.warn("[autoFileSyncDownload] sync not ready, deferring", err);
    return;
  }

  try {
    const durableDocuments = await getDocuments();
    durableDocumentsByFileId.clear();
    for (const doc of durableDocuments) {
      if (doc.fileId) durableDocumentsByFileId.set(doc.fileId, doc);
    }
  } catch (err) {
    // A document-index refresh failure should not disable future manifest
    // events; the in-memory store path can still resolve rows that are loaded.
    console.warn("[autoFileSyncDownload] durable document index unavailable, continuing", err);
  }

  const manifest = getFileManifest();
  await reconcileDurableLocalFiles(manifest, getFileTransferManager(), context);
  if (context?.shouldYield()) await context.yield();

  if (!intentListenerRegistered) {
    intentListenerRegistered = true;
    if (!documentStoreListenerRegistered) {
      documentStoreListenerRegistered = true;
      useDocumentStore.subscribe((state) => {
        for (const doc of state.documents) {
          if (doc.fileId) durableDocumentsByFileId.set(doc.fileId, doc);
        }
        for (const intent of pendingIntents.values()) {
          if (state.documents.some((doc) => doc.fileId === intent.fileId) || durableDocumentsByFileId.has(intent.fileId)) {
            pendingIntents.delete(intent.fileId);
            void maybeAutoDownloadIntent(intent);
          }
        }
        for (const [fileId, sourceDeviceId] of pendingManifestDocuments) {
          if (state.documents.some((doc) => doc.fileId === fileId) || durableDocumentsByFileId.has(fileId)) {
            pendingManifestDocuments.delete(fileId);
            void maybeAutoDownload([fileId], sourceDeviceId);
          }
        }
      });
    }
    subscribeFileAvailabilityIntent((intent, active) => {
      if (active) {
        pendingIntents.set(intent.fileId, {
          fileId: intent.fileId,
          requestedByDevice: intent.requestedByDevice,
        });
        void maybeAutoDownloadIntent(intent);
      } else {
        void listActiveFileAvailabilityIntents(intent.fileId).then((activeIntents) => {
          if (activeIntents.length === 0) pendingIntents.delete(intent.fileId);
        });
      }
    });
    // Replay active intents that arrived before this controller subscribed.
    void listActiveFileAvailabilityIntents()
      .then((intents) => Promise.all(intents.map((intent) => maybeAutoDownloadIntent(intent))))
      .catch((err) => console.warn("[autoFileSyncDownload] intent replay failed", err));
  }

  if (started && activeManifest === manifest) return;

  if (unsubscribe) {
    try {
      unsubscribe();
    } catch (e) {
      console.warn("[autoFileSyncDownload] failed to unsubscribe from old manifest", e);
    }
  }

  // A rebuilt manifest belongs to a new room/doc. Do not let candidates from
  // the previous instance leak into it.
  pendingAutoDownloads.clear();
  pendingManifestDocuments.clear();

  activeManifest = manifest;
  started = true;

  unsubscribe = manifest.subscribe((event: FileManifestEvent) => {
    if (event.type === "file-added") {
      void maybeAutoDownload([event.entry.id], event.sourceDeviceId);
      return;
    }
    if (event.type === "file-removed") {
      pendingAutoDownloads.delete(event.fileId);
      pendingManifestDocuments.delete(event.fileId);
      return;
    }
    if (event.type !== "device-online" && event.type !== "device-files-updated") {
      return;
    }
    // Re-evaluate on any availability change — a device came online or
    // announced its file list. The setting is read fresh each time so the
    // user can toggle it without a restart.
    void maybeAutoDownload(event.hasFiles, event.deviceId);
  });

  // Subscriptions only observe future changes. Reconcile the cache that was
  // hydrated from SQLite before this watcher attached, otherwise a caught-up
  // device can have a complete manifest and still never request any bytes.
  for (const entry of manifest.getAllFiles()) {
    pendingAutoDownloads.set(entry.id, entry.uploadedBy);
  }
  if (pendingAutoDownloads.size > 0) void maybeAutoDownload([], "");
}

async function maybeAutoDownload(availableFileIds: string[], sourceDeviceId: string): Promise<void> {
  for (const fileId of availableFileIds ?? []) {
    if (fileId) pendingAutoDownloads.set(fileId, sourceDeviceId);
  }
  if (autoDownloadPass) return autoDownloadPass;

  autoDownloadPass = (async () => {
    try {
      while (pendingAutoDownloads.size > 0) {
        const work = Array.from(pendingAutoDownloads.entries());
        pendingAutoDownloads.clear();
        const mode = useSettingsStore.getState().settings.sync?.autoDownloadMode ?? "wifi-only";
        if (mode === "manual") continue;
        if (mode === "wifi-only" && !(await isOnWifi())) continue;

        const documents = useDocumentStore.getState().documents;
        const manifest = getFileManifest();
        const transferManager = getFileTransferManager();
        const candidates = work.flatMap(([fileId, sourceDeviceId]) => {
          if (sourceDeviceId === manifest.getDeviceId()) return [];
          const inManifest = manifest.getAllFiles().some((f) => f.id === fileId);
          if (!inManifest && !manifest.isFileAvailable(fileId, { excludeDeviceId: manifest.getDeviceId() })) return [];
          const doc = documents.find((d) => d.fileId === fileId) ?? durableDocumentsByFileId.get(fileId);
          if (!doc) { pendingManifestDocuments.set(fileId, sourceDeviceId); return []; }
          pendingManifestDocuments.delete(fileId);
          if (doc.filePath) return [];
          return [{ doc, fileId }];
        });

        let next = 0;
        const worker = async () => {
          while (next < candidates.length) {
            const index = next++;
            const candidate = candidates[index];
            const estimate = manifest.getFile(candidate.fileId)?.sizeBytes;
            await scheduleProgressiveSyncWork({
              id: `auto-download:${candidate.fileId}`,
              lane: "P2",
              kind: "sliceable",
              estimatedBytes: Number.isFinite(estimate) ? estimate : undefined,
              maxRetries: 0,
              run: async (transferContext) => {
                if (transferContext.shouldYield()) await transferContext.yield();
                await downloadDocumentFile(candidate.doc, candidate.fileId, transferManager);
              },
            });
          }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_AUTO_TRANSFERS, candidates.length) }, worker));
      }
    } finally {
      autoDownloadPass = null;
      // An event can arrive between the final check and clearing the promise.
      if (pendingAutoDownloads.size > 0) void maybeAutoDownload([], "");
    }
  })();
  return autoDownloadPass;
}

async function maybeAutoDownloadIntent(intent: {
  fileId: string;
  requestedByDevice: string;
}): Promise<void> {
  if (!useDocumentStore.getState().documents.some((doc) => doc.fileId === intent.fileId)) {
    if (durableDocumentsByFileId.has(intent.fileId)) {
      pendingIntents.delete(intent.fileId);
      await maybeAutoDownload([intent.fileId], intent.requestedByDevice);
      return;
    }
    pendingIntents.set(intent.fileId, intent);
    return;
  }
  pendingIntents.delete(intent.fileId);
  await maybeAutoDownload([intent.fileId], intent.requestedByDevice);
}

/** Download one document file and persist it as a device-local path. */
async function downloadDocumentFile(
  doc: Document,
  fileId: string,
  transferManager = getFileTransferManager(),
): Promise<void> {
  if (inFlightDownloads.has(fileId)) return;
  inFlightDownloads.add(fileId);
  try {
    const blob = await transferManager.requestFile(fileId);
    const entry = getFileManifest().getFile(fileId);
    const storedPath = await saveReceivedFileSync(
      doc.id,
      fileId,
      blob,
      doc.fileType,
      doc.title,
      entry
        ? { sizeBytes: entry.sizeBytes, contentHash: entry.contentHash }
        : undefined,
    );
    if (storedPath) {
      useDocumentStore.setState((state) => {
        const updatedDocs = state.documents.map((d) =>
          d.id === doc.id ? { ...d, filePath: storedPath } : d
        );
        const currentDoc = state.currentDocument;
        const updatedCurrentDoc =
          currentDoc && currentDoc.id === doc.id
            ? { ...currentDoc, filePath: storedPath }
            : currentDoc;
        return {
          documents: updatedDocs,
          currentDocument: updatedCurrentDoc,
        };
      });
    }
  } catch (err) {
    console.warn("[autoFileSyncDownload] auto-download failed", fileId, err);
  } finally {
    inFlightDownloads.delete(fileId);
  }
}

/**
 * Verify app-managed paths against the manifest's plaintext size/hash before
 * treating them as local files. This repairs older builds that persisted
 * encrypted server payloads after losing their room key: the bytes are left
 * on disk for recoverability, but the document path and IndexedDB cache are
 * detached so a correctly paired session can download a verified replacement.
 */
async function reconcileDurableLocalFiles(
  manifest: FileManifest,
  transferManager = getFileTransferManager(),
  context?: SyncWorkContext,
): Promise<void> {
  if (!isTauri()) return;
  for (const entry of manifest.getAllFiles()) {
    const doc = durableDocumentsByFileId.get(entry.id);
    if (!doc?.filePath) continue;
    let valid = false;
    try {
      const [hash, size] = await invokeCommand<[string, number]>("hash_document_file", {
        filePath: doc.filePath,
      });
      valid = size === entry.sizeBytes && (!entry.contentHash || hash === entry.contentHash);
    } catch {
      valid = false;
    }
    if (valid) continue;

    console.warn(
      "[autoFileSyncDownload] detaching invalid local file before retry",
      entry.id,
      doc.filePath,
    );
    transferManager.unregisterLocalFile(entry.id);
    await invokeCommand("update_document_file_path", {
      documentId: doc.id,
      filePath: "",
    });
    durableDocumentsByFileId.set(entry.id, { ...doc, filePath: "" });
    useDocumentStore.setState((state) => ({
      documents: state.documents.map((candidate) =>
        candidate.id === doc.id ? { ...candidate, filePath: "" } : candidate
      ),
      currentDocument:
        state.currentDocument?.id === doc.id
          ? { ...state.currentDocument, filePath: "" }
          : state.currentDocument,
    }));
    if (context?.shouldYield()) await context.yield();
  }
}

/**
 * Publish and prefetch the current queue horizon. This is intentionally
 * bounded and cooperative: queue navigation remains local-first, and the
 * existing auto-download policy still decides whether bytes may transfer.
 */
export async function prefetchQueuedDocuments(documents: Document[]): Promise<void> {
  const signature = documents
    .slice(0, 3)
    .map((doc) => `${doc.id}:${doc.fileId ?? ""}`)
    .join("|");
  if (signature === lastPrefetchSignature && queuedPrefetchPromise) return queuedPrefetchPromise;
  lastPrefetchSignature = signature;

  queuedPrefetchPromise = scheduleProgressiveSyncWork({
    id: `queue-prefetch:${signature || "empty"}`,
    lane: "P2",
    maxRetries: 0,
    run: async () => {
      try {
        await ensureFileSyncReady();
        await ensureFileAvailabilityIntentReady();
        await syncQueueFileAvailabilityIntents(documents);

        const mode = useSettingsStore.getState().settings.sync?.autoDownloadMode ?? "wifi-only";
        if (mode === "manual") return;
        if (mode === "wifi-only" && !(await isOnWifi())) return;

        const manifest = getFileManifest();
        const transferManager = getFileTransferManager();
        for (const doc of selectQueuePrefetchDocuments(documents)) {
          if (!doc.fileId || transferManager.hasFileLocal(doc.fileId)) continue;
          if (!manifest.isFileAvailable(doc.fileId, { excludeDeviceId: manifest.getDeviceId() })) continue;
          await downloadDocumentFile(doc, doc.fileId, transferManager);
          // Give input/rendering a chance between queue-horizon transfers.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } catch (err) {
        console.warn("[autoFileSyncDownload] queue prefetch deferred", err);
      }
    },
  }).finally(() => {
    queuedPrefetchPromise = null;
  });
  return queuedPrefetchPromise;
}

/**
 * Best-effort WiFi detection. On Tauri mobile we can't easily query connection
 * type from the WebView without a plugin, so we use the browser's
 * `navigator.connection.effectiveType` / `type` when available and fall back to
 * true (allow downloads) when unknown — the user explicitly chose "wifi-only"
 * and we shouldn't silently block them on networks we can't classify.
 */
async function isOnWifi(): Promise<boolean> {
  const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;
  if (conn) {
    // 'type' is the most explicit signal when the platform actually knows.
    // Android WebView reports "unknown" (not "wifi") even on WiFi, so only
    // trust a definitive non-wifi type — never block on "unknown".
    if (conn.type && conn.type !== "unknown") return conn.type === "wifi";
    // effectiveType ('4g' etc.) is a rough proxy — treat anything not cellular
    // as wifi-friendly. Conservative: only block on known slow cellular.
    if (conn.effectiveType) {
      return !["slow-2g", "2g"].includes(conn.effectiveType);
    }
  }
  // Unknown → assume wifi to avoid dead-locking the user's chosen mode.
  return true;
}
