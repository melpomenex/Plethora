import { create } from 'zustand';
import type { PaywallTriggerContext, TrialState } from '../types/paywall';

export interface PaywallStoreState {
  isOpen: boolean;
  activeContext: PaywallTriggerContext | null;
  trial: TrialState;
  dismissedHintIds: string[];

  // Actions
  openPaywall: (context: PaywallTriggerContext) => void;
  closePaywall: () => void;
  startTrial: () => void;
  dismissHint: (hintId: string) => void;
}

export const usePaywallStore = create<PaywallStoreState>((set, get) => ({
  isOpen: false,
  activeContext: null,
  trial: {
    isActive: false,
    daysRemaining: 14,
  },
  dismissedHintIds: [],

  openPaywall: (context) => {
    set({ isOpen: true, activeContext: context });
  },

  closePaywall: () => {
    set({ isOpen: false, activeContext: null });
  },

  startTrial: () => {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    set({
      trial: {
        isActive: true,
        daysRemaining: 14,
        expiresAt,
      },
    });
  },

  dismissHint: (hintId) => {
    set({
      dismissedHintIds: [...get().dismissedHintIds, hintId],
    });
  },
}));
