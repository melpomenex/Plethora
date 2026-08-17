import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ConnectionSuggestion } from '../types/connections';

export interface ConnectionsStoreState {
  suggestions: ConnectionSuggestion[];
  dismissedFingerprints: string[];

  // Actions
  addSuggestions: (newSuggestions: ConnectionSuggestion[]) => void;
  acceptConnection: (id: string) => void;
  dismissConnection: (id: string) => void;
  getSuggestionsForDocument: (documentId: string) => ConnectionSuggestion[];
  clearAll: () => void;
}

export const useConnectionsStore = create<ConnectionsStoreState>()(
  persist(
    (set, get) => ({
      suggestions: [],
      dismissedFingerprints: [],

      addSuggestions: (newSuggestions) => {
        const { suggestions, dismissedFingerprints } = get();
        const existingIds = new Set(suggestions.map((s) => s.id));
        const dismissedSet = new Set(dismissedFingerprints);

        const filtered = newSuggestions.filter((item) => {
          if (existingIds.has(item.id)) return false;
          const fingerprint = `${item.leftDocumentId}:${item.rightCitation.documentId}:${item.relation}`;
          if (dismissedSet.has(fingerprint)) return false;
          return true;
        });

        if (filtered.length > 0) {
          // Keep store bounded to 500 recent suggestions
          const combined = [...filtered, ...suggestions].slice(0, 500);
          set({ suggestions: combined });
        }
      },

      acceptConnection: (id: string) => {
        set({
          suggestions: get().suggestions.map((s) =>
            s.id === id ? { ...s, status: 'accepted' as const } : s
          ),
        });
      },

      dismissConnection: (id: string) => {
        const item = get().suggestions.find((s) => s.id === id);
        if (!item) return;

        const fingerprint = `${item.leftDocumentId}:${item.rightCitation.documentId}:${item.relation}`;
        set({
          suggestions: get().suggestions.filter((s) => s.id !== id),
          dismissedFingerprints: [...get().dismissedFingerprints, fingerprint].slice(-1000),
        });
      },

      getSuggestionsForDocument: (documentId: string) => {
        return get().suggestions.filter(
          (s) => s.leftDocumentId === documentId && s.status === 'pending'
        );
      },

      clearAll: () => {
        set({ suggestions: [], dismissedFingerprints: [] });
      },
    }),
    {
      name: 'plethora-connections',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        suggestions: state.suggestions,
        dismissedFingerprints: state.dismissedFingerprints,
      }),
    }
  )
);
