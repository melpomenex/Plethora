/**
 * Billing provider selection (openspec change
 * implement-native-ios-storekit2-billing, tasks §3.4 + §5.1).
 *
 * - iOS native builds → AppStoreBillingProvider (real StoreKit 2 commerce).
 * - Every other platform → MockBillingProvider, development only.
 * - Under the `store` build profile the mock is FORBIDDEN: constructing it
 *   throws, and a store-profile bundle whose active provider is still the
 *   mock fails the startup invariant.
 */

import { nativePlatform } from '../../lib/tauri';
import { BUILD_PROFILE, type BuildProfile } from '../buildProfile';
import { AppStoreBillingProvider } from './appStoreProvider';
import { PlayBillingProvider } from './playBillingProvider';
import {
  BillingProvider,
  MOCK_BILLING_FORBIDDEN_MESSAGE,
  MockBillingProvider,
} from './types';

/**
 * Create the default provider for the current platform/profile. Pure in its
 * inputs (`platform`/`profile` injectable for tests).
 */
export function selectBillingProvider(opts?: {
  platform?: string | null;
  profile?: BuildProfile;
}): BillingProvider {
  const platform = opts?.platform !== undefined ? opts.platform : nativePlatform();
  const profile = opts?.profile ?? BUILD_PROFILE;

  if (platform === 'ios') {
    return new AppStoreBillingProvider();
  }
  if (platform === 'android' && profile === 'store') {
    return new PlayBillingProvider();
  }
  return createMockBillingProvider(profile);
}

/**
 * Construct the dev-only mock. Throws under the store profile — the mock
 * firewall invariant.
 */
export function createMockBillingProvider(profile: BuildProfile = BUILD_PROFILE): MockBillingProvider {
  if (profile === 'store') {
    throw new Error(MOCK_BILLING_FORBIDDEN_MESSAGE);
  }
  return new MockBillingProvider();
}

/**
 * Startup invariant: a store-profile build must never run on the mock
 * provider. Returns the failure message or null when satisfied.
 */
export function storeProfileInvariantViolation(
  provider: Pick<BillingProvider, 'type'>,
  opts?: { profile?: BuildProfile; platform?: string | null }
): string | null {
  const profile = opts?.profile ?? BUILD_PROFILE;
  if (profile !== 'store') return null;
  const platform = opts?.platform !== undefined ? opts.platform : nativePlatform();
  if (provider.type === 'mock') {
    return `STORE_PROFILE_MOCK_BILLING: active billing provider is "mock" on ${platform ?? 'unknown'} — refusing to init (store profile requires a real store provider)`;
  }
  return null;
}

/** True when this environment should label billing surfaces as dev-only mock. */
export function usesMockBilling(opts?: { platform?: string | null }): boolean {
  try {
    return selectBillingProvider(opts).type === 'mock';
  } catch {
    // Store-profile construction failure means mock must never be used.
    return false;
  }
}
