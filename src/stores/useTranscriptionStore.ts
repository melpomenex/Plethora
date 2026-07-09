import { create } from "zustand";
import { listen, isTauri } from "../lib/tauri";
import {
  getTranscriptionProfiles,
  getTranscript,
  ModelProfile,
  TranscriptSegment,
} from "../api/transcription";

interface TranscriptionState {
  profiles: ModelProfile[];
  downloadProgress: Record<string, number>;
  transcriptionProgress: number;
  activeSegments: TranscriptSegment[];
  currentStatus: 'idle' | 'processing' | 'downloading';
  activeJob: { bookId: string, chapterId: string } | null;
  
  fetchProfiles: () => Promise<void>;
  loadTranscript: (bookId: string, chapterId: string) => Promise<void>;
  addSegment: (segment: TranscriptSegment) => void;
  addSegments: (segments: TranscriptSegment[]) => void;
  setStatus: (status: 'idle' | 'processing' | 'downloading') => void;
  setDownloadProgress: (id: string, progress: number) => void;
  setTranscriptionProgress: (progress: number) => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  profiles: [],
  downloadProgress: {},
  transcriptionProgress: 0,
  activeSegments: [],
  currentStatus: 'idle',
  activeJob: null,

  fetchProfiles: async () => {
    const profiles = await getTranscriptionProfiles();
    set({ profiles });
  },

  loadTranscript: async (bookId: string, chapterId: string) => {
    const response = await getTranscript(bookId, chapterId);
    if (response) {
      set({ activeSegments: response.segments });
    } else {
      set({ activeSegments: [] });
    }
  },

  addSegment: (segment) => {
    set((state) => ({
      activeSegments: [...state.activeSegments, segment].sort((a, b) => a.start_ms - b.start_ms)
    }));
  },

  // Batched append (Finding G, Part 2/3): the backend emits one
  // `transcription://segments-batch` event per batch instead of one event per
  // segment. Append the whole array in a single set() so we produce ONE new
  // array identity (one re-render) per batch rather than per segment.
  addSegments: (segments) => {
    if (!segments || segments.length === 0) return;
    set((state) => ({
      activeSegments: [...state.activeSegments, ...segments].sort((a, b) => a.start_ms - b.start_ms)
    }));
  },

  setStatus: (status) => set({ currentStatus: status }),
  
  setDownloadProgress: (id, progress) => {
    set((state) => ({
      downloadProgress: { ...state.downloadProgress, [id]: progress }
    }));
  },

  setTranscriptionProgress: (progress) => set({ transcriptionProgress: progress }),
}));

// Setup event listeners (Tauri only - transcription backend events)
// We save unlisten promises so listeners can be properly cleaned up,
// and we wrap each registration to silently handle Tauri v2's
// "listeners[eventId].handlerId" unlisten race condition.
if (isTauri()) {
  const transcriptionListeners: Promise<() => void>[] = [];

  function safeListen<T>(event: string, handler: (event: { payload: T }) => void) {
    transcriptionListeners.push(
      listen(event, handler).catch((err) => {
        console.warn(`[TranscriptionStore] Failed to register listener for "${event}":`, err);
        return () => {};
      })
    );
  }

  safeListen<number>("transcription://progress", (event) => {
    const p = typeof event.payload === 'number' ? event.payload : (event.payload as any).progress ?? 0;
    // Debounce: only write to the store when the INTEGER percent changes. The
    // backend now throttles these (Finding G), but in case multiple sources feed
    // this event, avoid a full set()/re-render for sub-integer deltas.
    const rounded = Math.round(p);
    if (rounded !== useTranscriptionStore.getState().transcriptionProgress) {
      useTranscriptionStore.getState().setTranscriptionProgress(rounded);
    }
  });

  safeListen<{ id: string; progress: number }>("transcription://download-progress", (event) => {
    const { id, progress } = event.payload;
    useTranscriptionStore.getState().setDownloadProgress(id, progress);
    useTranscriptionStore.getState().setStatus('downloading');
  });

  safeListen<void>("transcription://download-complete", () => {
    useTranscriptionStore.getState().setStatus('idle');
  });

  safeListen<{ book_id: string; chapter_id: string }>("transcription://status-change", (event) => {
    const job = event.payload;
    useTranscriptionStore.setState({ activeJob: { bookId: job.book_id, chapterId: job.chapter_id } });
    useTranscriptionStore.getState().setStatus('processing');
  });

  safeListen<TranscriptSegment>("transcription://segment", (event) => {
    useTranscriptionStore.getState().addSegment(event.payload);
  });

  // Batched segment events (Finding G, Part 2): one event per batch of segments.
  safeListen<TranscriptSegment[]>("transcription://segments-batch", (event) => {
    useTranscriptionStore.getState().addSegments(event.payload);
  });

  safeListen<void>("transcription://idle", () => {
    useTranscriptionStore.getState().setStatus('idle');
    useTranscriptionStore.setState({ activeJob: null });
  });

  // Expose cleanup for hot-reload / app shutdown
  (globalThis as any).__transcriptionListeners = transcriptionListeners;
}
