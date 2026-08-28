import type { VerifiedAppStoreTransaction } from './jws.js';
import type { VerifiedPlayPurchase } from './playClient.js';
import { deriveGrant, selectWinningGrant, PRO_GRACE_MS, type DerivedGrant } from './grants.js';
import { derivePlayGrant } from './playGrants.js';

export type StoredTransaction =
  | VerifiedAppStoreTransaction
  | VerifiedPlayPurchase
  | (VerifiedAppStoreTransaction & { provider?: string });

export function isPlayPurchase(tx: StoredTransaction): tx is VerifiedPlayPurchase {
  return (tx as VerifiedPlayPurchase).provider === 'playstore';
}

export function storedTransactionToGrant(tx: StoredTransaction, now = Date.now()): DerivedGrant {
  if (isPlayPurchase(tx)) {
    return derivePlayGrant(tx, now, PRO_GRACE_MS);
  }
  return deriveGrant(tx as VerifiedAppStoreTransaction, now, PRO_GRACE_MS);
}

export function selectWinningGrantFromStored(
  transactions: StoredTransaction[],
  now = Date.now()
): DerivedGrant | null {
  const appleTx = transactions.filter((t) => !isPlayPurchase(t)) as VerifiedAppStoreTransaction[];
  const playTx = transactions.filter(isPlayPurchase);

  const appleGrant = selectWinningGrant(appleTx, now, PRO_GRACE_MS);
  const playGrants = playTx.map((t) => derivePlayGrant(t, now, PRO_GRACE_MS));

  const all = [...(appleGrant ? [appleGrant] : []), ...playGrants];
  if (all.length === 0) return null;

  const rank = { revoked: 0, expired: 1, grace: 2, active: 3 } as const;
  return all.reduce((best, g) => {
    if (rank[g.status] !== rank[best.status]) {
      return rank[g.status] > rank[best.status] ? g : best;
    }
    return (g.expiresAt ? Date.parse(g.expiresAt) : Infinity) >=
      (best.expiresAt ? Date.parse(best.expiresAt) : Infinity)
      ? g
      : best;
  });
}

export function tierFromGrant(grant: DerivedGrant | null): 'pro' | 'free' {
  if (!grant) return 'free';
  return grant.status === 'active' || grant.status === 'grace' ? 'pro' : 'free';
}
