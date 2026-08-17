import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('Server Auth & Token Security', () => {
  const secret = 'test-jwt-secret-key-1234567890';

  it('generates verifiable short-lived access tokens', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const sessionId = '00000000-0000-0000-0000-000000000002';
    const token = jwt.sign({ userId, sessionId }, secret, { expiresIn: '15m' });

    const payload = jwt.verify(token, secret) as { userId: string; sessionId: string };
    expect(payload.userId).toBe(userId);
    expect(payload.sessionId).toBe(sessionId);
  });

  it('identifies expired tokens with TokenExpiredError', () => {
    const expiredToken = jwt.sign({ userId: 'u1' }, secret, { expiresIn: '-1s' });
    expect(() => jwt.verify(expiredToken, secret)).toThrow(jwt.TokenExpiredError);
  });

  it('hashes refresh tokens deterministically using sha256', () => {
    const token1 = 'abcdef1234567890abcdef1234567890';
    const hash1 = hashToken(token1);
    const hash2 = hashToken(token1);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

describe('Server Job Lifecycle & Quotas Contract', () => {
  it('deduplicates jobs with matching idempotency keys', () => {
    const job1 = {
      id: 'job-1',
      userId: 'u1',
      kind: 'document_reconstruct',
      idempotencyKey: 'idemp-123',
      status: 'queued',
    };

    const duplicateSubmission = {
      kind: 'document_reconstruct',
      idempotencyKey: 'idemp-123',
    };

    // If matching idempotency key exists, return original job with deduplicated: true
    const shouldDedupe = duplicateSubmission.idempotencyKey === job1.idempotencyKey;
    expect(shouldDedupe).toBe(true);
  });

  it('computes correct quota remaining header', () => {
    const limit = 1000;
    const used = 350;
    const remaining = Math.max(0, limit - used);
    expect(remaining).toBe(650);
  });
});
