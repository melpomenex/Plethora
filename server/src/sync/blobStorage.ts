import { getStorage } from '../storage/index.js';

const DEFAULT_THRESHOLD = 64 * 1024; // 64 KiB

export function syncBlobOffloadThreshold(): number {
  const raw = process.env.SYNC_BLOB_OFFLOAD_BYTES;
  if (!raw) return DEFAULT_THRESHOLD;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}

export function syncBlobKey(userId: string, recordId: string): string {
  return `sync/${userId}/${recordId}.bin`;
}

export async function maybeOffloadSyncPayload(
  userId: string,
  recordId: string,
  payloadCiphertext: string
): Promise<{ payloadCiphertext: string; blobStorageKey: string | null }> {
  const threshold = syncBlobOffloadThreshold();
  const byteLen = Buffer.byteLength(payloadCiphertext, 'utf8');
  if (byteLen <= threshold) {
    return { payloadCiphertext, blobStorageKey: null };
  }

  const key = syncBlobKey(userId, recordId);
  const storage = getStorage();
  await storage.putObject(key, Buffer.from(payloadCiphertext, 'utf8'), 'application/octet-stream');
  return { payloadCiphertext: '', blobStorageKey: key };
}

export async function hydrateSyncPayload(
  payloadCiphertext: string,
  blobStorageKey: string | null
): Promise<string> {
  if (!blobStorageKey) return payloadCiphertext;
  const storage = getStorage();
  const buf = await storage.getObject(blobStorageKey);
  return buf.toString('utf8');
}
