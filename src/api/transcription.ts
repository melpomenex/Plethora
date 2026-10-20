import { invokeCommand, isTauri } from "../lib/tauri";
import { ensureCloudAiDisclosure } from "../lib/privacy/cloudAiDisclosure";
import type { SessionExecutor } from "../services/transcription/types";

// Canonical session readers use optional timing; the legacy player DTO below
// intentionally remains timed-only for existing audiobook/podcast consumers.
export type { SessionTranscriptSegment, SessionTranscriptTiming } from "../types/recordingSession";

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  url: string;
  sha256: string;
  size_bytes: number;
  installed: boolean;
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
  words_json?: string | null;
}

export interface TranscriptResponse {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  segments: TranscriptSegment[];
}

// GPU-first local transcription compute diagnostics
// (mirrors src-tauri/src/transcription/compute_backend.rs)

export interface ComputeDeviceInfo {
  id: number;
  name: string;
  vendor: string;
  vram_bytes?: number | null;
  free_vram_bytes?: number | null;
}

export interface ComputeProviderStatus {
  available: boolean;
  runtime_usable: boolean;
  reason_unavailable?: string | null;
}

export interface ComputeDiagnosticsReport {
  hardware: {
    cpu_threads: number;
    devices: ComputeDeviceInfo[];
  };
  runtime: {
    providers: Record<string, ComputeProviderStatus>;
  };
  active_compute_mode: "auto" | "gpu_preferred" | "cpu_only";
  model_compatibilities: {
    model_id: string;
    supported_backends: string[];
    min_vram_bytes?: number | null;
  }[];
  health_degraded_backends: Record<string, string>;
  health_degraded_models: Record<string, Record<string, string>>;
}

export const getTranscriptionComputeDiagnostics = (): Promise<ComputeDiagnosticsReport | null> => {
  if (!isTauri()) {
    return Promise.resolve(null);
  }
  return invokeCommand<ComputeDiagnosticsReport>("transcription_compute_diagnostics");
};

export const getTranscriptionProfiles = async (): Promise<ModelProfile[]> => {
  if (isTauri()) {
    try {
      const nativeProfiles = await invokeCommand<ModelProfile[]>("get_transcription_profiles");
      return nativeProfiles;
    } catch (err) {
      console.error("Failed to fetch native transcription profiles:", err);
      return [];
    }
  }

  return [];
};

export const downloadTranscriptionModel = async (id: string): Promise<void> => {
  const { useTranscriptionStore } = await import("../stores/useTranscriptionStore");
  useTranscriptionStore.getState().setStatus("downloading");
  useTranscriptionStore.getState().setDownloadProgress(id, 0);

  try {
    if (!isTauri()) {
      throw new Error("Transcription models require the desktop app");
    }
    await invokeCommand("download_transcription_model", { id });
    await useTranscriptionStore.getState().fetchProfiles();
    const installed = useTranscriptionStore
      .getState()
      .profiles
      .find((profile) => profile.id === id)?.installed;
    if (!installed) {
      throw new Error(`Model "${id}" downloaded but failed installation verification.`);
    }
    useTranscriptionStore.getState().setStatus("idle");
    useTranscriptionStore.getState().setDownloadProgress(id, 0);
  } catch (err) {
    useTranscriptionStore.getState().setStatus("idle");
    useTranscriptionStore.getState().setDownloadProgress(id, 0);
    throw err;
  }
};

export const deleteTranscriptionModel = async (id: string): Promise<void> => {
  if (!isTauri()) {
    throw new Error("Transcription models require the desktop app");
  }
  await invokeCommand("delete_transcription_model", { id });
};

export const startTranscription = (
  bookId: string,
  chapterId: string,
  audioPath: string,
  modelId: string,
  language: string
): Promise<void> => {
  if (!isTauri()) {
    return Promise.reject(new Error("Transcription is only available in the Tauri desktop app"));
  }
  return invokeCommand("start_transcription", {
    bookId,
    chapterId,
    audioPath,
    modelId,
    language,
  });
};

export const getTranscript = (
  bookId: string,
  chapterId: string
): Promise<TranscriptResponse | null> => {
  if (!isTauri()) {
    // Web/PWA: return empty transcript
    return Promise.resolve(null);
  }
  return invokeCommand("get_transcript", { bookId, chapterId });
};

export const saveTranscript = (
  bookId: string,
  chapterId: string,
  modelUsed: string,
  language: string,
  status: string,
  segments: TranscriptSegment[]
): Promise<void> => {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return invokeCommand("save_transcript", {
    bookId,
    chapterId,
    modelUsed,
    language,
    status,
    segments,
  });
};

// Auto-transcription queue types
export type TranscriptionJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface TranscriptionQueueEntry {
  id: string;
  documentId: string;
  chapterId: string | null;
  audioPath: string;
  provider: string;
  modelId: string;
  language: string;
  status: TranscriptionJobStatus;
  errorMessage: string | null;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  progress: number;
  processedDurationMs?: number;
  totalDurationMs?: number | null;
  transcriptionMode?: string;
  sessionId?: string | null;
  assetId?: string | null;
  transcriptRevision?: number;
  executor?: SessionExecutor | null;
  planJson?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  cancelEpoch?: number;
  blockedReason?: string | null;
  authorizationJson?: string | null;
}

export interface TranscriptionQueueEntryWithDoc extends TranscriptionQueueEntry {
  documentTitle: string;
}

export const enqueueAutoTranscription = (
  documentId: string,
  audioPath: string,
  provider: string,
  modelId: string,
  language: string,
  priority?: number,
  chapterId?: string,
  transcriptionMode?: string,
): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Transcription requires desktop app"));
  // Change C §4.3: cloud transcription providers (e.g. groq cluster routing)
  // require the one-time cloud-AI disclosure before audio leaves the device.
  // Local whisper.cpp profiles are exempt. Because this is a fire-and-forget
  // queue enqueue, a missing/declined disclosure rejects the enqueue.
  const gate =
    provider === "local" || provider === "apple"
      ? Promise.resolve(true)
      : ensureCloudAiDisclosure({ featureClass: "transcription", provider });
  return gate.then((disclosed) => {
    if (!disclosed) {
      throw new Error("Cloud transcription disclosure declined — audio was not sent.");
    }
    return invokeCommand<void>("enqueue_auto_transcription", {
      documentId, audioPath, provider, modelId, language, priority, chapterId, transcriptionMode,
    });
  });
};

export const getTranscriptionQueue = (): Promise<TranscriptionQueueEntryWithDoc[]> => {
  if (!isTauri()) return Promise.resolve([]);
  return invokeCommand("get_transcription_queue");
};

export const cancelTranscriptionJob = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Transcription requires desktop app"));
  return invokeCommand("cancel_transcription_job", { id });
};

export const retryTranscriptionJob = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Transcription requires desktop app"));
  return invokeCommand("retry_transcription_job", { id });
};

export const prioritizeTranscriptionJob = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Transcription requires desktop app"));
  return invokeCommand("prioritize_transcription_job", { id });
};

export const getTranscriptionStatus = (documentId: string): Promise<TranscriptionQueueEntry | null> => {
  if (!isTauri()) return Promise.resolve(null);
  return invokeCommand("get_transcription_status", { documentId });
};

export interface EnqueueSessionTranscriptionInput {
  sessionId: string;
  documentId: string;
  assetId?: string;
  audioPath: string;
  transcriptRevision: number;
  provider: string;
  modelId: string;
  language: string;
  executor: SessionExecutor;
  planJson: string;
  authorizationJson?: string;
  priority?: number;
}

export const enqueueSessionTranscription = (
  input: EnqueueSessionTranscriptionInput,
): Promise<TranscriptionQueueEntry> => {
  if (!isTauri()) return Promise.reject(new Error("Session transcription queue requires desktop app"));
  return invokeCommand<TranscriptionQueueEntry>("enqueue_session_transcription", { input });
};

export const claimTranscriptionJob = (
  workerId: string,
  leaseDurationMs: number,
  supportedExecutors: string[],
): Promise<TranscriptionQueueEntry | null> => {
  if (!isTauri()) return Promise.resolve(null);
  return invokeCommand<TranscriptionQueueEntry | null>("claim_transcription_job", {
    workerId,
    leaseDurationMs,
    supportedExecutors,
  });
};

export const renewTranscriptionLease = (
  id: string,
  workerId: string,
  leaseDurationMs: number,
  expectedCancelEpoch: number,
): Promise<boolean> => {
  if (!isTauri()) return Promise.resolve(false);
  return invokeCommand<boolean>("renew_transcription_lease", {
    id,
    workerId,
    leaseDurationMs,
    expectedCancelEpoch,
  });
};

export const updateTranscriptionProgressWithLease = (
  id: string,
  workerId: string,
  progress: number,
  processedDurationMs?: number,
  totalDurationMs?: number,
  expectedCancelEpoch: number = 0,
): Promise<boolean> => {
  if (!isTauri()) return Promise.resolve(false);
  return invokeCommand<boolean>("update_transcription_progress_with_lease", {
    id,
    workerId,
    progress,
    processedDurationMs,
    totalDurationMs,
    expectedCancelEpoch,
  });
};

export const completeTranscriptionJobWithLease = (
  id: string,
  workerId: string,
  expectedCancelEpoch: number = 0,
): Promise<boolean> => {
  if (!isTauri()) return Promise.resolve(false);
  return invokeCommand<boolean>("complete_transcription_job_with_lease", {
    id,
    workerId,
    expectedCancelEpoch,
  });
};

export const failTranscriptionJobWithLease = (
  id: string,
  workerId: string,
  errorMessage: string,
  expectedCancelEpoch: number = 0,
): Promise<boolean> => {
  if (!isTauri()) return Promise.resolve(false);
  return invokeCommand<boolean>("fail_transcription_job_with_lease", {
    id,
    workerId,
    errorMessage,
    expectedCancelEpoch,
  });
};

export const getSessionTranscriptionStatus = (
  sessionId: string,
  revision: number,
): Promise<TranscriptionQueueEntry | null> => {
  if (!isTauri()) return Promise.resolve(null);
  return invokeCommand<TranscriptionQueueEntry | null>("get_session_transcription_status", {
    sessionId,
    revision,
  });
};

export interface SkippedEntry {
  title: string;
  reason: string;
}

export interface EnqueueAllResult {
  enqueued: number;
  skipped: SkippedEntry[];
}

export const enqueueAllUntranscribed = (
  provider: string,
  modelId: string,
  language: string,
): Promise<EnqueueAllResult> => {
  if (!isTauri()) return Promise.resolve({ enqueued: 0, skipped: [] });
  return invokeCommand("enqueue_all_untranscribed", { provider, modelId, language });
};

export const clearTranscriptionQueue = (statuses: string[]): Promise<number> => {
  if (!isTauri()) return Promise.resolve(0);
  return invokeCommand("clear_transcription_queue", { statuses });
};

export const removeTranscriptionEntry = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.resolve();
  return invokeCommand("remove_transcription_entry", { id });
};

export const isLocalNemotronInstalled = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    return await invokeCommand<boolean>("is_local_nemotron_installed");
  } catch (err) {
    console.error("Failed to check local Nemotron install state:", err);
    return false;
  }
};

export const transcribeLocalNemotron = (
  audioPath: string,
  language: string,
): Promise<TranscriptResponse> => {
  if (!isTauri()) {
    return Promise.reject(new Error("Local Nemotron transcription requires the native app"));
  }
  return invokeCommand<TranscriptResponse>("transcribe_local_nemotron", {
    audioPath,
    language,
  });
};

export const isLocalWhistleInstalled = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    return await invokeCommand<boolean>("is_local_whistle_installed");
  } catch (err) {
    console.error("Failed to check local Whistle install state:", err);
    return false;
  }
};

export const transcribeLocalWhistle = (
  audioPath: string,
  language: string,
): Promise<TranscriptResponse> => {
  if (!isTauri()) {
    return Promise.reject(new Error("Local Cactus Whistle transcription requires the native app"));
  }
  return invokeCommand<TranscriptResponse>("transcribe_local_whistle", {
    audioPath,
    language,
  });
};

