import type { Pool } from 'pg';

export interface CapabilityResolution {
  enabled: boolean;
  reason?: string;
}

/**
 * Single source of truth for tier + grant override capability resolution.
 * Used by entitlements route and requireCloudSync middleware.
 */
export async function resolveCapability(
  pool: Pool,
  userId: string,
  capability: string
): Promise<CapabilityResolution> {
  const userRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
  const tier = userRes.rows[0]?.subscription_tier || 'free';
  const isPro = tier === 'pro';

  const grantRes = await pool.query(
    'SELECT enabled, reason FROM capability_grants WHERE user_id = $1 AND capability = $2',
    [userId, capability]
  );
  const grant = grantRes.rows[0];
  if (grant) {
    return {
      enabled: Boolean(grant.enabled),
      reason: grant.reason || undefined,
    };
  }

  return {
    enabled: isPro,
    reason: isPro ? undefined : 'plan',
  };
}
