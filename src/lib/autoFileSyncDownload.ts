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
import { scheduleProgressiveSyncWork } from "./sync/progressiveScheduler";
import type { Document } from "../types";

let started = false;
let unsubscribe: (() => void) | null = null;
let roomChangeListenerRegistered = false;
let activeManifest: FileManifest | null = null;
let intentListenerRegistered = false;
const inFlightDownloads = new Set<string>();
const pendingIntents = new Map<string, { fileId: string; requestedByDevice: string }>();
let documentStoreListenerRegistered = false;
let lastPrefetchSignature = "";
let queuedPrefetchPromise: Promise<void> | null = null;

/**
 * Begin watching the manifest for newly-available files and auto-download them
 * per the user's setting. Idempotent — safe to call from the boot path and
 * again if sync reinitializes. The subscription lives for the session.
 */
export async function startAutoFileSyncDownload(): Promise<void> {
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

  const manifest = getFileManifest();

  if (!intentListenerRegistered) {
    intentListenerRegistered = true;
    if (!documentStoreListenerRegistered) {
      documentStoreListenerRegistered = true;
      useDocumentStore.subscribe((state) => {
        for (const intent of pendingIntents.values()) {
          if (state.documents.some((doc) => doc.fileId === intent.fileId)) {
            pendingIntents.delete(intent.fileId);
            void maybeAutoDownloadIntent(intent);
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

  activeManifest = manifest;
  started = true;

  unsubscribe = manifest.subscribe((event: FileManifestEvent) => {
    if (event.type === "file-added") {
      void maybeAutoDownload([event.entry.id], event.sourceDeviceId);
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
}

async function maybeAutoDownload(availableFileIds: string[], sourceDeviceId: string): Promise<void> {
  if (!availableFileIds || availableFileIds.length === 0) return;

  const mode = useSettingsStore.getState().settings.sync?.autoDownloadMode ?? "wifi-only";
  if (mode === "manual") return;
  if (mode === "wifi-only" && !(await isOnWifi())) return;
  // mode === "always" → proceed unconditionally

  const documents = useDocumentStore.getState().documents;
  const manifest = getFileManifest();
  if (sourceDeviceId === manifest.getDeviceId()) return;
  const transferManager = getFileTransferManager();

  for (const fileId of availableFileIds) {
    // Skip files we already have locally (in-memory map or cached).
    if (transferManager.hasFileLocal(fileId)) continue;
    
    const inManifest = manifest.getAllFiles().some((f) => f.id === fileId);
    if (!inManifest && !manifest.isFileAvailable(fileId, { excludeDeviceId: manifest.getDeviceId() })) continue;

    // Find the document this file belongs to on this device (needed to persist
    // + update filePath). If we don't know about it yet, skip — it'll be
    // handled once state-sync delivers the document row.
    const doc = documents.find((d) => d.fileId === fileId);
    if (!doc) continue;

    await downloadDocumentFile(doc, fileId, transferManager);
  }
}

async function maybeAutoDownloadIntent(intent: {
  fileId: string;
  requestedByDevice: string;
}): Promise<void> {
  if (!useDocumentStore.getState().documents.some((doc) => doc.fileId === intent.fileId)) {
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
  if (inFlightDownloads.has(fileId) || transferManager.hasFileLocal(fileId)) return;
  inFlightDownloads.add(fileId);
  try {
    const blob = await transferManager.requestFile(fileId);
    const storedPath = await saveReceivedFileSync(doc.id, fileId, blob, doc.fileType, doc.title);
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
    id: `sync:queue-prefetch:${signature || "empty"}`,
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
    // 'type' is the most explicit (experimental but supported in Chromium WebView).
    if (conn.type) return conn.type === "wifi";
    // effectiveType ('4g' etc.) is a rough proxy — treat anything not cellular
    // as wifi-friendly. Conservative: only block on known slow cellular.
    if (conn.effectiveType) {
      return !["slow-2g", "2g"].includes(conn.effectiveType);
    }
  }
  // Unknown → assume wifi to avoid dead-locking the user's chosen mode.
  return true;
}
