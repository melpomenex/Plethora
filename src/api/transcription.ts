import { invokeCommand, isTauri } from "../lib/tauri";
import { ensureCloudAiDisclosure } from "../lib/privacy/cloudAiDisclosure";

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
}

export interface TranscriptResponse {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  segments: TranscriptSegment[];
}

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
): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Transcription requires desktop app"));
  // Change C §4.3: cloud transcription providers (e.g. groq cluster routing)
  // require the one-time cloud-AI disclosure before audio leaves the device.
  // Local whisper.cpp profiles are exempt. Because this is a fire-and-forget
  // queue enqueue, a missing/declined disclosure rejects the enqueue.
  const gate =
    provider === "local"
      ? Promise.resolve(true)
      : ensureCloudAiDisclosure({ featureClass: "transcription", provider });
  return gate.then((disclosed) => {
    if (!disclosed) {
      throw new Error("Cloud transcription disclosure declined — audio was not sent.");
    }
    return invokeCommand<void>("enqueue_auto_transcription", {
      documentId, audioPath, provider, modelId, language, priority, chapterId,
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
