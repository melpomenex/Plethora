import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RemoteInboxItem, InboxItemStatus } from '../types/inbox';

export interface InboxStoreState {
  items: RemoteInboxItem[];
  isLoading: boolean;
  error: string | null;

  // Actions
  addItem: (item: Omit<RemoteInboxItem, 'id' | 'createdAt' | 'status'>) => string;
  updateStatus: (id: string, status: InboxItemStatus) => void;
  acceptItem: (id: string) => void;
  dismissItem: (id: string) => void;
  removeItem: (id: string) => void;
  clearInbox: () => void;
}

export const useInboxStore = create<InboxStoreState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,

      addItem: (item) => {
        const id = `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newItem: RemoteInboxItem = {
          ...item,
          id,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        set({ items: [newItem, ...get().items] });
        return id;
      },

      updateStatus: (id, status) => {
        set({
          items: get().items.map((i) => (i.id === id ? { ...i, status } : i)),
        });
      },

      acceptItem: (id) => {
        get().updateStatus(id, 'accepted');
      },

      dismissItem: (id) => {
        get().updateStatus(id, 'dismissed');
      },

      removeItem: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
      },

      clearInbox: () => {
        set({ items: [] });
      },
    }),
    {
      name: 'plethora-remote-inbox',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
      }),
    }
  )
);
