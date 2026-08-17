import { beforeEach, describe, expect, it } from 'vitest';
import { useBillingStore } from '../billingStore';
import { MockBillingProvider } from '../../lib/billing/types';

describe('BillingStore & Subscription Flow', () => {
  beforeEach(() => {
    localStorage.clear();
    useBillingStore.getState().setProvider(new MockBillingProvider());
  });

  it('initializes with products and free subscription', async () => {
    await useBillingStore.getState().init();
    const state = useBillingStore.getState();

    expect(state.products.length).toBeGreaterThan(0);
    expect(state.subscription.status).toBe('free');
  });

  it('completes purchase and upgrades subscription to active', async () => {
    await useBillingStore.getState().init();
    const success = await useBillingStore.getState().purchase('plethora_pro_monthly');

    expect(success).toBe(true);
    const state = useBillingStore.getState();
    expect(state.subscription.status).toBe('active');
    expect(state.subscription.productId).toBe('plethora_pro_monthly');
  });

  it('restores existing purchases', async () => {
    await useBillingStore.getState().purchase('plethora_pro_annual');
    const restored = await useBillingStore.getState().restore();

    expect(restored).toBe(true);
    expect(useBillingStore.getState().subscription.status).toBe('active');
  });
});
