import { updateDocumentContent } from "../api/documents";
import { getTranscriptionProfiles } from "../api/transcription";
import { generateVideoTranscript, getVideoTranscript } from "../api/video-extracts";
import {
  GroqTranscriptionError,
} from "../api/groqTranscription";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore, ToastType } from "../components/common/Toast";
import { isTauri } from "./tauri";
import { getTranscriptionService, TranscriptionError, TranscriptionMode } from "../services/transcription";
import { resolveSttProvider, resolveTranscriptionMode } from "../services/transcription/config";
import { persistTranscriptionResult } from "../services/transcription/persist";

type VideoTranscriptionStatus = "queued" | "processing" | "completed" | "failed" | "needs-model" | "needs-api-key" | "file-too-large";

type VideoTranscriptionJobProvider = "local" | "cloud";

interface VideoTranscriptionJob {
  documentId: string;
  filePath: string;
  documentTitle?: string;
  provider: VideoTranscriptionJobProvider;
  modelId?: string;
  language: string;
}

/**
 * Callback for when user clicks "Open Document" on completion toast
 */
type OpenDocumentCallback = (documentId: string) => void;
let openDocumentCallback: OpenDocumentCallback | null = null;

/**
 * Register a callback to open documents from toast notifications
 */
export function registerOpenDocumentCallback(callback: OpenDocumentCallback): () => void {
  openDocumentCallback = callback;
  return () => {
    openDocumentCallback = null;
  };
}

interface VideoTranscriptionRequest {
  documentId: string;
  filePath: string;
  documentTitle?: string;
  provider?: VideoTranscriptionJobProvider;
  modelId?: string;
  language?: string;
}

type StatusListener = (status: VideoTranscriptionStatus) => void;

const queue: VideoTranscriptionJob[] = [];
const statusByDocument = new Map<string, VideoTranscriptionStatus>();
const errorByDocument = new Map<string, string>(); // Store error messages
const listenersByDocument = new Map<string, Set<StatusListener>>();
const activePlaybackDocuments = new Set<string>();
const documentTitles = new Map<string, string>(); // Store titles for notifications
let isProcessing = false;

function notify(documentId: string, status: VideoTranscriptionStatus) {
  statusByDocument.set(documentId, status);
  const listeners = listenersByDocument.get(documentId);
  if (!listeners) return;
  listeners.forEach((listener) => listener(status));
}

function schedule(fn: () => void) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (window as typeof window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(fn);
  } else {
    setTimeout(fn, 1000);
  }
}

function getProvider(): VideoTranscriptionJobProvider {
  const audio = useSettingsStore.getState().settings.audioTranscription;
  const sttProvider = resolveSttProvider(audio);
  if (sttProvider === "local") return "local";
  const mode = resolveTranscriptionMode(audio);
  if (mode === TranscriptionMode.Offline) return "local";
  return "cloud";
}

function providerDisplayName(provider: VideoTranscriptionJobProvider): string {
  return provider === "local" ? "Local" : "Cloud (TranscriptionService)";
}

async function readAudioBlob(filePath: string): Promise<File> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const { basename, extname } = await import("@tauri-apps/api/path");
  const bytes = await readFile(filePath);
  const name = await basename(filePath);
  const extension = (await extname(filePath)).replace(/^\./, "").toLowerCase();
  const mimeByExt: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    aac: "audio/aac",
    webm: "audio/webm",
  };
  const mimeType = mimeByExt[extension] || "audio/wav";
  return new File([bytes], name, { type: mimeType });
}

function getPreferredModelId(): string | null {
  const preferred = useSettingsStore.getState().settings.audioTranscription.preferredModelId;
  return preferred || null;
}

async function resolveModelId(requestedModelId?: string): Promise<string | null> {
  try {
    const profiles = await getTranscriptionProfiles();
    const installed = profiles.filter((profile) => profile.installed);
    if (installed.length === 0) return null;

    if (requestedModelId) {
      const requested = installed.find((profile) => profile.id === requestedModelId);
      return requested ? requested.id : null;
    }

    const preferred = getPreferredModelId();
    if (preferred) {
      const match = installed.find((profile) => profile.id === preferred);
      if (match) return match.id;
    }

    const distil = installed.find((profile) => profile.id === "distil-small.en");
    return distil ? distil.id : installed[0].id;
  } catch {
    return null;
  }
}

function shouldDelayForPlayback(): boolean {
  return activePlaybackDocuments.size > 0;
}

/**
 * Process transcription using the provider-independent cloud service.
 */
async function processWithCloudService(job: VideoTranscriptionJob): Promise<void> {
  const audioSettings = useSettingsStore.getState().settings.audioTranscription;
  const mode = resolveTranscriptionMode(audioSettings);
  const language = job.language !== "auto" ? job.language : undefined;

  let file: File | Blob | undefined;
  if (isTauri()) {
    file = await readAudioBlob(job.filePath);
  }

  try {
    const result = await getTranscriptionService().transcribe(
      {
        file,
        filePath: job.filePath,
        documentId: job.documentId,
      },
      { mode, language },
    );
    await persistTranscriptionResult(job.documentId, result);
  } catch (error) {
    if (error instanceof TranscriptionError && error.code === "AUTH_FAILED") {
      notify(job.documentId, "needs-api-key");
    }
    if (error instanceof GroqTranscriptionError) {
      if (error.code === "FILE_TOO_LARGE" || error.code === "CHUNKING_FAILED") {
        notify(job.documentId, "file-too-large");
      }
    }
    throw error;
  }
}

/**
 * Process transcription using local Whisper
 */
async function processWithLocalWhisper(job: VideoTranscriptionJob): Promise<void> {
  const modelId = await resolveModelId(job.modelId);
  if (!modelId) {
    notify(job.documentId, "needs-model");
    throw new Error("No transcription model available");
  }
  
  const existing = await getVideoTranscript(job.documentId);
  if (!existing || existing.segments.length === 0) {
    await generateVideoTranscript(job.documentId, job.filePath, modelId, job.language);
  }

  // Copy transcript to documents.content for AI assistant access
  try {
    const transcript = await getVideoTranscript(job.documentId);
    if (transcript?.transcript) {
      await updateDocumentContent(job.documentId, transcript.transcript);
    }
  } catch { /* non-critical */ }
}

/**
 * Show toast notification for transcription completion
 */
function showCompletionToast(documentId: string, provider: VideoTranscriptionJobProvider, success: boolean) {
  const title = documentTitles.get(documentId) || 'Video';
  const providerName = providerDisplayName(provider);
  
  if (success) {
    useToastStore.getState().addToast({
      type: ToastType.Success,
      title: 'Transcription Complete',
      message: `"${title}" has been transcribed using ${providerName}`,
      duration: 8000,
      action: openDocumentCallback ? {
        label: 'Open Document',
        onClick: () => openDocumentCallback!(documentId),
      } : undefined,
    });
  } else {
    useToastStore.getState().addToast({
      type: ToastType.Error,
      title: 'Transcription Failed',
      message: `"${title}" could not be transcribed using ${providerName}`,
      duration: 8000,
    });
  }
  
  documentTitles.delete(documentId);
}

async function processNext() {
  const job = queue.shift();
  if (!job) {
    isProcessing = false;
    return;
  }

  if (shouldDelayForPlayback()) {
    queue.unshift(job);
    isProcessing = false;
    schedule(() => kickQueue());
    return;
  }

  notify(job.documentId, "processing");

  try {
    const provider = job.provider;
    if (provider === "cloud") {
      await processWithCloudService(job);
    } else {
      await processWithLocalWhisper(job);
    }
    
    notify(job.documentId, "completed");
    showCompletionToast(job.documentId, job.provider, true);
  } catch (error) {
    console.error("Transcription failed:", error);
    // Capture the error message for display
    const errorMessage = error instanceof Error ? error.message : String(error);
    errorByDocument.set(job.documentId, errorMessage);
    
    // Only set to failed if not already set to a specific error state
    const currentStatus = statusByDocument.get(job.documentId);
    if (currentStatus === "processing") {
      notify(job.documentId, "failed");
      showCompletionToast(job.documentId, job.provider, false);
    }
  } finally {
    isProcessing = false;
    if (queue.length > 0) {
      schedule(() => {
        isProcessing = true;
        void processNext();
      });
    }
  }
}

function kickQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  schedule(() => void processNext());
}

export async function enqueueVideoTranscription(request: VideoTranscriptionRequest) {
  const provider = request.provider ?? getProvider();
  
  // For local transcription, Tauri is required
  if (provider === 'local' && !isTauri()) return;
  
  if (!isTauri()) return;
  
  if (provider === 'local') {
    const modelId = await resolveModelId(request.modelId);
    if (!modelId) {
      notify(request.documentId, "needs-model");
      return;
    }
  } else if (provider === "cloud") {
    // Cloud path uses TranscriptionService (OpenRouter default, legacy Groq fallback).
  }
  
  const settings = useSettingsStore.getState().settings.audioTranscription;
  
  // Clear any previous error for this document
  errorByDocument.delete(request.documentId);
  
  // Store document title for notifications
  if (request.documentTitle) {
    documentTitles.set(request.documentId, request.documentTitle);
  }
  
  queue.push({
    documentId: request.documentId,
    filePath: request.filePath,
    documentTitle: request.documentTitle,
    provider,
    modelId: request.modelId,
    language: request.language || settings.language || 'en',
  });
  
  notify(request.documentId, "queued");
  
  // Show initial notification that transcription is queued
  const title = request.documentTitle || 'Video';
  const providerName = providerDisplayName(provider);
  useToastStore.getState().addToast({
    type: ToastType.Info,
    title: 'Transcription Queued',
    message: `"${title}" will be transcribed using ${providerName} in the background`,
    duration: 5000,
  });
  
  kickQueue();
}

export function setVideoPlaybackActive(documentId: string, active: boolean) {
  if (!documentId) return;
  if (active) {
    activePlaybackDocuments.add(documentId);
  } else {
    activePlaybackDocuments.delete(documentId);
  }
  if (!active) {
    kickQueue();
  }
}

export function getVideoTranscriptionStatus(documentId: string): VideoTranscriptionStatus | null {
  return statusByDocument.get(documentId) ?? null;
}

export function subscribeVideoTranscriptionStatus(
  documentId: string,
  listener: StatusListener
): () => void {
  const listeners = listenersByDocument.get(documentId) ?? new Set();
  listeners.add(listener);
  listenersByDocument.set(documentId, listeners);
  return () => {
    const current = listenersByDocument.get(documentId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByDocument.delete(documentId);
    }
  };
}

/**
 * Get the last error message for a document's transcription
 */
export function getTranscriptionError(documentId: string): string | null {
  return errorByDocument.get(documentId) ?? null;
}

/**
 * Retry a failed transcription job
 */
export async function retryVideoTranscription(documentId: string) {
  const currentStatus = statusByDocument.get(documentId);
  if (currentStatus === 'failed' || currentStatus === 'needs-api-key' || currentStatus === 'file-too-large') {
    // Clear the status and error to allow retry
    statusByDocument.delete(documentId);
    errorByDocument.delete(documentId);
  }
}

/**
 * Get the current transcription provider
 */
export function getTranscriptionProvider(): VideoTranscriptionJobProvider {
  return getProvider();
}

/**
 * Check if transcription is available (based on provider and configuration)
 */
export function isTranscriptionAvailable(): boolean {
  const provider = getProvider();

  if (provider === "local") {
    return isTauri();
  }

  return isTauri();
}
