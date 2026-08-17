import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CardOptimizationProposal } from '../types/cardOptimizer';

export interface CardOptimizerStoreState {
  proposals: CardOptimizationProposal[];
  isLoading: boolean;

  // Actions
  addProposal: (proposal: Omit<CardOptimizationProposal, 'id' | 'createdAt' | 'status'>) => string;
  acceptProposal: (id: string) => void;
  dismissProposal: (id: string) => void;
  getPendingProposals: () => CardOptimizationProposal[];
  getProposalsForDeck: (deckId: string) => CardOptimizationProposal[];
  clearProposals: () => void;
}

export const useCardOptimizerStore = create<CardOptimizerStoreState>()(
  persist(
    (set, get) => ({
      proposals: [],
      isLoading: false,

      addProposal: (proposal) => {
        const id = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newProposal: CardOptimizationProposal = {
          ...proposal,
          id,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        set({ proposals: [newProposal, ...get().proposals] });
        return id;
      },

      acceptProposal: (id) => {
        set({
          proposals: get().proposals.map((p) =>
            p.id === id ? { ...p, status: 'accepted' as const } : p
          ),
        });
      },

      dismissProposal: (id) => {
        set({
          proposals: get().proposals.map((p) =>
            p.id === id ? { ...p, status: 'dismissed' as const } : p
          ),
        });
      },

      getPendingProposals: () => {
        return get().proposals.filter((p) => p.status === 'pending');
      },

      getProposalsForDeck: (deckId) => {
        return get().proposals.filter((p) => p.deckId === deckId && p.status === 'pending');
      },

      clearProposals: () => {
        set({ proposals: [] });
      },
    }),
    {
      name: 'plethora-card-optimizer',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        proposals: state.proposals,
      }),
    }
  )
);
