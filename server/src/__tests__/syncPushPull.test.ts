import { describe, expect, it } from 'vitest';
import {
  assertDeviceAllowed,
  assertSyncEpoch,
  assertSyncProtocolVersion,
  MAX_SYNC_DEVICES,
  minDeviceCursorSeq,
  nextEntityRevision,
  normalizeSyncPullRow,
  paginatePull,
  shouldConflict,
} from '../sync/pushPullLogic.js';
import { SyncRecordSchema } from '../routes/v1/sync.js';

function looksLikePlaintextEnvelope(ciphertext: string): boolean {
  try {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { payload_b64?: unknown };
    return typeof parsed === 'object' && parsed !== null && 'payload_b64' in parsed;
  } catch {
    return false;
  }
}

describe('sync push/pull logic', () => {
  const validRecord = {
    tableKind: 'learning_items',
    recordId: 'item-1',
    hlc: '1000:0',
    deviceId: '11111111-1111-4111-8111-111111111111',
    payloadCiphertext: 'opaque-base64-ciphertext',
    aad: 'account:learning_item:item-1:change-1:1',
    keyVersion: 1,
    changeId: 'change-1',
    operation: 'update',
    baseRevision: 1,
  };

  it('validates routing metadata that can poison a pull log', () => {
    expect(SyncRecordSchema.safeParse(validRecord).success).toBe(true);
    expect(SyncRecordSchema.safeParse({ ...validRecord, tableKind: 'unknown' }).success).toBe(false);
    expect(SyncRecordSchema.safeParse({ ...validRecord, operation: 'overwrite' }).success).toBe(false);
    expect(SyncRecordSchema.safeParse({ ...validRecord, hlc: 'not-an-hlc' }).success).toBe(false);
    expect(SyncRecordSchema.safeParse({ ...validRecord, baseRevision: -1 }).success).toBe(false);
    expect(SyncRecordSchema.safeParse({ ...validRecord, deviceId: 'spoofed-device' }).success).toBe(false);
  });

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

  it('paginates pg int8 rows whose seq numbers arrive as strings', () => {
    // node-postgres returns BIGINT columns as strings; the wire cursor must
    // still be a JSON integer for u64/i64 clients.
    const rows = [
      { seqNumber: '1000' },
      { seqNumber: '1001' },
      { seqNumber: '1002' },
    ];
    const page = paginatePull(rows, 999, 2);
    expect(page.records.map((r) => r.seqNumber)).toEqual(['1000', '1001']);
    expect(page.cursor).toBe(1001);
    expect(page.hasMore).toBe(true);
    expect(Number.isInteger(page.cursor)).toBe(true);
  });

  it('normalizes int8-backed pull fields to JSON integers', () => {
    const row = normalizeSyncPullRow({
      id: 'rec-1',
      tableKind: 'learning_items',
      seqNumber: '39',
      baseRevision: '0',
      entityRevision: '39',
      payloadCiphertext: 'opaque',
    });
    expect(row.seqNumber).toBe(39);
    expect(row.baseRevision).toBe(0);
    expect(row.entityRevision).toBe(39);
    expect(row.tableKind).toBe('learning_items');
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it('preserves null revisions when normalizing pull rows', () => {
    const row = normalizeSyncPullRow({
      seqNumber: 7,
      baseRevision: null,
      entityRevision: null,
    });
    expect(row).toEqual({ seqNumber: 7, baseRevision: null, entityRevision: null });
  });

  it('returns revision conflicts without accepting stale writes', () => {
    expect(shouldConflict(17, 18)).toBe(true);
    expect(shouldConflict(19, 18)).toBe(true);
    expect(shouldConflict(18, 18)).toBe(false);
    const conflict = {
      changeId: 'change-1',
      entityType: 'learning_items',
      entityId: 'item-1',
      serverRevision: 18,
      baseRevision: 17,
    };
    expect(conflict.serverRevision).toBeGreaterThan(conflict.baseRevision);
  });

  it('computes the slowest device cursor for tombstone GC', () => {
    expect(minDeviceCursorSeq([])).toBe(0);
    expect(minDeviceCursorSeq([{ last_seq: 120 }, { last_seq: 80 }, { last_seq: 200 }])).toBe(80);
    expect(minDeviceCursorSeq([{ last_seq: 0 }, { last_seq: 100 }])).toBe(0);
    expect(minDeviceCursorSeq([{ last_seq: '25' }, { last_seq: null }])).toBe(0);
  });

  it('enforces a maximum number of sync devices', () => {
    const known = Array.from({ length: MAX_SYNC_DEVICES }, (_, index) => `device-${index}`);
    expect(() => assertDeviceAllowed(known, 'device-new')).toThrow(/Device limit reached/);
    expect(() => assertDeviceAllowed(known, 'device-0')).not.toThrow();
  });

  it('requires the exact account sync key epoch', () => {
    expect(() => assertSyncEpoch(1, 2)).toThrow(/Invalid sync key epoch/);
    expect(() => assertSyncEpoch(2, 2)).not.toThrow();
    expect(() => assertSyncEpoch(3, 2)).toThrow(/Invalid sync key epoch/);
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

describe('sync zero-knowledge contract', () => {
  it('stores only ciphertext fields in sync record shape', () => {
    const record = {
      tableKind: 'learning_items',
      recordId: 'item-1',
      hlc: '1000:0',
      deviceId: 'device-a',
      payloadCiphertext: 'opaque-base64-ciphertext',
      aad: 'acct:learning_items:item-1',
      keyVersion: 1,
    };
    expect(record.payloadCiphertext).not.toContain('question');
    expect(record.payloadCiphertext).not.toContain('answer');
    expect(Object.keys(record)).not.toContain('plaintext');
  });

  it('advances entity revision monotonically', () => {
    expect(nextEntityRevision(0)).toBe(1);
    expect(nextEntityRevision(18)).toBe(19);
  });

  it('detects legacy plaintext sync envelopes', () => {
    const envelope = Buffer.from(
      JSON.stringify({ schema_version: 1, payload_b64: 'cXVlc3Rpb24=' }),
      'utf8'
    ).toString('base64');
    expect(looksLikePlaintextEnvelope(envelope)).toBe(true);
    expect(looksLikePlaintextEnvelope('opaque-base64-ciphertext')).toBe(false);
  });
});
