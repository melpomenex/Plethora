import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface ListeningQueueItem {
  id: string;
  documentId: string;
  title: string;
  chapterTitle?: string;
  chapterIndex?: number;
  audioUrl?: string;
  currentPositionSeconds: number;
  durationSeconds: number;
  status: 'queued' | 'playing' | 'completed';
  enqueuedAt: string;
}

export interface ListeningQueueStoreState {
  items: ListeningQueueItem[];
  currentItemId: string | null;
  playbackSpeed: number;

  // Actions
  enqueue: (item: Omit<ListeningQueueItem, 'id' | 'enqueuedAt' | 'status' | 'currentPositionSeconds'>) => string;
  dequeue: (id: string) => void;
  setCurrentPlaying: (id: string | null) => void;
  updatePosition: (id: string, positionSeconds: number) => void;
  setSpeed: (speed: number) => void;
  clearQueue: () => void;
  /**
   * Controller projection: the audio owner supplies identity/order. This keeps
   * the persisted item shape without becoming a second playback authority.
   */
  replaceProjection: (
    items: ListeningQueueItem[],
    currentItemId: string | null,
    playbackSpeed: number,
  ) => void;
}

export const useListeningQueueStore = create<ListeningQueueStoreState>()(
  persist(
    (set, get) => ({
      items: [],
      currentItemId: null,
      playbackSpeed: 1.0,

      enqueue: (item) => {
        const id = `listen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newItem: ListeningQueueItem = {
          ...item,
          id,
          currentPositionSeconds: 0,
          status: 'queued',
          enqueuedAt: new Date().toISOString(),
        };

        const updated = [...get().items, newItem];
        set({ items: updated });
        if (!get().currentItemId) {
          set({ currentItemId: id });
        }
        return id;
      },

      dequeue: (id) => {
        const { items, currentItemId } = get();
        const nextItems = items.filter((item) => item.id !== id);
        let nextCurrent = currentItemId;
        if (currentItemId === id) {
          nextCurrent = nextItems.length > 0 ? nextItems[0].id : null;
        }
        set({ items: nextItems, currentItemId: nextCurrent });
      },

      setCurrentPlaying: (id) => {
        set({
          currentItemId: id,
          items: get().items.map((i) => ({
            ...i,
            status: i.id === id ? ('playing' as const) : i.status === 'playing' ? ('queued' as const) : i.status,
          })),
        });
      },

      updatePosition: (id, positionSeconds) => {
        set({
          items: get().items.map((i) =>
            i.id === id ? { ...i, currentPositionSeconds: positionSeconds } : i
          ),
        });
      },

      setSpeed: (speed) => {
        set({ playbackSpeed: Math.max(0.5, Math.min(3.0, speed)) });
      },

      clearQueue: () => {
        set({ items: [], currentItemId: null });
      },

      replaceProjection: (items, currentItemId, playbackSpeed) => {
        const state = get();
        const next = items.slice(0, 128);
        if (
          state.currentItemId === currentItemId &&
          state.playbackSpeed === playbackSpeed &&
          JSON.stringify(state.items) === JSON.stringify(next)
        ) {
          return;
        }
        set({ items: next, currentItemId, playbackSpeed });
      },
    }),
    {
      name: 'plethora-listening-queue',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        currentItemId: state.currentItemId,
        playbackSpeed: state.playbackSpeed,
      }),
    }
  )
);
