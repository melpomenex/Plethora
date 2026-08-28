import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profileState = vi.hoisted(() => ({ profile: 'development' as string }));

vi.mock('../../buildProfile', () => ({
  get BUILD_PROFILE() {
    return profileState.profile;
  },
  parseBuildProfile: (value: string | undefined | null) =>
    value === undefined || value === null || value === '' ? 'development' : (value as string),
  isStoreProfile: () => profileState.profile === 'store',
  isDevelopmentProfile: () => profileState.profile === 'development',
}));

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/tauri', () => ({
  nativePlatform: vi.fn(() => null),
  isNativeMobile: vi.fn(() => false),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  AppStoreBillingProvider,
  deriveSubscriptionFromTransactions,
  SUBSCRIPTION_GRACE_MS,
  ensureAppAccountToken,
  PENDING_RECONCILIATION_KEY,
  type VerifiedStoreTransaction,
} from '../appStoreProvider';
import {
  PlayBillingProvider,
  deriveSubscriptionFromPlayPurchases,
  ensureObfuscatedAccountId,
} from '../playBillingProvider';
import {
  createMockBillingProvider,
  selectBillingProvider,
  storeProfileInvariantViolation,
} from '../providerSelection';
import {
  MOCK_BILLING_FORBIDDEN_MESSAGE,
  MockBillingProvider,
} from '../types';

function verifiedTx(overrides: Partial<VerifiedStoreTransaction> = {}): VerifiedStoreTransaction {
  return {
    originalTransactionId: '1000001',
    transactionId: '2000001',
    productId: 'plethora_pro_monthly',
    environment: 'Sandbox',
    jws: 'header.payload.signature',
    ...overrides,
  };
}

describe('provider selection (tasks §3.4)', () => {
  it('selects the AppStore provider on iOS', () => {
    const provider = selectBillingProvider({ platform: 'ios' });
    expect(provider).toBeInstanceOf(AppStoreBillingProvider);
    expect(provider.type).toBe('appstore');
  });

  it('selects the mock provider on non-iOS platforms in development', () => {
    const provider = selectBillingProvider({ platform: 'android', profile: 'development' });
    expect(provider.type).toBe('mock');

    const web = selectBillingProvider({ platform: null, profile: 'development' });
    expect(web.type).toBe('mock');
  });

  it('selects PlayBillingProvider on Android store profile', () => {
    const provider = selectBillingProvider({ platform: 'android', profile: 'store' });
    expect(provider).toBeInstanceOf(PlayBillingProvider);
    expect(provider.type).toBe('playstore');
  });

  it('throws when the mock is constructed under the store profile (mock firewall, §5.1)', () => {
    profileState.profile = 'store';
    try {
      expect(() => createMockBillingProvider('store')).toThrow(MOCK_BILLING_FORBIDDEN_MESSAGE);
      // The MockBillingProvider constructor itself enforces the invariant.
      expect(() => new MockBillingProvider()).toThrow(MOCK_BILLING_FORBIDDEN_MESSAGE);
      // A store-profile iOS bundle still gets the real provider.
      expect(selectBillingProvider({ platform: 'ios' }).type).toBe('appstore');
    } finally {
      profileState.profile = 'development';
    }
  });

  it('flags a store-profile bundle whose active provider is the mock (§5.1)', () => {
    expect(storeProfileInvariantViolation({ type: 'mock' }, { profile: 'store' })).toMatch(
      /STORE_PROFILE_MOCK_BILLING/
    );
    expect(storeProfileInvariantViolation({ type: 'appstore' }, { profile: 'store' })).toBeNull();
    // Non-store profiles are unconstrained.
    expect(storeProfileInvariantViolation({ type: 'mock' }, { profile: 'development' })).toBeNull();
    expect(storeProfileInvariantViolation({ type: 'mock' }, { profile: 'sideload' })).toBeNull();
  });
});

describe('offline/grace subscription state machine (tasks §4.4, design §5)', () => {
  const now = Date.now();

  it('is free with no relevant entitlements', () => {
    expect(deriveSubscriptionFromTransactions([], now)).toEqual({
      status: 'free',
      provider: 'appstore',
    });
  });

  it('is active while unexpired', () => {
    const state = deriveSubscriptionFromTransactions(
      [verifiedTx({ expirationDateMs: now + 10 * 24 * 60 * 60 * 1000 })],
      now
    );
    expect(state.status).toBe('active');
    expect(state.period).toBe('monthly');
  });

  it('keeps Pro within the grace window after expiry, marked grace', () => {
    const state = deriveSubscriptionFromTransactions(
      [verifiedTx({ expirationDateMs: now - SUBSCRIPTION_GRACE_MS + 1000 })],
      now
    );
    expect(state.status).toBe('grace');
    expect(state.productId).toBe('plethora_pro_monthly');
  });

  it('downgrades to expired past the grace window', () => {
    const state = deriveSubscriptionFromTransactions(
      [verifiedTx({ expirationDateMs: now - SUBSCRIPTION_GRACE_MS - 1000 })],
      now
    );
    expect(state.status).toBe('expired');
  });

  it('maps revoked transactions to refunded', () => {
    const state = deriveSubscriptionFromTransactions(
      [verifiedTx({ revocationDateMs: now - 1000 })],
      now
    );
    expect(state.status).toBe('refunded');
  });

  it('picks the latest expiration across multiple products and ignores revocations for active derivation', () => {
    const state = deriveSubscriptionFromTransactions([
      verifiedTx({ productId: 'plethora_pro_annual', expirationDateMs: now + 300 * 24 * 60 * 60 * 1000 }),
      verifiedTx({ expirationDateMs: now - SUBSCRIPTION_GRACE_MS - 5000 }),
    ]);
    expect(state.productId).toBe('plethora_pro_annual');
    expect(state.period).toBe('annual');
  });

  it.each([
    ['unexpired → active', now + 1000, 'active'],
    ['active → grace', now - SUBSCRIPTION_GRACE_MS + 1, 'grace'],
    ['grace → expired', now - SUBSCRIPTION_GRACE_MS - 1, 'expired'],
  ] as const)('transition %s', (_label, expirationMs, expected) => {
    const state = deriveSubscriptionFromTransactions(
      [verifiedTx({ expirationDateMs: expirationMs })],
      now
    );
    expect(state.status).toBe(expected);
  });
});

describe('AppStoreBillingProvider plugin mapping (tasks §3.3)', () => {
  let provider: AppStoreBillingProvider;

  beforeEach(() => {
    provider = new AppStoreBillingProvider();
    invokeMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('maps localized StoreKit products without authoring prices', async () => {
    invokeMock.mockResolvedValueOnce({
      products: [
        {
          id: 'plethora_pro_monthly',
          displayName: 'Plethora Pro (Monthly)',
          description: 'Pro',
          priceFormatted: '€9,99',
          period: 'monthly',
          trialDays: null,
        },
      ],
    });
    const products = await provider.getProducts();
    expect(products[0].priceFormatted).toBe('€9,99');
    expect(products[0].trialDays).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin:plethora-storekit|storekit_get_products',
      expect.objectContaining({ ids: ['plethora_pro_monthly', 'plethora_pro_annual'] })
    );
  });

  it('maps purchase outcomes to additive result types without breaking the contract', async () => {
    invokeMock.mockResolvedValueOnce({
      outcome: { outcome: 'userCancelled', reason: null, transaction: null },
    });
    const cancelled = await provider.purchase('plethora_pro_monthly');
    expect(cancelled.success).toBe(false);
    expect(cancelled.outcome).toBe('userCancelled');
    // Superset of the legacy BillingProvider purchase shape:
    expect(Object.keys(cancelled)).toEqual(expect.arrayContaining(['success', 'error']));

    invokeMock.mockResolvedValueOnce({
      outcome: { outcome: 'pending', reason: null, transaction: null },
    });
    const pending = await provider.purchase('plethora_pro_monthly');
    expect(pending.success).toBe(false);
    expect(pending.outcome).toBe('pending');

    invokeMock.mockResolvedValueOnce({
      outcome: {
        outcome: 'failed',
        reason: 'UNVERIFIED_TRANSACTION: bad signature',
        transaction: null,
      },
    });
    const failed = await provider.purchase('plethora_pro_monthly');
    expect(failed.success).toBe(false);
    expect(failed.outcome).toBe('failed');
    expect(failed.error).toContain('UNVERIFIED_TRANSACTION');
  });

  it('returns success plus the verified transaction on a purchased outcome', async () => {
    invokeMock.mockResolvedValueOnce({
      outcome: {
        outcome: 'purchased',
        reason: null,
        transaction: verifiedTx(),
      },
    });
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const res = await provider.purchase('plethora_pro_monthly');
    expect(res.success).toBe(true);
    expect(res.outcome).toBe('purchased');
    expect(res.transactionId).toBe('2000001');
    // Offline server reconciliation queues the JWS (pending reconciliation).
    await new Promise((r) => setTimeout(r, 0));
    const queued = JSON.parse(localStorage.getItem(PENDING_RECONCILIATION_KEY) ?? '[]');
    expect(queued).toHaveLength(1);
  });

  it('persists and reuses a stable appAccountToken per account', () => {
    const token = ensureAppAccountToken('user-1');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(ensureAppAccountToken('user-1')).toBe(token);
    expect(ensureAppAccountToken('user-2')).not.toBe(token);
  });
});

describe('Play billing provider', () => {
  it('derives pending state without granting active Pro', () => {
    const state = deriveSubscriptionFromPlayPurchases([
      {
        productId: 'plethora_pro_monthly',
        purchaseToken: 'token',
        purchaseState: 'pending',
      },
    ]);
    expect(state.status).toBe('pending');
    expect(state.provider).toBe('playstore');
  });

  it('prefers server tier when native purchases empty', () => {
    const state = deriveSubscriptionFromPlayPurchases([], 'pro');
    expect(state.status).toBe('active');
  });

  it('generates stable obfuscated account ids', async () => {
    const a = await ensureObfuscatedAccountId('acct-1');
    const b = await ensureObfuscatedAccountId('acct-1');
    expect(a).toHaveLength(64);
    expect(a).toBe(b);
    expect(await ensureObfuscatedAccountId('acct-2')).not.toBe(a);
  });
});
