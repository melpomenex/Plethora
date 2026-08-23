/**
 * Android on-device STT plugin bridge (plethora-android-stt).
 *
 * Wraps the sherpa-onnx long-form transcription plugin: capability status,
 * model management (list/download/delete with progress), and the job control
 * surface the audiobook/podcast transcription wrappers poll. Non-Android
 * runtimes reject with `platform_unsupported` via the shared bridge.
 */

import { invokeAndroidPlugin } from "./bridge";
import { OnDeviceAiError } from "../onDeviceAI";

const PLUGIN = "plethora-android-stt";

export interface AndroidSttStatus {
  id: string;
  available: boolean;
  ready: boolean;
  requiresDownload: boolean;
  onDevice: boolean;
  networkRequired: boolean;
  supportsWordTimestamps: boolean;
  readyModelIds: string[];
  activeJobId?: string | null;
}

export interface AndroidSttModel {
  id: string;
  name: string;
  kind: string;
  ready: boolean;
  installing: boolean;
  bytesOnDisk: number;
  downloadBytes: number;
  description: string;
  default: boolean;
}

export interface AndroidSttModelDownloadProgress {
  modelId: string;
  bytes: number;
  totalBytes: number;
}

export interface AndroidSttWord {
  w: string;
  t: number;
}

export interface AndroidSttSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  words?: AndroidSttWord[];
}

export type AndroidSttJobState = "running" | "completed" | "cancelled" | "failed";

export interface AndroidSttJobStatus {
  jobId: string;
  status: AndroidSttJobState;
  progress: number;
  decodeOffsetMs: number;
  durationMs: number;
  totalSegments: number;
  nextCursor: number;
  segments: AndroidSttSegment[];
  errorKind?: string;
  error?: string;
}

export function getAndroidSttStatus(): Promise<AndroidSttStatus> {
  return invokeAndroidPlugin<AndroidSttStatus>(PLUGIN, "stt_status", { request: {} });
}

export function listAndroidSttModels(): Promise<{ models: AndroidSttModel[] }> {
  return invokeAndroidPlugin<{ models: AndroidSttModel[] }>(PLUGIN, "stt_list_models", {
    request: {},
  });
}

/**
 * Subscribe to the DOM progress event the Kotlin plugin dispatches during a
 * model download (same webview CustomEvent bridge the TTS plugin uses).
 * Returns an unsubscribe function.
 */
export function onAndroidSttDownloadProgress(
  listener: (progress: AndroidSttModelDownloadProgress) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AndroidSttModelDownloadProgress>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener("stt://model-download-progress", handler);
  return () => window.removeEventListener("stt://model-download-progress", handler);
}

export async function prepareAndroidSttModel(
  modelId: string,
  onProgress?: (progress: AndroidSttModelDownloadProgress) => void,
): Promise<{ ready: boolean }> {
  const unsubscribe = onProgress ? onAndroidSttDownloadProgress(onProgress) : null;
  try {
    return await invokeAndroidPlugin<{ ready: boolean }>(PLUGIN, "stt_prepare_model", {
      request: { modelId },
    });
  } finally {
    unsubscribe?.();
  }
}

export function deleteAndroidSttModel(modelId: string): Promise<{ deleted: boolean }> {
  return invokeAndroidPlugin<{ deleted: boolean }>(PLUGIN, "stt_delete_model", {
    request: { modelId },
  });
}

export function startAndroidSttJob(request: {
  jobId: string;
  sourcePath: string;
  title?: string;
  language?: string | null;
  modelId?: string;
  pacing?: string;
  resumeFromMs?: number;
}): Promise<{ jobId: string; modelId: string }> {
  return invokeAndroidPlugin<{ jobId: string; modelId: string }>(PLUGIN, "stt_start_job", {
    request,
  });
}

export function getAndroidSttJobStatus(
  jobId: string,
  cursor: number,
): Promise<AndroidSttJobStatus> {
  return invokeAndroidPlugin<AndroidSttJobStatus>(PLUGIN, "stt_job_status", {
    request: { jobId, cursor },
  });
}

export function cancelAndroidSttJob(jobId: string): Promise<{ cancelled: boolean }> {
  return invokeAndroidPlugin<{ cancelled: boolean }>(PLUGIN, "stt_cancel_job", {
    request: { jobId },
  });
}

/**
 * Cached readiness probe for the provider resolver: true when the plugin
 * reports at least one downloaded model. Falls back to false off-Android or
 * on any error (resolver then substitutes Groq, matching pre-change
 * behavior).
 */
let readinessCache: { at: number; ready: boolean } | null = null;
const READINESS_TTL_MS = 30_000;

export async function isAndroidSttReady(): Promise<boolean> {
  if (readinessCache && Date.now() - readinessCache.at < READINESS_TTL_MS) {
    return readinessCache.ready;
  }
  try {
    const status = await getAndroidSttStatus();
    readinessCache = { at: Date.now(), ready: status.ready && status.readyModelIds.length > 0 };
    return readinessCache.ready;
  } catch (error) {
    const code = error instanceof OnDeviceAiError ? error.code : "";
    if (code === "platform_unsupported") return false;
    readinessCache = { at: Date.now(), ready: false };
    return false;
  }
}

/** Invalidate the readiness cache (e.g., after a model download/delete). */
export function invalidateAndroidSttReadiness(): void {
  readinessCache = null;
}
