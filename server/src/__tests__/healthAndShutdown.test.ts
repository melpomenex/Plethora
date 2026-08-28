import { describe, it, expect, vi } from 'vitest';
import { checkDatabaseHealth } from '../db/connection.js';

vi.mock('../db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/connection.js')>();
  return {
    ...actual,
    getPool: vi.fn(),
  };
});

describe('database health check', () => {
  it('returns false when pool query fails', async () => {
    const { getPool } = await import('../db/connection.js');
    vi.mocked(getPool).mockImplementation(() => {
      throw new Error('not initialized');
    });
    const ok = await checkDatabaseHealth();
    expect(ok).toBe(false);
  });
});

describe('shutdown handler', () => {
  it('exports shutdown function', async () => {
    process.env.NODE_ENV = 'test';
    const mod = await import('../index.js');
    expect(typeof mod.shutdown).toBe('function');
    expect(mod.app).toBeDefined();
  });
});
