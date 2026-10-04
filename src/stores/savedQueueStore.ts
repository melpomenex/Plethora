import { create } from 'zustand';
import {
  getSavedQueues,
  createSavedQueue as apiCreateSavedQueue,
  updateSavedQueue as apiUpdateSavedQueue,
  deleteSavedQueue as apiDeleteSavedQueue,
  getActiveSavedQueueId,
  setActiveSavedQueueId as apiSetActiveSavedQueueId,
} from '../api/savedQueues';
import type {
  SavedQueue,
  CreateSavedQueueInput,
  UpdateSavedQueueInput,
} from '../types/savedQueue';

export interface SavedQueueState {
  savedQueues: SavedQueue[];
  activeQueueId: string | null;
  isLoading: boolean;
  error: string | null;

  loadSavedQueues: (collectionId?: string | null) => Promise<void>;
  createSavedQueue: (input: CreateSavedQueueInput) => Promise<SavedQueue>;
  updateSavedQueue: (id: string, input: UpdateSavedQueueInput) => Promise<SavedQueue>;
  deleteSavedQueue: (id: string) => Promise<void>;
  activateSavedQueue: (id: string | null) => Promise<void>;
  getActiveSavedQueue: () => SavedQueue | null;
}

export const useSavedQueueStore = create<SavedQueueState>()((set, get) => ({
  savedQueues: [],
  activeQueueId: null,
  isLoading: false,
  error: null,

  loadSavedQueues: async (collectionId?: string | null) => {
    set({ isLoading: true, error: null });
    try {
      const [queues, storedActiveId] = await Promise.all([
        getSavedQueues(collectionId),
        getActiveSavedQueueId(),
      ]);

      let activeId = storedActiveId;
      if (!activeId || !queues.some((q) => q.id === activeId)) {
        const defaultQueue = queues.find((q) => q.isDefault);
        activeId = defaultQueue ? defaultQueue.id : null;
      }

      set({
        savedQueues: queues,
        activeQueueId: activeId,
        isLoading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
      });
    }
  },

  createSavedQueue: async (input: CreateSavedQueueInput) => {
    try {
      const created = await apiCreateSavedQueue(input);
      set((state) => ({
        savedQueues: [...state.savedQueues, created],
        activeQueueId: created.id,
      }));
      await apiSetActiveSavedQueueId(created.id);
      return created;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  updateSavedQueue: async (id: string, input: UpdateSavedQueueInput) => {
    try {
      const updated = await apiUpdateSavedQueue(id, input);
      set((state) => ({
        savedQueues: state.savedQueues.map((q) => {
          if (q.id === id) return updated;
          if (updated.isDefault && q.isDefault) return { ...q, isDefault: false };
          return q;
        }),
      }));
      return updated;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  deleteSavedQueue: async (id: string) => {
    try {
      await apiDeleteSavedQueue(id);
      set((state) => {
        const remaining = state.savedQueues.filter((q) => q.id !== id);
        let nextActiveId = state.activeQueueId;
        if (nextActiveId === id) {
          const defaultQueue = remaining.find((q) => q.isDefault);
          nextActiveId = defaultQueue ? defaultQueue.id : null;
        }
        return {
          savedQueues: remaining,
          activeQueueId: nextActiveId,
        };
      });
      const newActive = get().activeQueueId;
      await apiSetActiveSavedQueueId(newActive);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  activateSavedQueue: async (id: string | null) => {
    set({ activeQueueId: id });
    try {
      await apiSetActiveSavedQueueId(id);
    } catch (e) {
      console.error('Failed to persist active saved queue id', e);
    }
  },

  getActiveSavedQueue: () => {
    const { savedQueues, activeQueueId } = get();
    if (!activeQueueId) return null;
    return savedQueues.find((q) => q.id === activeQueueId) ?? null;
  },
}));
