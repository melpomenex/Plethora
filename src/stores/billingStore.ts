import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  BillingProvider,
  MockBillingProvider,
  ProductInfo,
  SubscriptionState,
} from '../lib/billing/types';
import {
  AppStoreBillingProvider,
  VerifiedStoreTransaction,
} from '../lib/billing/appStoreProvider';
import {
  PlayBillingProvider,
  PlayPurchaseRecord,
} from '../lib/billing/playBillingProvider';
import {
  selectBillingProvider,
  storeProfileInvariantViolation,
} from '../lib/billing/providerSelection';
import { useEntitlementStore } from './entitlementStore';

export interface BillingStoreState {
  products: ProductInfo[];
  subscription: SubscriptionState;
  loading: boolean;
  error: string | null;
  /** True when a purchase is awaiting approval (StoreKit ask-to-buy). */
  pendingApproval: boolean;
  /** Dev-only labeling: true when the active provider is the mock. */
  usingMockProvider: boolean;

  // Actions
  init: () => Promise<void>;
  purchase: (productId: string) => Promise<boolean>;
  restore: () => Promise<boolean>;
  setProvider: (provider: BillingProvider) => void;
  /** Open Apple's manage-subscriptions sheet (iOS; no-op elsewhere). */
  manageSubscriptions: () => Promise<void>;
}

let activeProvider: BillingProvider | null = null;

/**
 * Lazily-constructed active provider. The default (pre-init) provider is the
 * dev mock; under the store build profile constructing the mock throws — the
 * mock-firewall invariant is enforced here and again in `init`.
 */
export function getActiveProvider(): BillingProvider {
  if (!activeProvider) {
    activeProvider = new MockBillingProvider();
  }
  return activeProvider;
}

/** Test/development hook: replace the active provider explicitly. */
export function setActiveProviderForTesting(provider: BillingProvider | null): void {
  activeProvider = provider;
}

/** Handle a verified native transaction: reconcile + refresh entitlements. */
function handleVerifiedTransaction(
  transaction: VerifiedStoreTransaction | PlayPurchaseRecord
): void {
  const provider = getActiveProvider();
  if (provider instanceof AppStoreBillingProvider) {
    void provider.reconcileWithServer(transaction as VerifiedStoreTransaction);
  } else if (provider instanceof PlayBillingProvider) {
    const play = transaction as PlayPurchaseRecord;
    if (play.purchaseToken && play.purchaseState === 'purchased') {
      void provider.validatePurchaseToken(play.purchaseToken, play.productId);
    }
  }
  void useEntitlementStore.getState().refresh();
}

/** Load products/subscription from the active provider into the store. */
async function loadFromProvider(set: (partial: Partial<BillingStoreState>) => void): Promise<void> {
  const provider = getActiveProvider();
  const products = await provider.getProducts();
  const subscription = await provider.getSubscription();
  set({ products, subscription, loading: false });
}

export const useBillingStore = create<BillingStoreState>()(
  persist(
    (set) => ({
      products: [],
      subscription: {
        status: 'free',
        provider: 'mock',
      },
      loading: false,
      error: null,
      pendingApproval: false,
      usingMockProvider: false,

      init: async () => {
        set({ loading: true, error: null });
        try {
          // Startup provider selection (tasks §3.4): iOS → native StoreKit 2
          // provider; other platforms → dev-only mock.
          const provider = selectBillingProvider();
          const violation = storeProfileInvariantViolation(provider);
          if (violation) {
            throw new Error(violation);
          }
          activeProvider = provider;
          set({ usingMockProvider: provider.type === 'mock' });

          if (provider instanceof AppStoreBillingProvider) {
            // Relaunch reconciliation: flush queued JWS payloads and arm the
            // native Transaction.updates listener (tasks §4.2).
            await provider.reconcilePending().catch((err) => {
              console.warn('[billing] reconciliation/listener setup failed:', err);
            });
            provider.onTransactionUpdate((update) => {
              if ('unverified' in update && update.unverified) {
                console.warn('[billing] dropped unverified transaction update:', update.reason);
                return;
              }
              handleVerifiedTransaction(update as VerifiedStoreTransaction);
            });
          }

          if (provider instanceof PlayBillingProvider) {
            await provider.reconcilePending().catch((err) => {
              console.warn('[billing] Play reconciliation/listener setup failed:', err);
            });
            provider.onPurchaseUpdate((update) => {
              if ('purchaseToken' in update) {
                handleVerifiedTransaction(update);
              }
            });
          }

          await loadFromProvider(set);
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        }
      },

      purchase: async (productId: string) => {
        set({ loading: true, error: null, pendingApproval: false });
        try {
          const provider = getActiveProvider();
          const res = await provider.purchase(productId);
          const outcome = (res as { outcome?: string }).outcome;
          if (res.success) {
            const subscription = await provider.getSubscription();
            set({ subscription, loading: false });

            // Refresh entitlements on successful purchase
            void useEntitlementStore.getState().refresh();
            return true;
          }
          if (outcome === 'pending') {
            set({ pendingApproval: true, loading: false });
            return false;
          }
          set({ error: res.error || 'Purchase was not completed', loading: false });
          return false;
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
          const provider = getActiveProvider();
          const res = await provider.restorePurchases();
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

      manageSubscriptions: async () => {
        const provider = getActiveProvider();
        if (provider instanceof AppStoreBillingProvider) {
          await provider.manageSubscriptions();
        } else if (provider instanceof PlayBillingProvider) {
          await provider.manageSubscriptions();
        }
      },

      setProvider: (provider: BillingProvider) => {
        activeProvider = provider;
        set({ usingMockProvider: provider.type === 'mock', loading: true, error: null });
        loadFromProvider(set).catch((err) => {
          set({
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        });
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
