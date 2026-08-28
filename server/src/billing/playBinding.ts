import { createHash } from 'node:crypto';

export function hashPlayPurchaseToken(purchaseToken: string): string {
  return createHash('sha256').update(purchaseToken).digest('hex');
}

/** Matches client `ensureObfuscatedAccountId` (SHA-256 of Plethora user id). */
export function expectedObfuscatedAccountId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

export type PlayBindingConflictCode = 'token_already_bound' | 'account_token_mismatch';

export type PlayBindingCheckResult =
  | { ok: true }
  | { ok: false; code: PlayBindingConflictCode };

/**
 * Binding policy for verified Play purchases:
 * - A purchase token already bound to another user is rejected.
 * - obfuscatedExternalAccountId must match a stored app_account_token when both are present.
 */
export function checkPlayTransactionBinding(params: {
  existingUserId: string | null;
  existingAppAccountToken: string | null;
  requesterUserId: string | null;
  obfuscatedExternalAccountId?: string | null;
}): PlayBindingCheckResult {
  const {
    existingUserId,
    existingAppAccountToken,
    requesterUserId,
    obfuscatedExternalAccountId,
  } = params;

  if (requesterUserId && existingUserId && existingUserId !== requesterUserId) {
    return { ok: false, code: 'token_already_bound' };
  }

  if (
    requesterUserId &&
    obfuscatedExternalAccountId &&
    existingAppAccountToken &&
    existingAppAccountToken !== obfuscatedExternalAccountId
  ) {
    return { ok: false, code: 'account_token_mismatch' };
  }

  // First bind: Google-reported obfuscated id must match the authenticated user.
  if (
    requesterUserId &&
    obfuscatedExternalAccountId &&
    !existingUserId &&
    obfuscatedExternalAccountId !== expectedObfuscatedAccountId(requesterUserId)
  ) {
    return { ok: false, code: 'account_token_mismatch' };
  }

  return { ok: true };
}
