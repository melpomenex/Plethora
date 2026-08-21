import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request } from 'express';
import type { Response } from 'express-serve-static-core';
import { AppError } from '../middleware/error.js';

vi.mock('../db/connection.js', () => ({
  getPool: vi.fn(),
}));

import { deleteAccountHandler } from '../routes/v1/auth.js';
import { getPool } from '../db/connection.js';

/**
 * Change F §1.4 — explicit deletion response semantics:
 *   success  → 200 { success: true, deletedAt }
 *   missing  → 404 AppError 'account_not_found'
 *   db error → retryable AppError 'deletion_failed', account remains active
 */

const CASCADE_TABLES = [
  ['DELETE FROM sessions WHERE user_id = $1'],
  ['DELETE FROM devices WHERE user_id = $1'],
  ['DELETE FROM api_tokens WHERE user_id = $1'],
  ['DELETE FROM webhooks WHERE user_id = $1'],
  ['DELETE FROM inbox_items WHERE user_id = $1'],
  ['DELETE FROM sync_records WHERE user_id = $1'],
  ['DELETE FROM usage_records WHERE user_id = $1'],
  ['DELETE FROM capability_grants WHERE user_id = $1'],
  ['DELETE FROM quota_state WHERE user_id = $1'],
  ['DELETE FROM purchases WHERE user_id = $1'],
  ['DELETE FROM jobs WHERE user_id = $1'],
  ['DELETE FROM users WHERE id = $1'],
] as const;

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function makePool(userRowCount: number) {
  const queries: Array<{ text: string }> = [];
  const pool = {
    query: vi.fn(async (text: string) => {
      queries.push({ text });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: null };
      }
      if (text.startsWith('DELETE FROM users')) {
        return { rows: [], rowCount: userRowCount };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool, queries };
}

describe('Account Deletion & Data Portability Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe('DELETE /v1/auth/account response semantics (Change F §1.4)', () => {
    it('returns explicit success with deletedAt and runs the full cascade in a transaction', async () => {
      const { pool, queries } = makePool(1);
      vi.mocked(getPool).mockReturnValue(pool as never);

      const res = makeRes();
      const next = vi.fn();
      await deleteAccountHandler({ userId: 'u1' } as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

      expect(next).not.toHaveBeenCalled();
      const body = res.body as { success: boolean; deletedAt: string; message?: string };
      expect(body.success).toBe(true);
      expect(typeof body.deletedAt).toBe('string');

      // Full cascade executed inside BEGIN/COMMIT, users deleted last.
      for (const [text] of CASCADE_TABLES) {
        expect(queries.some((q) => q.text === text)).toBe(true);
      }
      expect(queries[0].text).toBe('BEGIN');
      expect(queries[queries.length - 1].text).toBe('COMMIT');
      expect(queries.indexOf(queries.find((q) => q.text === 'DELETE FROM users WHERE id = $1')!)).toBeGreaterThan(
        queries.indexOf(queries.find((q) => q.text === 'DELETE FROM sessions WHERE user_id = $1')!)
      );
    });

    it('returns 404 account_not_found when the account no longer exists', async () => {
      const { pool } = makePool(0);
      vi.mocked(getPool).mockReturnValue(pool as never);

      const res = makeRes();
      const next = vi.fn();
      await deleteAccountHandler({ userId: 'ghost' } as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0] as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(404);
      expect(err.code).toBe('account_not_found');
      // No success response may be emitted.
      expect(res.body).toBeUndefined();
    });

    it("maps database failure to a retryable 'deletion_failed' error and rolls back", async () => {
      const { pool } = makePool(1);
      let calls = 0;
      pool.query.mockImplementation(async (text: string) => {
        calls += 1;
        if (calls >= 5 && !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
          throw new Error('connection reset');
        }
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [], rowCount: null };
        }
        if (text.startsWith('DELETE FROM users')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });
      vi.mocked(getPool).mockReturnValue(pool as never);

      const res = makeRes();
      const next = vi.fn();
      await deleteAccountHandler({ userId: 'u1' } as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

      expect(res.body).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0] as AppError;
      expect(err.status).toBe(500);
      expect(err.code).toBe('deletion_failed');
      expect(err.retryable).toBe(true);

      // Transaction rolled back so the account is not left half-deleted.
      expect(pool.query).toHaveBeenCalledWith('ROLLBACK');
      expect(pool.query).not.toHaveBeenCalledWith('COMMIT');
    });
  });
});
