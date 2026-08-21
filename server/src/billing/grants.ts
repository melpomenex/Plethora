/**
 * Entitlement grant derivation from verified App Store transactions
 * (openspec change implement-native-ios-storekit2-billing §6.4).
 *
 * The derivation matrix is the contract:
 *   verified + not expired + not revoked        → pro / active
 *   verified + expired within grace + not revoked → pro / grace
 *   verified + expired past grace               → free / expired
 *   verified + revoked (any time)               → free / revoked
 *   anything UNVERIFIED never reaches this function — callers reject it
 *   upstream (jws.ts) and no grant path exists for it.
 *
 * Pure module: no DB, no clock reads (now is injectable).
 */

import type { VerifiedAppStoreTransaction } from './jws.js';

/** Client-matching grace window for a lapsed renewal (billing retry). */
export const PRO_GRACE_MS = 72 * 60 * 60 * 1000;

export type DerivedStatus = 'active' | 'grace' | 'expired' | 'revoked';

export interface DerivedGrant {
  tier: 'pro' | 'free';
  status: DerivedStatus;
  productId: string;
  originalTransactionId: string;
  expiresAt?: string;
}

export function deriveGrant(
  tx: VerifiedAppStoreTransaction,
  now: number = Date.now(),
  graceMs: number = PRO_GRACE_MS
): DerivedGrant {
  const base = {
    productId: tx.productId,
    originalTransactionId: tx.originalTransactionId,
    expiresAt: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : undefined,
  };

  if (tx.revocationDate !== undefined && tx.revocationDate <= now) {
    return { ...base, tier: 'free', status: 'revoked' };
  }
  if (!tx.expiresDate || tx.expiresDate > now) {
    return { ...base, tier: 'pro', status: 'active' };
  }
  if (tx.expiresDate + graceMs > now) {
    return { ...base, tier: 'pro', status: 'grace' };
  }
  return { ...base, tier: 'free', status: 'expired' };
}

/**
 * Pick the winning transaction for a user's entitlement: the verified
 * transaction with the best status (revoked < expired < grace < active),
 * tie-broken by the latest expiry. Pure.
 */
export function selectWinningGrant(
  transactions: VerifiedAppStoreTransaction[],
  now: number = Date.now(),
  graceMs: number = PRO_GRACE_MS
): DerivedGrant | null {
  const rank: Record<DerivedStatus, number> = {
    revoked: 0,
    expired: 1,
    grace: 2,
    active: 3,
  };
  const grants = transactions
    .filter((tx) => tx.revocationDate === undefined || tx.revocationDate <= now)
    .map((tx) => deriveGrant(tx, now, graceMs));
  if (grants.length === 0) return null;
  return grants.reduce((best, g) => {
    if (rank[g.status] !== rank[best.status]) {
      return rank[g.status] > rank[best.status] ? g : best;
    }
    return (g.expiresAt ? Date.parse(g.expiresAt) : Infinity) >=
      (best.expiresAt ? Date.parse(best.expiresAt) : Infinity)
      ? g
      : best;
  });
}
