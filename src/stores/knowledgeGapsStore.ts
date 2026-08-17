import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { KnowledgeGap } from '../types/knowledgeGaps';

export interface KnowledgeGapsStoreState {
  gaps: KnowledgeGap[];
  isLoading: boolean;

  // Actions
  recordGap: (gap: Omit<KnowledgeGap, 'id' | 'detectedAt' | 'status'>) => string;
  dismissGap: (id: string) => void;
  resolveGap: (id: string) => void;
  getActiveGaps: () => KnowledgeGap[];
  getActiveGapsForConcept: (conceptId: string) => KnowledgeGap[];
  clearGaps: () => void;
}

export const useKnowledgeGapsStore = create<KnowledgeGapsStoreState>()(
  persist(
    (set, get) => ({
      gaps: [],
      isLoading: false,

      recordGap: (gap) => {
        const id = `gap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newGap: KnowledgeGap = {
          ...gap,
          id,
          status: 'active',
          detectedAt: new Date().toISOString(),
        };

        // Replace existing active gap for same concept & kind or append
        const filtered = get().gaps.filter(
          (g) => !(g.conceptName.toLowerCase() === gap.conceptName.toLowerCase() && g.kind === gap.kind && g.status === 'active')
        );

        set({ gaps: [newGap, ...filtered] });
        return id;
      },

      dismissGap: (id) => {
        set({
          gaps: get().gaps.map((g) => (g.id === id ? { ...g, status: 'dismissed' as const } : g)),
        });
      },

      resolveGap: (id) => {
        set({
          gaps: get().gaps.map((g) => (g.id === id ? { ...g, status: 'resolved' as const } : g)),
        });
      },

      getActiveGaps: () => {
        return get().gaps.filter((g) => g.status === 'active');
      },

      getActiveGapsForConcept: (conceptId) => {
        return get().gaps.filter((g) => g.conceptId === conceptId && g.status === 'active');
      },

      clearGaps: () => {
        set({ gaps: [] });
      },
    }),
    {
      name: 'plethora-knowledge-gaps',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        gaps: state.gaps,
      }),
    }
  )
);
