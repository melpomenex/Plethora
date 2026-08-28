import { describe, it, expect } from 'vitest';
import { derivePlayGrant } from '../billing/playGrants.js';
import type { VerifiedPlayPurchase } from '../billing/playClient.js';
import { selectWinningGrantFromStored, tierFromGrant } from '../billing/unifiedGrants.js';
import type { VerifiedAppStoreTransaction } from '../billing/jws.js';

function playPurchase(overrides: Partial<VerifiedPlayPurchase> = {}): VerifiedPlayPurchase {
  return {
    provider: 'playstore',
    packageName: 'com.plethora.app',
    productId: 'plethora_pro_monthly',
    purchaseToken: 'token-abc',
    orderId: 'GPA.1234',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    environment: 'production',
    expiryTimeMillis: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe('derivePlayGrant', () => {
  it('grants pro for active subscription', () => {
    const grant = derivePlayGrant(playPurchase());
    expect(grant.tier).toBe('pro');
    expect(grant.status).toBe('active');
  });

  it('revokes on SUBSCRIPTION_STATE_REVOKED', () => {
    const grant = derivePlayGrant(
      playPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_REVOKED' })
    );
    expect(grant.tier).toBe('free');
    expect(grant.status).toBe('revoked');
  });

  it('denies pro for SUBSCRIPTION_STATE_PENDING', () => {
    const grant = derivePlayGrant(
      playPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' })
    );
    expect(grant.tier).toBe('free');
    expect(grant.status).toBe('pending');
  });

  it('selects best grant across Apple and Play', () => {
    const apple: VerifiedAppStoreTransaction = {
      transactionId: 't1',
      originalTransactionId: 'ot1',
      bundleId: 'com.plethora.app',
      productId: 'plethora_pro_monthly',
      purchaseDate: Date.now() - 86400000,
      environment: 'Sandbox',
      expiresDate: Date.now() + 86400000,
    };
    const play = playPurchase();
    const winning = selectWinningGrantFromStored([apple, play]);
    expect(tierFromGrant(winning)).toBe('pro');
  });
});
