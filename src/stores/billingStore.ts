import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  BillingProvider,
  MockBillingProvider,
  ProductInfo,
  SubscriptionState,
} from '../lib/billing/types';
import { useEntitlementStore } from './entitlementStore';

export interface BillingStoreState {
  products: ProductInfo[];
  subscription: SubscriptionState;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  purchase: (productId: string) => Promise<boolean>;
  restore: () => Promise<boolean>;
  setProvider: (provider: BillingProvider) => void;
}

let activeProvider: BillingProvider = new MockBillingProvider();

export const useBillingStore = create<BillingStoreState>()(
  persist(
    (set, get) => ({
      products: [],
      subscription: {
        status: 'free',
        provider: 'mock',
      },
      loading: false,
      error: null,

      init: async () => {
        set({ loading: true, error: null });
        try {
          const products = await activeProvider.getProducts();
          const subscription = await activeProvider.getSubscription();
          set({ products, subscription, loading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        }
      },

      purchase: async (productId: string) => {
        set({ loading: true, error: null });
        try {
          const res = await activeProvider.purchase(productId);
          if (res.success) {
            const subscription = await activeProvider.getSubscription();
            set({ subscription, loading: false });

            // Refresh entitlements on successful purchase
            void useEntitlementStore.getState().refresh();
            return true;
          } else {
            set({ error: res.error || 'Purchase was not completed', loading: false });
            return false;
          }
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Purchase failed',
            loading: false,
          });
          return false;
        }
      },

      restore: async () => {
        set({ loading: true, error: null });
        try {
          const res = await activeProvider.restorePurchases();
          if (res.restored && res.subscription) {
            set({ subscription: res.subscription, loading: false });
            void useEntitlementStore.getState().refresh();
            return true;
          }
          set({ loading: false });
          return false;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Restore failed',
            loading: false,
          });
          return false;
        }
      },

      setProvider: (provider: BillingProvider) => {
        activeProvider = provider;
        void get().init();
      },
    }),
    {
      name: 'plethora-billing',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        subscription: state.subscription,
      }),
    }
  )
);
