import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncBlobKey, syncBlobOffloadThreshold } from '../sync/blobStorage.js';

vi.mock('../storage/index.js', () => ({
  getStorage: () => ({
    putObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn().mockResolvedValue(Buffer.from('large-payload')),
    getSignedDownloadUrl: vi.fn(),
    getSignedUploadUrl: vi.fn(),
    deleteObject: vi.fn(),
  }),
}));

describe('sync blob offload', () => {
  beforeEach(() => {
    delete process.env.SYNC_BLOB_OFFLOAD_BYTES;
  });

  it('uses 64KiB default threshold', () => {
    expect(syncBlobOffloadThreshold()).toBe(65536);
  });

  it('builds deterministic storage keys', () => {
    expect(syncBlobKey('user-1', 'rec-1')).toBe('sync/user-1/rec-1.bin');
  });

  it('offloads large payloads', async () => {
    const { maybeOffloadSyncPayload } = await import('../sync/blobStorage.js');
    const big = 'x'.repeat(100_000);
    const result = await maybeOffloadSyncPayload('u1', 'r1', big);
    expect(result.blobStorageKey).toBe('sync/u1/r1.bin');
    expect(result.payloadCiphertext).toBe('');
  });

  it('keeps small payloads inline', async () => {
    const { maybeOffloadSyncPayload } = await import('../sync/blobStorage.js');
    const small = 'small';
    const result = await maybeOffloadSyncPayload('u1', 'r1', small);
    expect(result.blobStorageKey).toBeNull();
    expect(result.payloadCiphertext).toBe('small');
  });
});
