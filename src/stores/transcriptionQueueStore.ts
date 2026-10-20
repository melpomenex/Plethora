import { create } from "zustand";
import { listen, isTauri } from "../lib/tauri";
import { useToastStore, ToastType } from "../components/common/Toast";
import {
  getTranscriptionQueue,
  cancelTranscriptionJob,
  retryTranscriptionJob,
  prioritizeTranscriptionJob,
  clearTranscriptionQueue,
  removeTranscriptionEntry,
  TranscriptionQueueEntryWithDoc,
  TranscriptSegment,
} from "../api/transcription";

export interface SessionProgressPayload {
  jobId?: string;
  sessionId?: string;
  transcriptRevision?: number;
  stage?: string;
  progress: number;
  processedDurationMs?: number;
  totalDurationMs?: number;
  committedSegments?: number;
  provider?: string;
  cancelEpoch?: number;
}

interface TranscriptionQueueState {
  entries: TranscriptionQueueEntryWithDoc[];
  activeProgress: number;
  activeSegments: number;
  activePhase: string | null;
  sessionProgress: Record<string, SessionProgressPayload>;
  isLoading: boolean;
  /** Human-readable notice when a job fell back from an accelerator to CPU. */
  backendFallbackNotice: string | null;

  fetchQueue: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  prioritize: (id: string) => Promise<void>;
  clearByStatus: (statuses: string[]) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  getEntryForDocument: (documentId: string) => TranscriptionQueueEntryWithDoc | undefined;
  updateSessionProgress: (payload: SessionProgressPayload) => void;
  getSessionProgress: (sessionIdOrJobId: string) => SessionProgressPayload | undefined;
}

export const useTranscriptionQueueStore = create<TranscriptionQueueState>((set, get) => ({
  entries: [],
  activeProgress: 0,
  activeSegments: 0,
  activePhase: null,
  sessionProgress: {},
  isLoading: false,
  backendFallbackNotice: null,

  fetchQueue: async () => {
    set({ isLoading: true });
    try {
      const entries = await getTranscriptionQueue();
      set({ entries });
    } catch (e) {
      console.warn("[TranscriptionQueueStore] Failed to fetch queue:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  cancel: async (id: string) => {
    await cancelTranscriptionJob(id);
    await get().fetchQueue();
  },

  retry: async (id: string) => {
    await retryTranscriptionJob(id);
    await get().fetchQueue();
  },

  prioritize: async (id: string) => {
    await prioritizeTranscriptionJob(id);
    await get().fetchQueue();
  },

  clearByStatus: async (statuses: string[]) => {
    await clearTranscriptionQueue(statuses);
    await get().fetchQueue();
  },

  removeEntry: async (id: string) => {
    await removeTranscriptionEntry(id);
    await get().fetchQueue();
  },

  getEntryForDocument: (documentId: string) => {
    return get().entries.find((e) => e.documentId === documentId);
  },

  updateSessionProgress: (payload: SessionProgressPayload) => {
    set((state) => {
      const nextSessionProgress = { ...state.sessionProgress };
      if (payload.sessionId) {
        nextSessionProgress[payload.sessionId] = payload;
      }
      if (payload.jobId) {
        nextSessionProgress[payload.jobId] = payload;
      }
      return {
        activeProgress: payload.progress,
        sessionProgress: nextSessionProgress,
      };
    });
  },

  getSessionProgress: (sessionIdOrJobId: string) => {
    return get().sessionProgress[sessionIdOrJobId];
  },
}));

if (isTauri()) {
  const queueListeners: Promise<() => void>[] = [];

  function safeListen<T>(event: string, handler: (event: { payload: T }) => void) {
    queueListeners.push(
      listen(event, handler).catch((err) => {
        console.warn(`[TranscriptionQueueStore] Failed to listen to "${event}":`, err);
        return () => {};
      })
    );
  }

  safeListen<void>("transcription://queue-updated", () => {
    useTranscriptionQueueStore.getState().fetchQueue();
  });

  safeListen<SessionProgressPayload>("transcription://progress", (event) => {
    const payload = event.payload;
    if (payload && typeof payload.progress === "number") {
      useTranscriptionQueueStore.getState().updateSessionProgress(payload);
    }
  });

  safeListen<TranscriptSegment>("transcription://segment", () => {
    const state = useTranscriptionQueueStore.getState();
    useTranscriptionQueueStore.setState({ activeSegments: state.activeSegments + 1 });
  });

  safeListen<{ phase: string }>("transcription://phase", (event) => {
    useTranscriptionQueueStore.setState({ activePhase: event.payload.phase });
  });

  // Non-modal notice when an accelerator run fails mid-job and the engine
  // seamlessly continues on CPU (local stays local — never a cloud fallback).
  safeListen<{ from: string; to: string; message: string }>(
    "transcription://backend-fallback",
    (event) => {
      const detail = event.payload?.message ?? "GPU unavailable — continuing on CPU";
      useTranscriptionQueueStore.setState({ backendFallbackNotice: detail });
      useToastStore.getState().addToast({
        type: ToastType.Warning,
        title: "GPU transcription unavailable",
        message: detail,
        duration: 8000,
      });
    }
  );

  safeListen<void>("transcription://idle", () => {
    useTranscriptionQueueStore.setState({ activeProgress: 0, activeSegments: 0, activePhase: null });
  });

  (globalThis as any).__transcriptionQueueListeners = queueListeners;
}
