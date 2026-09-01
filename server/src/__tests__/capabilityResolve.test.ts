import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveCapability } from '../capabilities/resolve.js';

function mockPool(rowsByQuery: Record<string, { rows: unknown[] }>) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const key = `${sql}::${JSON.stringify(params ?? [])}`;
      for (const [pattern, result] of Object.entries(rowsByQuery)) {
        if (key.includes(pattern)) return result;
      }
      return { rows: [] };
    }),
  };
}

describe('resolveCapability', () => {
  it('enables cloud_sync for pro tier without grant override', async () => {
    const pool = mockPool({
      subscription_tier: { rows: [{ subscription_tier: 'pro' }] },
      capability_grants: { rows: [] },
    });
    const result = await resolveCapability(pool as never, 'user-1', 'cloud_sync');
    expect(result.enabled).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('honors grant override disabling cloud_sync for pro user', async () => {
    const pool = mockPool({
      subscription_tier: { rows: [{ subscription_tier: 'pro' }] },
      capability_grants: { rows: [{ enabled: false, reason: 'admin' }] },
    });
    const result = await resolveCapability(pool as never, 'user-1', 'cloud_sync');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('admin');
  });

  it('disables cloud_sync for free tier without grant', async () => {
    const pool = mockPool({
      subscription_tier: { rows: [{ subscription_tier: 'free' }] },
      capability_grants: { rows: [] },
    });
    const result = await resolveCapability(pool as never, 'user-1', 'cloud_sync');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('plan');
  });
});
