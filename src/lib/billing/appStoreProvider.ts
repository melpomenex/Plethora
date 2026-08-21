/**
 * Native iOS StoreKit 2 billing provider.
 *
 * Wraps the `plethora-storekit` Tauri plugin (Swift StoreKit 2). All product
 * pricing is localized by StoreKit; this provider never authors a price
 * string. Purchases are bound to the Plethora account via `appAccountToken`,
 * and the signed transaction JWS is forwarded to the Plethora server for
 * authoritative verification (`POST /v1/billing/validate`). If the server is
 * unreachable the JWS is queued and retried on the next init (pending
 * reconciliation, design §Failure Behavior).
 */

import { PLETHORA_API_URL } from '../../config/product';
import { invoke } from '../../lib/tauri';
import { useAccountStore } from '../../stores/accountStore';
import {
  BillingProvider,
  ProductInfo,
  SubscriptionState,
} from './types';
import { PLETHORA_PRODUCT_IDS, isPlethoraProductId } from './productIds';

/** Event name the native plugin triggers transaction updates on. */
export const TRANSACTION_UPDATE_EVENT = 'plethora-storekit-transaction-update';

const PLUGIN = 'plugin:plethora-storekit';

/** localStorage key for the pending-reconciliation queue. */
export const PENDING_RECONCILIATION_KEY = 'plethora.billing.pendingReconciliation';
/** localStorage key prefix for the per-account appAccountToken. */
export const APP_ACCOUNT_TOKEN_KEY = 'plethora.billing.appAccountToken';

/** Client-side grace window for an expired-but-not-yet-hard-failed renewal. */
export const SUBSCRIPTION_GRACE_MS = 72 * 60 * 60 * 1000;

/** A StoreKit-2-verified transaction (mirrors the Swift payload contract). */
export interface VerifiedStoreTransaction {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  purchaseDateMs?: number;
  expirationDateMs?: number;
  revocationDateMs?: number;
  environment: string;
  appAccountToken?: string;
  jws: string;
}

/** Additive purchase outcome (superset of the BillingProvider result). */
export type AppStorePurchaseOutcome =
  | 'purchased'
  | 'pending'
  | 'userCancelled'
  | 'failed';

export interface AppStorePurchaseResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  outcome: AppStorePurchaseOutcome;
  transaction?: VerifiedStoreTransaction;
}

interface PluginProduct {
  id: string;
  displayName: string;
  description: string;
  priceFormatted: string;
  period?: string | null;
  introOffer?: {
    displayPrice: string;
    periodValue: number;
    periodUnit: string;
    paymentMode: string;
  } | null;
  trialDays?: number | null;
}

interface TransactionUpdateNotice {
  unverified?: boolean;
  reason?: string;
}

type TransactionListener = (
  transaction: VerifiedStoreTransaction | TransactionUpdateNotice
) => void;

/**
 * Derive a SubscriptionState from verified StoreKit transactions.
 *
 * Pure function so the offline/grace state machine (design §5) is unit
 * tested: active while unexpired, `grace` for SUBSCRIPTION_GRACE_MS after
 * expiry, `expired` afterwards, `refunded` when a revocation is present.
 */
export function deriveSubscriptionFromTransactions(
  transactions: VerifiedStoreTransaction[],
  now: number = Date.now()
): SubscriptionState {
  const relevant = transactions.filter(
    (t) => isPlethoraProductId(t.productId) && !t.revocationDateMs
  );
  if (relevant.length === 0) {
    const refunded = transactions.find(
      (t) => isPlethoraProductId(t.productId) && t.revocationDateMs
    );
    return refunded
      ? { status: 'refunded', provider: 'appstore', productId: refunded.productId }
      : { status: 'free', provider: 'appstore' };
  }

  const latest = relevant.reduce((a, b) =>
    (b.expirationDateMs ?? 0) > (a.expirationDateMs ?? 0) ? b : a
  );

  const base: SubscriptionState = {
    status: 'active',
    provider: 'appstore',
    productId: latest.productId,
    period: latest.productId.includes('annual') ? 'annual' : 'monthly',
    renewalDate: latest.expirationDateMs
      ? new Date(latest.expirationDateMs).toISOString()
      : undefined,
  };

  if (!latest.expirationDateMs || latest.expirationDateMs > now) {
    return { ...base, status: 'active' };
  }
  if (now - latest.expirationDateMs <= SUBSCRIPTION_GRACE_MS) {
    return { ...base, status: 'grace' };
  }
  return { ...base, status: 'expired' };
}

/** Stable per-account UUID used as the Apple `appAccountToken`. */
export function ensureAppAccountToken(accountKey: string): string {
  const storageKey = `${APP_ACCOUNT_TOKEN_KEY}.${accountKey}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const token = crypto.randomUUID();
  localStorage.setItem(storageKey, token);
  return token;
}

export class AppStoreBillingProvider implements BillingProvider {
  public readonly type = 'appstore' as const;

  private listenerArmed = false;
  private transactionListeners = new Set<TransactionListener>();

  async getProducts(): Promise<ProductInfo[]> {
    const res = await invoke<{ products: PluginProduct[] }>(
      `${PLUGIN}|storekit_get_products`,
      { ids: [...PLETHORA_PRODUCT_IDS] }
    );
    return (res.products ?? []).map((p) => ({
      id: p.id,
      name: p.displayName,
      description: p.description,
      // StoreKit's localized price — the single source of truth.
      priceFormatted: p.priceFormatted,
      period: p.period === 'annual' ? 'annual' : 'monthly',
      trialDays: p.trialDays ?? undefined,
    }));
  }

  /**
   * BillingProvider contract plus the additive `outcome` field: pending
   * (ask-to-buy) and userCancelled are structured results, not errors.
   */
  async purchase(productId: string): Promise<AppStorePurchaseResult> {
    const token = this.currentAppAccountToken();
    const res = await invoke<{
      outcome: {
        outcome: AppStorePurchaseOutcome;
        reason?: string | null;
        transaction?: VerifiedStoreTransaction | null;
      };
    }>(`${PLUGIN}|storekit_purchase`, {
      productId,
      appAccountToken: token ?? null,
    });

    const { outcome, reason, transaction } = res.outcome;
    if (outcome === 'purchased' && transaction) {
      void this.reconcileWithServer(transaction);
      return {
        success: true,
        transactionId: transaction.transactionId,
        outcome,
        transaction,
      };
    }
    if (outcome === 'pending') {
      // Ask-to-buy: no entitlement yet; Transaction.updates + server
      // reconciliation grant it later.
      return { success: false, outcome, error: 'awaiting-approval' };
    }
    return {
      success: false,
      outcome,
      error: reason ?? (outcome === 'userCancelled' ? 'cancelled' : 'purchase-failed'),
    };
  }

  async getSubscription(): Promise<SubscriptionState> {
    const res = await invoke<{ transactions: VerifiedStoreTransaction[] }>(
      `${PLUGIN}|storekit_current_entitlements`
    );
    return deriveSubscriptionFromTransactions(res.transactions ?? []);
  }

  async restorePurchases(): Promise<{
    restored: boolean;
    subscription?: SubscriptionState;
  }> {
    const res = await invoke<{
      restored: boolean;
      transactions: VerifiedStoreTransaction[];
    }>(`${PLUGIN}|storekit_restore`);
    const subscription = deriveSubscriptionFromTransactions(res.transactions ?? []);
    // Restore is also a reconciliation trigger for the server.
    for (const t of res.transactions ?? []) {
      void this.reconcileWithServer(t);
    }
    return {
      restored: subscription.status === 'active' || subscription.status === 'grace',
      subscription,
    };
  }

  /**
   * Open Apple's manage-subscriptions sheet (exposed for Proposal F's UI via
   * the billing store).
   */
  async manageSubscriptions(): Promise<void> {
    await invoke(`${PLUGIN}|storekit_manage_subscriptions`);
  }

  /**
   * Arm the native Transaction.updates observer and forward events to `cb`.
   * The channel must be registered before the listener task starts so no
   * update is lost between the two calls.
   */
  async startTransactionListener(cb: TransactionListener): Promise<void> {
    if (this.listenerArmed) {
      this.transactionListeners.add(cb);
      return;
    }
    this.transactionListeners.add(cb);
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<VerifiedStoreTransaction | TransactionUpdateNotice>();
    channel.onmessage = (update) => {
      for (const listener of this.transactionListeners) {
        try {
          listener(update);
        } catch (err) {
          console.error('[billing] transaction listener failed:', err);
        }
      }
    };
    await invoke(`${PLUGIN}|registerListener`, {
      event: TRANSACTION_UPDATE_EVENT,
      handler: channel,
    });
    await invoke(`${PLUGIN}|storekit_start_transaction_listener`);
    this.listenerArmed = true;
  }

  /**
   * Startup reconciliation: post any queued JWS payloads (offline purchases)
   * to the server, then arm the transaction listener.
   */
  async reconcilePending(): Promise<void> {
    await this.flushPendingReconciliation();
    await this.startTransactionListener(() => {
      /* updates are consumed via onTransactionUpdate registrations below */
    });
  }

  /** Subscribe to native transaction updates (renewals, refunds, ask-to-buy). */
  onTransactionUpdate(cb: TransactionListener): () => void {
    this.transactionListeners.add(cb);
    return () => this.transactionListeners.delete(cb);
  }

  private currentAppAccountToken(): string | null {
    const user = useAccountStore.getState().user;
    if (!user?.id) return null;
    return ensureAppAccountToken(user.id);
  }

  /**
   * Post the signed JWS to the server for authoritative verification.
   * Network failure queues the payload (pending reconciliation); a server
   * rejection (unverifiable JWS) drops it — the server never grants from
   * unverified data and retrying cannot help.
   */
  async reconcileWithServer(transaction: VerifiedStoreTransaction): Promise<void> {
    try {
      const tokens = useAccountStore.getState().tokens;
      const res = await fetch(`${PLETHORA_API_URL}/v1/billing/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokens?.accessToken
            ? { Authorization: `Bearer ${tokens.accessToken}` }
            : {}),
        },
        body: JSON.stringify({ provider: 'appstore', jws: transaction.jws }),
      });
      if (res.status >= 500 || res.status === 429 || res.status === 401) {
        this.queuePendingReconciliation(transaction);
      }
    } catch {
      this.queuePendingReconciliation(transaction);
    }
  }

  private queuePendingReconciliation(transaction: VerifiedStoreTransaction): void {
    try {
      const raw = localStorage.getItem(PENDING_RECONCILIATION_KEY);
      const queue: string[] = raw ? JSON.parse(raw) : [];
      if (!queue.includes(transaction.jws)) {
        queue.push(transaction.jws);
        localStorage.setItem(PENDING_RECONCILIATION_KEY, JSON.stringify(queue));
      }
    } catch {
      // Queue is best-effort; the next purchase/restore re-triggers anyway.
    }
  }

  private async flushPendingReconciliation(): Promise<void> {
    try {
      const raw = localStorage.getItem(PENDING_RECONCILIATION_KEY);
      if (!raw) return;
      const queue: string[] = JSON.parse(raw);
      const remaining: string[] = [];
      for (const jws of queue) {
        try {
          const tokens = useAccountStore.getState().tokens;
          const res = await fetch(`${PLETHORA_API_URL}/v1/billing/validate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(tokens?.accessToken
                ? { Authorization: `Bearer ${tokens.accessToken}` }
                : {}),
            },
            body: JSON.stringify({ provider: 'appstore', jws }),
          });
          if (res.status >= 500 || res.status === 429 || res.status === 401) {
            remaining.push(jws);
          }
        } catch {
          remaining.push(jws);
        }
      }
      localStorage.setItem(PENDING_RECONCILIATION_KEY, JSON.stringify(remaining));
    } catch {
      // Corrupt queue: drop it rather than loop forever.
      localStorage.removeItem(PENDING_RECONCILIATION_KEY);
    }
  }
}
