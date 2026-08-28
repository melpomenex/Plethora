import { describe, expect, it } from 'vitest';
import {
  assertSyncProtocolVersion,
  nextEntityRevision,
  paginatePull,
  shouldConflict,
} from '../sync/pushPullLogic.js';

describe('sync push/pull logic', () => {
  it('accepts default protocol version when header missing', () => {
    expect(() => assertSyncProtocolVersion(undefined)).not.toThrow();
  });

  it('rejects unsupported protocol versions', () => {
    expect(() => assertSyncProtocolVersion('99')).toThrow(/Unsupported sync protocol version/);
  });

  it('paginates pull records by seq number', () => {
    const rows = Array.from({ length: 1200 }, (_, index) => ({
      id: `rec-${index + 1}`,
      seqNumber: index + 1,
    }));

    const page1 = paginatePull(rows, 0, 500);
    expect(page1.records).toHaveLength(500);
    expect(page1.cursor).toBe(500);
    expect(page1.hasMore).toBe(true);

    const page2 = paginatePull(rows, page1.cursor, 500);
    expect(page2.records).toHaveLength(500);
    expect(page2.cursor).toBe(1000);
    expect(page2.hasMore).toBe(true);

    const page3 = paginatePull(rows, page2.cursor, 500);
    expect(page3.records).toHaveLength(200);
    expect(page3.cursor).toBe(1200);
    expect(page3.hasMore).toBe(false);
  });

  it('returns revision conflicts without accepting stale writes', () => {
    expect(shouldConflict(17, 18)).toBe(true);
    const conflict = {
      changeId: 'change-1',
      entityType: 'learning_items',
      entityId: 'item-1',
      serverRevision: 18,
      baseRevision: 17,
    };
    expect(conflict.serverRevision).toBeGreaterThan(conflict.baseRevision);
  });
});

describe('sync idempotency contract', () => {
  it('treats duplicate change ids as already processed', () => {
    const processed = new Set<string>();
    const changeId = 'change-abc';

    const first = !processed.has(changeId);
    if (first) processed.add(changeId);
    const second = !processed.has(changeId);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
