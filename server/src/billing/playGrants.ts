import type { VerifiedPlayPurchase } from './playClient.js';
import { PRO_GRACE_MS, type DerivedGrant, type DerivedStatus } from './grants.js';

export function derivePlayGrant(
  purchase: VerifiedPlayPurchase,
  now: number = Date.now(),
  graceMs: number = PRO_GRACE_MS
): DerivedGrant {
  const base = {
    productId: purchase.productId,
    originalTransactionId: purchase.orderId,
    expiresAt: purchase.expiryTimeMillis ? new Date(purchase.expiryTimeMillis).toISOString() : undefined,
  };

  const state = purchase.subscriptionState;

  if (
    state === 'SUBSCRIPTION_STATE_REVOKED' ||
    state === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
  ) {
    return { ...base, tier: 'free', status: 'revoked' };
  }

  if (state === 'SUBSCRIPTION_STATE_PENDING') {
    return { ...base, tier: 'free', status: 'pending' };
  }

  if (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
    return { ...base, tier: 'pro', status: state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ? 'grace' : 'active' };
  }

  if (state === 'SUBSCRIPTION_STATE_ON_HOLD' || state === 'SUBSCRIPTION_STATE_PAUSED') {
    return { ...base, tier: 'pro', status: 'grace' };
  }

  if (state === 'SUBSCRIPTION_STATE_CANCELED') {
    if (purchase.expiryTimeMillis && purchase.expiryTimeMillis > now) {
      return { ...base, tier: 'pro', status: 'active' };
    }
    if (purchase.expiryTimeMillis && purchase.expiryTimeMillis + graceMs > now) {
      return { ...base, tier: 'pro', status: 'grace' };
    }
    return { ...base, tier: 'free', status: 'expired' };
  }

  if (state === 'SUBSCRIPTION_STATE_EXPIRED') {
    return { ...base, tier: 'free', status: 'expired' };
  }

  if (purchase.expiryTimeMillis && purchase.expiryTimeMillis + graceMs > now) {
    return { ...base, tier: 'pro', status: 'grace' };
  }

  return { ...base, tier: 'free', status: 'expired' };
}

export function playGrantToDerivedStatus(purchase: VerifiedPlayPurchase): DerivedStatus {
  return derivePlayGrant(purchase).status;
}
