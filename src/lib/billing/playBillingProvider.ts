/**
 * Native Android Google Play Billing provider.
 *
 * Wraps the `plethora-playbilling` Tauri plugin (Kotlin BillingClient 7.1.1).
 * Localized pricing comes exclusively from Play ProductDetails — never authored
 * in repo code. Purchases require sign-in; obfuscated account IDs bind purchases
 * to Plethora accounts. The server validates purchase tokens and acknowledges
 * via the Android Publisher API before granting Pro.
 */

import { PLETHORA_API_URL, isCloudApiEnabled } from '../../config/product';
import { invoke } from '../../lib/tauri';
import { useAccountStore } from '../../stores/accountStore';
import {
  BillingProvider,
  ProductInfo,
  SubscriptionState,
} from './types';
import { PLETHORA_PRODUCT_IDS, isPlethoraProductId } from './productIds';

export const PURCHASE_UPDATE_EVENT = 'plethora-playbilling-purchase-update';
export const PENDING_PLAY_RECONCILIATION_KEY = 'plethora.billing.pendingPlayReconciliation';
export const OBFUSCATED_ACCOUNT_ID_KEY = 'plethora.billing.obfuscatedAccountId';

const PLUGIN = 'plugin:plethora-playbilling';

export type PlayPurchaseOutcome = 'purchased' | 'pending' | 'userCancelled' | 'failed';

export interface PlayPurchaseRecord {
  productId: string;
  purchaseToken: string;
  orderId?: string;
  purchaseState: string;
  isAcknowledged?: boolean;
}

export interface PlayPurchaseResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  outcome: PlayPurchaseOutcome;
  purchase?: PlayPurchaseRecord;
}

interface PluginProduct {
  id: string;
  displayName: string;
  description: string;
  priceFormatted: string;
  currency?: string;
  period?: string | null;
}

type PurchaseUpdateNotice = {
  responseCode?: number;
  debugMessage?: string;
  purchases?: PlayPurchaseRecord[];
};

type PurchaseListener = (update: PlayPurchaseRecord | PurchaseUpdateNotice) => void;

/** Stable SHA-256 obfuscated account id for Google Play account binding. */
export async function ensureObfuscatedAccountId(accountKey: string): Promise<string> {
  const storageKey = `${OBFUSCATED_ACCOUNT_ID_KEY}.${accountKey}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const data = new TextEncoder().encode(accountKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  localStorage.setItem(storageKey, hash);
  return hash;
}

export function deriveSubscriptionFromPlayPurchases(
  purchases: PlayPurchaseRecord[],
  serverTier?: string
): SubscriptionState {
  const active = purchases.filter(
    (p) =>
      isPlethoraProductId(p.productId) &&
      p.purchaseState === 'purchased'
  );
  if (active.length === 0) {
    const pending = purchases.find(
      (p) => isPlethoraProductId(p.productId) && p.purchaseState === 'pending'
    );
    if (pending) {
      return {
        status: 'pending',
        provider: 'playstore',
        productId: pending.productId,
      };
    }
    if (serverTier === 'pro') {
      return { status: 'active', provider: 'playstore' };
    }
    return { status: 'free', provider: 'playstore' };
  }
  const latest = active[0];
  return {
    status: 'active',
    provider: 'playstore',
    productId: latest.productId,
    period: latest.productId.includes('annual') ? 'annual' : 'monthly',
  };
}

export class PlayBillingProvider implements BillingProvider {
  public readonly type = 'playstore' as const;

  private listenerArmed = false;
  private purchaseListeners = new Set<PurchaseListener>();

  async getProducts(): Promise<ProductInfo[]> {
    const res = await invoke<{ products: PluginProduct[] }>(
      `${PLUGIN}|playbilling_get_products`,
      { ids: [...PLETHORA_PRODUCT_IDS] }
    );
    return (res.products ?? []).map((p) => ({
      id: p.id,
      name: p.displayName,
      description: p.description,
      priceFormatted: p.priceFormatted || '—',
      period: p.period === 'annual' ? 'annual' : 'monthly',
    }));
  }

  async purchase(productId: string): Promise<PlayPurchaseResult> {
    const user = useAccountStore.getState().user;
    if (!user?.id) {
      return {
        success: false,
        outcome: 'failed',
        error: 'Sign in to your Plethora account before subscribing.',
      };
    }

    const obfuscatedAccountId = await ensureObfuscatedAccountId(user.id);
    await invoke(`${PLUGIN}|playbilling_set_obfuscated_account_id`, {
      obfuscatedAccountId,
    });

    const res = await invoke<{ outcome: { outcome: PlayPurchaseOutcome; reason?: string | null; purchase?: PlayPurchaseRecord | null } }>(
      `${PLUGIN}|playbilling_purchase`,
      { productId, obfuscatedAccountId }
    );

    const { outcome, reason, purchase } = res.outcome;

    if (outcome === 'purchased' && purchase?.purchaseToken) {
      const validated = await this.validatePurchaseToken(purchase.purchaseToken, purchase.productId);
      if (validated.ok) {
        return {
          success: true,
          transactionId: purchase.orderId ?? purchase.purchaseToken.slice(0, 32),
          outcome,
          purchase,
        };
      }
      return {
        success: false,
        outcome: 'failed',
        error: 'Purchase completed but server verification failed. Try Restore Purchases.',
        purchase,
      };
    }

    if (outcome === 'pending') {
      return { success: false, outcome, error: 'Payment pending — Pro activates when payment clears.' };
    }

    return {
      success: false,
      outcome,
      error:
        reason ??
        (outcome === 'userCancelled' ? 'Purchase cancelled' : 'Purchase was not completed'),
    };
  }

  async getSubscription(): Promise<SubscriptionState> {
    if (!isCloudApiEnabled()) {
      return { status: 'free', provider: 'playstore' };
    }

    let serverTier: string | undefined;
    const token = useAccountStore.getState().tokens?.accessToken;
    if (token) {
      try {
        const res = await fetch(`${PLETHORA_API_URL}/v1/billing/subscriptions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { subscriptionTier?: string };
          serverTier = data.subscriptionTier;
        }
      } catch {
        /* fall through to native query */
      }
    }

    try {
      const res = await invoke<{ purchases: PlayPurchaseRecord[] }>(
        `${PLUGIN}|playbilling_query_purchases`
      );
      return deriveSubscriptionFromPlayPurchases(res.purchases ?? [], serverTier);
    } catch {
      return serverTier === 'pro'
        ? { status: 'active', provider: 'playstore' }
        : { status: 'free', provider: 'playstore' };
    }
  }

  async restorePurchases(): Promise<{ restored: boolean; subscription?: SubscriptionState }> {
    if (!isCloudApiEnabled()) {
      return { restored: false };
    }
    const accessToken = useAccountStore.getState().tokens?.accessToken;
    if (!accessToken) {
      return { restored: false };
    }

    const native = await invoke<{ restored: boolean; purchases: PlayPurchaseRecord[] }>(
      `${PLUGIN}|playbilling_restore`
    );

    for (const purchase of native.purchases ?? []) {
      if (purchase.purchaseState === 'purchased' && purchase.purchaseToken) {
        await this.validatePurchaseToken(purchase.purchaseToken, purchase.productId);
      }
    }

    const res = await fetch(`${PLETHORA_API_URL}/v1/billing/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const subscription = await this.getSubscription();
    const serverRestored = res.ok ? ((await res.json()) as { restored?: boolean }).restored : false;
    return {
      restored: !!(native.restored || serverRestored || subscription.status === 'active'),
      subscription,
    };
  }

  async manageSubscriptions(): Promise<void> {
    await invoke(`${PLUGIN}|playbilling_manage_subscriptions`, {});
  }

  async startPurchaseListener(cb: PurchaseListener): Promise<void> {
    if (this.listenerArmed) {
      this.purchaseListeners.add(cb);
      return;
    }
    this.purchaseListeners.add(cb);
    const { Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<PurchaseUpdateNotice>();
    channel.onmessage = (update) => {
      const purchases = update.purchases ?? [];
      for (const purchase of purchases) {
        for (const listener of this.purchaseListeners) {
          try {
            listener(purchase);
          } catch (err) {
            console.error('[billing] play purchase listener failed:', err);
          }
        }
      }
    };
    await invoke(`${PLUGIN}|registerListener`, {
      event: PURCHASE_UPDATE_EVENT,
      handler: channel,
    });
    await invoke(`${PLUGIN}|playbilling_start_purchase_listener`);
    this.listenerArmed = true;
  }

  async reconcilePending(): Promise<void> {
    try {
      await this.flushPendingReconciliation();
      await this.startPurchaseListener((update) => {
        if ('purchaseToken' in update && update.purchaseState === 'purchased') {
          void this.validatePurchaseToken(update.purchaseToken, update.productId);
        }
      });
    } catch (err) {
      console.warn('[billing] Play reconcilePending failed non-fatally:', err);
    }
  }

  onPurchaseUpdate(cb: PurchaseListener): () => void {
    this.purchaseListeners.add(cb);
    return () => this.purchaseListeners.delete(cb);
  }

  async validatePurchaseToken(
    purchaseToken: string,
    productId: string
  ): Promise<{ ok: boolean; subscriptionTier?: string }> {
    if (!isCloudApiEnabled()) return { ok: false };
    const token = useAccountStore.getState().tokens?.accessToken;
    if (!token) {
      this.queuePendingReconciliation({ purchaseToken, productId });
      return { ok: false };
    }

    try {
      const res = await fetch(`${PLETHORA_API_URL}/v1/billing/validate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'playstore', purchaseToken, productId }),
      });
      if (res.status >= 500 || res.status === 429) {
        this.queuePendingReconciliation({ purchaseToken, productId });
        return { ok: false };
      }
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as { subscriptionTier?: string };
      return { ok: true, subscriptionTier: data.subscriptionTier };
    } catch {
      this.queuePendingReconciliation({ purchaseToken, productId });
      return { ok: false };
    }
  }

  private queuePendingReconciliation(entry: { purchaseToken: string; productId: string }): void {
    try {
      const raw = localStorage.getItem(PENDING_PLAY_RECONCILIATION_KEY);
      const list: { purchaseToken: string; productId: string }[] = raw ? JSON.parse(raw) : [];
      if (!list.some((e) => e.purchaseToken === entry.purchaseToken)) {
        list.push(entry);
        localStorage.setItem(PENDING_PLAY_RECONCILIATION_KEY, JSON.stringify(list));
      }
    } catch {
      /* ignore storage errors */
    }
  }

  private async flushPendingReconciliation(): Promise<void> {
    const raw = localStorage.getItem(PENDING_PLAY_RECONCILIATION_KEY);
    if (!raw) return;
    let list: { purchaseToken: string; productId: string }[];
    try {
      list = JSON.parse(raw) as { purchaseToken: string; productId: string }[];
    } catch {
      localStorage.removeItem(PENDING_PLAY_RECONCILIATION_KEY);
      return;
    }
    const remaining: typeof list = [];
    for (const entry of list) {
      const result = await this.validatePurchaseToken(entry.purchaseToken, entry.productId);
      if (!result.ok) remaining.push(entry);
    }
    if (remaining.length === 0) {
      localStorage.removeItem(PENDING_PLAY_RECONCILIATION_KEY);
    } else {
      localStorage.setItem(PENDING_PLAY_RECONCILIATION_KEY, JSON.stringify(remaining));
    }
  }
}
