export type BillingProviderType = 'appstore' | 'playstore' | 'stripe' | 'mock';

export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'grace'
  | 'expired'
  | 'refunded'
  | 'cancelled';

export interface ProductInfo {
  id: string;
  name: string;
  description: string;
  priceFormatted: string;
  period: 'monthly' | 'annual';
  trialDays?: number;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  provider: BillingProviderType;
  productId?: string;
  period?: 'monthly' | 'annual';
  renewalDate?: string;
  isTrial?: boolean;
}

export interface BillingProvider {
  type: BillingProviderType;
  getProducts(): Promise<ProductInfo[]>;
  purchase(productId: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  getSubscription(): Promise<SubscriptionState>;
  restorePurchases(): Promise<{ restored: boolean; subscription?: SubscriptionState }>;
}

export class MockBillingProvider implements BillingProvider {
  public readonly type: BillingProviderType = 'mock';

  private subscription: SubscriptionState = {
    status: 'free',
    provider: 'mock',
  };

  async getProducts(): Promise<ProductInfo[]> {
    return [
      {
        id: 'plethora_pro_monthly',
        name: 'Plethora Pro (Monthly)',
        description: 'Full multi-device cloud sync, AI intelligence, and premium audio synthesis',
        priceFormatted: '$9.99 / month',
        period: 'monthly',
        trialDays: 14,
      },
      {
        id: 'plethora_pro_annual',
        name: 'Plethora Pro (Annual)',
        description: 'Save 33% with annual billing',
        priceFormatted: '$79.99 / year',
        period: 'annual',
        trialDays: 14,
      },
    ];
  }

  async purchase(productId: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    this.subscription = {
      status: 'active',
      provider: 'mock',
      productId,
      period: productId.includes('annual') ? 'annual' : 'monthly',
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    return { success: true, transactionId: `mock_tx_${Date.now()}` };
  }

  async getSubscription(): Promise<SubscriptionState> {
    return this.subscription;
  }

  async restorePurchases(): Promise<{ restored: boolean; subscription?: SubscriptionState }> {
    return { restored: true, subscription: this.subscription };
  }
}
