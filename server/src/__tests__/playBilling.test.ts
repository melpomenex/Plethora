import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { derivePlayGrant } from '../billing/playGrants.js';
import type { VerifiedPlayPurchase } from '../billing/playClient.js';
import { isAllowedPlayProductId, ALLOWED_PLAY_PRODUCT_IDS } from '../billing/productIds.js';
import { checkPlayTransactionBinding, expectedObfuscatedAccountId } from '../billing/playBinding.js';

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
    }),
  })),
}));

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

describe('Play billing hardening', () => {
  describe('derivePlayGrant', () => {
    it('denies pro for SUBSCRIPTION_STATE_PENDING', () => {
      const grant = derivePlayGrant(
        playPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' })
      );
      expect(grant.tier).toBe('free');
      expect(grant.status).toBe('pending');
    });

    it('keeps pro active until expiry for SUBSCRIPTION_STATE_CANCELED', () => {
      const grant = derivePlayGrant(
        playPurchase({
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          expiryTimeMillis: Date.now() + 7 * 24 * 60 * 60 * 1000,
        })
      );
      expect(grant.tier).toBe('pro');
      expect(grant.status).toBe('active');
    });

    it('expires SUBSCRIPTION_STATE_CANCELED after expiry window', () => {
      const grant = derivePlayGrant(
        playPurchase({
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          expiryTimeMillis: Date.now() - 10 * 24 * 60 * 60 * 1000,
        }),
        Date.now(),
        72 * 60 * 60 * 1000
      );
      expect(grant.tier).toBe('free');
      expect(grant.status).toBe('expired');
    });

    it('marks SUBSCRIPTION_STATE_EXPIRED as free/expired', () => {
      const grant = derivePlayGrant(
        playPurchase({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' })
      );
      expect(grant.tier).toBe('free');
      expect(grant.status).toBe('expired');
    });
  });

  describe('product allowlist', () => {
    it('accepts configured Play product IDs', () => {
      for (const id of ALLOWED_PLAY_PRODUCT_IDS) {
        expect(isAllowedPlayProductId(id)).toBe(true);
      }
    });

    it('rejects unknown product IDs', () => {
      expect(isAllowedPlayProductId('plethora_pro_lifetime')).toBe(false);
      expect(isAllowedPlayProductId('')).toBe(false);
    });
  });

  describe('checkPlayTransactionBinding', () => {
    it('allows first bind when obfuscated account matches requester hash', () => {
      const userId = 'user-a';
      expect(
        checkPlayTransactionBinding({
          existingUserId: null,
          existingAppAccountToken: null,
          requesterUserId: userId,
          obfuscatedExternalAccountId: expectedObfuscatedAccountId(userId),
        })
      ).toEqual({ ok: true });
    });

    it('rejects first bind when obfuscated account mismatches requester', () => {
      expect(
        checkPlayTransactionBinding({
          existingUserId: null,
          existingAppAccountToken: null,
          requesterUserId: 'user-a',
          obfuscatedExternalAccountId: 'wrong-hash',
        })
      ).toEqual({ ok: false, code: 'account_token_mismatch' });
    });

    it('returns token_already_bound when another user owns the row', () => {
      expect(
        checkPlayTransactionBinding({
          existingUserId: 'user-a',
          existingAppAccountToken: null,
          requesterUserId: 'user-b',
        })
      ).toEqual({ ok: false, code: 'token_already_bound' });
    });

    it('returns account_token_mismatch when obfuscated account IDs differ', () => {
      expect(
        checkPlayTransactionBinding({
          existingUserId: 'user-a',
          existingAppAccountToken: 'stored-acct',
          requesterUserId: 'user-a',
          obfuscatedExternalAccountId: 'different-acct',
        })
      ).toEqual({ ok: false, code: 'account_token_mismatch' });
    });

    it('skips user conflict checks for webhook processing (no requester)', () => {
      expect(
        checkPlayTransactionBinding({
          existingUserId: 'user-a',
          existingAppAccountToken: 'stored-acct',
          requesterUserId: null,
          obfuscatedExternalAccountId: 'different-acct',
        })
      ).toEqual({ ok: true });
    });
  });

  describe('verifyPlaySubscription product rejection', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
        client_email: 'svc@test.iam.gserviceaccount.com',
        private_key: 'unused',
      });
      process.env.GOOGLE_PLAY_PACKAGE_NAME = 'com.plethora.app';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
      delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
      vi.resetModules();
    });

    it('rejects disallowed product IDs returned by Google', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          latestOrderId: 'GPA.9999',
          lineItems: [{ productId: 'unknown_sku', expiryTime: new Date(Date.now() + 86400000).toISOString() }],
        }),
      }) as typeof fetch;

      const { verifyPlaySubscription } = await import('../billing/playClient.js');
      await expect(verifyPlaySubscription('purchase-token-xyz', 'unknown_sku')).rejects.toMatchObject({
        status: 422,
        code: 'invalid_product_id',
      });
    });
  });
});
