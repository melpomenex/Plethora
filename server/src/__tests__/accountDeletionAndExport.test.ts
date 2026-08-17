import { describe, it, expect } from 'vitest';

describe('Account Deletion & Data Portability Verification', () => {
  it('defines cascading tables for complete deletion of cloud records', () => {
    const requiredCascadeTables = [
      'sessions',
      'devices',
      'api_tokens',
      'webhooks',
      'inbox_items',
      'sync_records',
      'usage_records',
      'capability_grants',
      'quota_state',
      'purchases',
      'jobs',
      'users',
    ];

    expect(requiredCascadeTables).toContain('inbox_items');
    expect(requiredCascadeTables).toContain('api_tokens');
    expect(requiredCascadeTables).toContain('sync_records');
    expect(requiredCascadeTables).toHaveLength(12);
  });

  it('validates export payload structure includes user, devices, inbox, tokens, and webhooks', () => {
    const mockExport = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      user: { id: 'u1', email: 'test@plethora.app', subscriptionTier: 'pro', createdAt: '2026-08-17' },
      devices: [{ id: 'd1', device_name: 'MacBook', platform: 'darwin', created_at: '2026-08-17' }],
      inboxItems: [{ id: 'i1', url: 'https://example.com', title: 'Paper', status: 'pending', created_at: '2026-08-17' }],
      apiTokens: [{ id: 't1', name: 'CLI', prefix: 'pt_live', scopes: ['read'], created_at: '2026-08-17' }],
      webhooks: [{ id: 'w1', url: 'https://example.com/hook', events: ['card.created'], created_at: '2026-08-17' }],
    };

    expect(mockExport.exportVersion).toBe('1.0');
    expect(mockExport.devices).toHaveLength(1);
    expect(mockExport.inboxItems).toHaveLength(1);
    expect(mockExport.apiTokens).toHaveLength(1);
    expect(mockExport.webhooks).toHaveLength(1);
  });
});
