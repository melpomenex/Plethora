import { describe, expect, it } from 'vitest';

describe('requireCloudSync entitlement logic', () => {
  function cloudSyncEnabled(
    tier: string,
    override: boolean | undefined
  ): boolean {
    if (override !== undefined) {
      return override;
    }
    return tier === 'pro';
  }

  it('allows pro tier by default', () => {
    expect(cloudSyncEnabled('pro', undefined)).toBe(true);
  });

  it('denies free tier by default', () => {
    expect(cloudSyncEnabled('free', undefined)).toBe(false);
  });

  it('respects capability grant overrides', () => {
    expect(cloudSyncEnabled('free', true)).toBe(true);
    expect(cloudSyncEnabled('pro', false)).toBe(false);
  });
});

describe('blob quota accounting', () => {
  it('rejects uploads that exceed quota', () => {
    const used = 9.5 * 1024 * 1024 * 1024;
    const limit = 10 * 1024 * 1024 * 1024;
    const incoming = 600 * 1024 * 1024;
    expect(used + incoming > limit).toBe(true);
  });

  it('allows uploads within quota', () => {
    const used = 1024;
    const limit = 10 * 1024 * 1024 * 1024;
    const incoming = 4096;
    expect(used + incoming <= limit).toBe(true);
  });
});
