/**
 * Media Ingestion Service for Owned Recording Sessions.
 *
 * Implements private owned asset staging for audio and video files:
 * - Streams files into managed session storage without full-file RAM accumulation.
 * - Guarantees private ownership for both audio and video without second document creation.
 * - Distinguishes extension, codec, and player support separately.
 * - Never calls generic importer that groups into audiobooks or enqueues separate documents.
 * - Retains original media asset on probe or decode failure.
 * - Safe against colliding basenames, permission denial, and IO errors without source file modification.
 */

import { sessionController } from "./SessionController";
import { findSessionByMediaHash } from "../../api/recordingSessions";
import type { RecordingSession, SessionMediaAsset } from "../../types/recordingSession";
import { isNativeMobile } from "../../lib/tauri";

export type MediaKind = "audio" | "video";

export interface MediaProbeResult {
  durationMs?: number;
  codec?: string;
  canPlay: boolean;
  supported: boolean;
  error?: string;
}

export interface ImportMediaItemResult {
  filePath: string;
  sessionId?: string;
  documentId?: string;
  assetId?: string;
  mediaAsset?: SessionMediaAsset;
  status: "success" | "failed" | "duplicate" | "skipped";
  duplicateSession?: RecordingSession;
  error?: string;
}

export interface ResumableImportManifest {
  manifestId: string;
  totalPaths: string[];
  processed: Record<string, ImportMediaItemResult>;
  cancelled: boolean;
  updatedAt: string;
}

export interface ImportMediaOptions {
  paths: string[];
  collectionId?: string;
  contentType?: "lecture" | "meeting" | "interview" | "study";
  title?: string;
  duplicateAction?: "reuse" | "create-separate";
  onProgress?: (current: number, total: number, path: string) => void;
  probeOverride?: (path: string, mime: string) => Promise<MediaProbeResult>;
  filter?: (path: string) => boolean;
  isMobile?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  manifest?: ResumableImportManifest;
}

export interface ImportMediaBatchResult {
  items: ImportMediaItemResult[];
  successCount: number;
  failedCount: number;
  duplicateCount: number;
  cancelled?: boolean;
  manifest?: ResumableImportManifest;
}

const SUPPORTED_EXTENSIONS: Record<string, { kind: MediaKind; mime: string }> = {
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  wav: { kind: "audio", mime: "audio/wav" },
  flac: { kind: "audio", mime: "audio/flac" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  webm: { kind: "video", mime: "video/webm" },
  mp4: { kind: "video", mime: "video/mp4" },
  mov: { kind: "video", mime: "video/quicktime" },
};

/** Get file extension without dot in lowercase. */
export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

/** Check if extension is a supported media format. */
export function isSupportedMediaExtension(path: string): boolean {
  const ext = getFileExtension(path);
  return ext in SUPPORTED_EXTENSIONS;
}

/** Detect whether file is audio or video based on extension. */
export function detectMediaKind(path: string): MediaKind | null {
  const ext = getFileExtension(path);
  return SUPPORTED_EXTENSIONS[ext]?.kind ?? null;
}

/** Get MIME type for file path. */
export function getMediaMimeType(path: string): string {
  const ext = getFileExtension(path);
  return SUPPORTED_EXTENSIONS[ext]?.mime ?? "application/octet-stream";
}

/** Extract human-readable title from path without extension. */
export function extractTitleFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() || "Imported Media";
  const lastDot = basename.lastIndexOf(".");
  return lastDot > 0 ? basename.slice(0, lastDot) : basename;
}

/**
 * Probe media file for playable status and duration.
 * Distinguishes extension, codec, and player decoding capabilities.
 */
export async function probeMedia(
  filePath: string,
  mime: string,
  probeOverride?: (path: string, mime: string) => Promise<MediaProbeResult>
): Promise<MediaProbeResult> {
  if (probeOverride) {
    return probeOverride(filePath, mime);
  }

  // Basic HTML5 Media decoding test if browser environment supports it
  if (typeof document !== "undefined" && typeof Audio !== "undefined") {
    const isVideo = mime.startsWith("video/");
    const mediaElem = isVideo ? document.createElement("video") : new Audio();
    const canPlayType = mediaElem.canPlayType(mime);

    if (canPlayType === "") {
      return {
        canPlay: false,
        supported: false,
        error: `Codec or MIME type "${mime}" is not supported by the platform player.`,
      };
    }

    return {
      canPlay: true,
      supported: true,
      codec: mime,
    };
  }

  return {
    canPlay: true,
    supported: true,
    codec: mime,
  };
}

/**
 * Imports audio and video files as owned session media assets.
 * Streams each file into private storage without creating a second document
 * or routing through generic audiobook grouping.
 * Throttles to 2 concurrent copies on desktop, 1 on mobile, and supports cancellation.
 */
export async function importMediaFiles(options: ImportMediaOptions): Promise<ImportMediaBatchResult> {
  const isMobilePlatform = options.isMobile ?? isNativeMobile();
  const maxConcurrency = Math.max(1, options.concurrency ?? (isMobilePlatform ? 1 : 2));

  // Initialize or resume manifest
  const manifest: ResumableImportManifest = options.manifest ?? {
    manifestId: `import-manifest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    totalPaths: [...options.paths],
    processed: {},
    cancelled: false,
    updatedAt: new Date().toISOString(),
  };

  // Filter paths
  const candidatePaths = options.paths.filter((p) => {
    if (options.filter && !options.filter(p)) {
      return false;
    }
    // Skip if already successfully processed in this manifest
    if (
      manifest.processed[p]?.status === "success" ||
      manifest.processed[p]?.status === "duplicate"
    ) {
      return false;
    }
    return true;
  });

  const total = candidatePaths.length;
  let currentIndex = 0;
  let wasCancelled = false;

  async function processItem(path: string): Promise<ImportMediaItemResult> {
    if (!isSupportedMediaExtension(path)) {
      const failedItem: ImportMediaItemResult = {
        filePath: path,
        status: "failed",
        error: `Unsupported media format: .${getFileExtension(path)}`,
      };
      manifest.processed[path] = failedItem;
      return failedItem;
    }

    const mime = getMediaMimeType(path);
    const title =
      options.title && options.paths.length === 1 ? options.title : extractTitleFromPath(path);

    try {
      // 1. Create single authoritative document + recording session
      const session = await sessionController.createSession({
        origin: "file",
        title,
        contentType: options.contentType || "lecture",
        collectionId: options.collectionId,
      });

      // 2. Stage media directly into owned session storage (streams with SHA-256)
      const mediaAsset = await sessionController.stageMedia(session.id, path, mime);

      // 2b. Check for exact-source duplicate by SHA-256 hash
      if (mediaAsset.sha256) {
        const existingSession = await findSessionByMediaHash(mediaAsset.sha256, options.collectionId);
        if (existingSession && existingSession.id !== session.id) {
          if (options.duplicateAction !== "create-separate") {
            const dupItem: ImportMediaItemResult = {
              filePath: path,
              sessionId: existingSession.id,
              documentId: existingSession.documentId,
              status: "duplicate",
              duplicateSession: existingSession,
            };
            manifest.processed[path] = dupItem;
            return dupItem;
          }
        }
      }

      // 3. Probe media for playable duration and codec support
      let probeRes: MediaProbeResult;
      try {
        probeRes = await probeMedia(path, mime, options.probeOverride);
      } catch (probeErr) {
        console.warn("[importMedia] Probe warning for:", path, probeErr);
        probeRes = { canPlay: false, supported: true, error: String(probeErr) };
      }

      // 4. Finalize ingestion
      await sessionController.finalizeIngestion({ sessionId: session.id });

      const successItem: ImportMediaItemResult = {
        filePath: path,
        sessionId: session.id,
        documentId: session.documentId,
        assetId: mediaAsset.id,
        mediaAsset,
        status: "success",
        error: probeRes.canPlay ? undefined : probeRes.error,
      };
      manifest.processed[path] = successItem;
      return successItem;
    } catch (err: unknown) {
      console.error("[importMedia] Failed to import media file:", path, err);
      const failedItem: ImportMediaItemResult = {
        filePath: path,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
      manifest.processed[path] = failedItem;
      return failedItem;
    }
  }

  async function worker() {
    while (currentIndex < total) {
      if (options.signal?.aborted) {
        wasCancelled = true;
        manifest.cancelled = true;
        break;
      }
      const idx = currentIndex++;
      const path = candidatePaths[idx];
      options.onProgress?.(idx + 1, total, path);
      await processItem(path);
      manifest.updatedAt = new Date().toISOString();
    }
  }

  const workerCount = Math.min(maxConcurrency, total);
  if (workerCount > 0) {
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  }

  // Preserve original ordering of paths
  const outputPaths = options.manifest ? options.manifest.totalPaths : options.paths;
  const allResults: ImportMediaItemResult[] = outputPaths.map((p) => {
    if (manifest.processed[p]) {
      return manifest.processed[p];
    }
    return {
      filePath: p,
      status: "skipped",
      error: wasCancelled ? "Cancelled before processing" : "Filtered out",
    };
  });

  const successCount = allResults.filter((r) => r.status === "success").length;
  const failedCount = allResults.filter((r) => r.status === "failed").length;
  const duplicateCount = allResults.filter((r) => r.status === "duplicate").length;

  return {
    items: allResults,
    successCount,
    failedCount,
    duplicateCount,
    cancelled: wasCancelled,
    manifest,
  };
}

/**
 * Resumes an interrupted or cancelled import batch using its saved manifest.
 */
export async function resumeImportFromManifest(
  manifest: ResumableImportManifest,
  options: Omit<ImportMediaOptions, "paths" | "manifest">,
): Promise<ImportMediaBatchResult> {
  const remainingPaths = manifest.totalPaths.filter(
    (p) =>
      !manifest.processed[p] ||
      manifest.processed[p].status === "failed" ||
      manifest.processed[p].status === "skipped"
  );
  return importMediaFiles({
    ...options,
    paths: remainingPaths,
    manifest,
  });
}

/**
 * Retries only failed items from a previous import batch without repeating successes or duplicates.
 */
export async function retryFailedImports(
  previousBatch: ImportMediaBatchResult,
  options: Omit<ImportMediaOptions, "paths">,
): Promise<ImportMediaBatchResult> {
  const failedItems = previousBatch.items.filter((item) => item.status === "failed");
  if (failedItems.length === 0) {
    return previousBatch;
  }

  const retriedBatch = await importMediaFiles({
    ...options,
    paths: failedItems.map((i) => i.filePath),
  });

  const mergedItems = previousBatch.items.map((prev) => {
    if (prev.status !== "failed") {
      return prev;
    }
    const newlyResolved = retriedBatch.items.find((r) => r.filePath === prev.filePath);
    return newlyResolved || prev;
  });

  return {
    items: mergedItems,
    successCount: mergedItems.filter((r) => r.status === "success").length,
    failedCount: mergedItems.filter((r) => r.status === "failed").length,
    duplicateCount: mergedItems.filter((r) => r.status === "duplicate").length,
  };
}
