/**
 * Google Play Billing provider (server verification path).
 *
 * Purchase UI requires the native `plethora-playbilling` Tauri plugin (Kotlin).
 * This provider handles server-side validation once a purchaseToken is obtained.
 */

import { PLETHORA_API_URL, isCloudApiEnabled } from '../../config/product';
import { useAccountStore } from '../../stores/accountStore';
import { BillingProvider, ProductInfo, SubscriptionState } from './types';
import { PLETHORA_PRO_MONTHLY, PLETHORA_PRO_ANNUAL } from './productIds';

export class PlayBillingProvider implements BillingProvider {
  public readonly type = 'playstore' as const;

  async getProducts(): Promise<ProductInfo[]> {
    return [
      {
        id: PLETHORA_PRO_MONTHLY,
        name: 'Plethora Pro (Monthly)',
        description: 'Cloud sync, intelligence, and premium audio',
        priceFormatted: '—',
        period: 'monthly',
      },
      {
        id: PLETHORA_PRO_ANNUAL,
        name: 'Plethora Pro (Annual)',
        description: 'Annual Plethora Pro subscription',
        priceFormatted: '—',
        period: 'annual',
      },
    ];
  }

  async purchase(_productId: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    return {
      success: false,
      error:
        'Native Google Play Billing is required. Install the plethora-playbilling plugin on Android store builds.',
    };
  }

  async getSubscription(): Promise<SubscriptionState> {
    if (!isCloudApiEnabled()) {
      return { status: 'free', provider: 'playstore' };
    }
    const token = useAccountStore.getState().tokens?.accessToken;
    if (!token) return { status: 'free', provider: 'playstore' };

    const res = await fetch(`${PLETHORA_API_URL}/v1/billing/subscriptions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'free', provider: 'playstore' };
    const data = (await res.json()) as {
      subscriptionTier?: string;
      subscriptions?: Array<{ productId?: string; status?: string; expiresAt?: string }>;
    };
    const sub = data.subscriptions?.[0];
    return {
      status: data.subscriptionTier === 'pro' ? 'active' : 'free',
      provider: 'playstore',
      productId: sub?.productId,
      renewalDate: sub?.expiresAt,
    };
  }

  async restorePurchases(): Promise<{ restored: boolean; subscription?: SubscriptionState }> {
    if (!isCloudApiEnabled()) {
      return { restored: false };
    }
    const token = useAccountStore.getState().tokens?.accessToken;
    if (!token) return { restored: false };

    const res = await fetch(`${PLETHORA_API_URL}/v1/billing/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { restored: false };
    const data = (await res.json()) as { restored?: boolean; subscription?: { productId?: string; status?: string } };
    const subscription = await this.getSubscription();
    return { restored: !!data.restored, subscription };
  }

  /** Validate a purchase token with the Plethora Cloud server. */
  async validatePurchaseToken(
    purchaseToken: string,
    productId: string
  ): Promise<{ ok: boolean; subscriptionTier?: string }> {
    if (!isCloudApiEnabled()) return { ok: false };
    const token = useAccountStore.getState().tokens?.accessToken;
    if (!token) return { ok: false };

    const res = await fetch(`${PLETHORA_API_URL}/v1/billing/validate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'playstore', purchaseToken, productId }),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { subscriptionTier?: string };
    return { ok: true, subscriptionTier: data.subscriptionTier };
  }
}
