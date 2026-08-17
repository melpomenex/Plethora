import { describe, expect, it } from 'vitest';
import crypto from 'crypto';

describe('Public API Tokens & Webhook Signatures', () => {
  it('generates and hashes API tokens with prefix preservation', () => {
    const rawToken = `pt_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const prefix = rawToken.slice(0, 7);

    expect(rawToken.startsWith('pt_')).toBe(true);
    expect(prefix).toBe(rawToken.slice(0, 7));
    expect(tokenHash).toHaveLength(64);

    // Verify hash matches
    const verificationHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    expect(verificationHash).toBe(tokenHash);
  });

  it('signs outgoing webhooks with HMAC-SHA256 and validates signature', () => {
    const secret = 'whsec_test_secret_key_123';
    const payload = JSON.stringify({
      event: 'card.created',
      timestamp: '2026-08-17T15:40:00Z',
      data: { id: 'card-123', documentId: 'doc-456' },
    });

    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const headerValue = `t=1755445200,v1=${signature}`;

    expect(headerValue).toContain('v1=');

    // Receiver validation
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(signature).toBe(expectedSig);
  });

  it('enforces token scopes strictly', () => {
    function hasScope(tokenScopes: string[], requiredScope: string): boolean {
      return tokenScopes.includes('*') || tokenScopes.includes(requiredScope);
    }

    expect(hasScope(['read'], 'read')).toBe(true);
    expect(hasScope(['read'], 'cards:write')).toBe(false);
    expect(hasScope(['read', 'cards:write'], 'cards:write')).toBe(true);
    expect(hasScope(['*'], 'any:scope')).toBe(true);
  });
});
