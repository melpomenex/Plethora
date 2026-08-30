import { describe, expect, it, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../config/env.js', () => ({
  getJwtSecret: () => 'test-jwt-secret-key-1234567890',
  getEnv: () => ({ NODE_ENV: 'test', PORT: 0, DATABASE_URL: 'postgres://test' }),
}));

import {
  optionalAuthMiddleware,
  authMiddleware,
  type AuthRequest,
} from '../middleware/auth.js';

const SECRET = 'test-jwt-secret-key-1234567890';

function makeReq(headers: Record<string, string> = {}): AuthRequest {
  return { headers } as unknown as AuthRequest;
}

function makeRes() {
  return {
    // Express defaults to 200 when only .json() is called.
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe('optionalAuthMiddleware (entitlements auth contract)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('authenticates a valid bearer and sets no rejection flags', () => {
    const token = jwt.sign({ userId: 'u-1' }, SECRET);
    const req = makeReq({ authorization: `Bearer ${token}` });
    optionalAuthMiddleware(req, makeRes() as never, vi.fn());
    expect(req.userId).toBe('u-1');
    expect(req.authRejected).toBeUndefined();
  });

  it('passes anonymous requests through without flags (no bearer)', () => {
    const req = makeReq({});
    optionalAuthMiddleware(req, makeRes() as never, vi.fn());
    expect(req.userId).toBeUndefined();
    expect(req.authRejected).toBeUndefined();
  });

  it('flags an expired bearer as rejected with token_expired but continues', () => {
    const expired = jwt.sign({ userId: 'u-1' }, SECRET, { expiresIn: '-1s' });
    const req = makeReq({ authorization: `Bearer ${expired}` });
    const next = vi.fn();
    optionalAuthMiddleware(req, makeRes() as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBeUndefined();
    expect(req.authRejected).toBe(true);
    expect(req.authError).toBe('token_expired');
  });

  it('flags a garbage bearer as rejected with invalid_token but continues', () => {
    const req = makeReq({ authorization: 'Bearer not-a-jwt' });
    const next = vi.fn();
    optionalAuthMiddleware(req, makeRes() as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.authRejected).toBe(true);
    expect(req.authError).toBe('invalid_token');
  });

  it('strict authMiddleware still 401s expired tokens with token_expired', () => {
    const expired = jwt.sign({ userId: 'u-1' }, SECRET, { expiresIn: '-1s' });
    const req = makeReq({ authorization: `Bearer ${expired}` });
    const next = vi.fn();
    void authMiddleware(req, makeRes() as never, next);
    const err = next.mock.calls[0]?.[0] as { status?: number; code?: string };
    expect(err?.status).toBe(401);
    expect(err?.code).toBe('token_expired');
  });
});

describe('GET /v1/entitlements auth boundary', () => {
  it('returns 401 token_expired for a presented-but-rejected bearer', async () => {
    vi.doMock('../db/connection.js', () => ({ getPool: vi.fn() }));
    const { entitlementsRouter } = await import('../routes/v1/entitlements.js');
    const handler = entitlementsRouter.stack[0]?.route?.stack?.at(-1)?.handle;
    expect(handler).toBeDefined();

    const req = makeReq({ authorization: 'Bearer expired-token' });
    req.authRejected = true;
    req.authError = 'token_expired';
    const res = makeRes();
    await handler(req, res as never, vi.fn());

    expect(res.statusCode).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('token_expired');
  });

  it('returns the anonymous 200 Free snapshot only when no bearer was presented', async () => {
    vi.doMock('../db/connection.js', () => ({ getPool: vi.fn() }));
    const { entitlementsRouter } = await import('../routes/v1/entitlements.js');
    const handler = entitlementsRouter.stack[0]?.route?.stack?.at(-1)?.handle;

    const req = makeReq({}); // genuinely anonymous
    const res = makeRes();
    await handler(req, res as never, vi.fn());

    expect(res.statusCode).toBe(200);
    const body = res.body as { accountId: null; plan: string; source: string };
    expect(body.accountId).toBeNull();
    expect(body.plan).toBe('free');
    expect(body.source).toBe('server');
  });
});
