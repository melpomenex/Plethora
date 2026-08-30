export const SYNC_PROTOCOL_VERSION = '1';

export const SYNC_TABLE_KINDS = [
  'learning_items', 'learning_item',
  'review_results', 'review_result',
  'documents', 'document',
  'extracts', 'extract',
  'collections', 'collection',
  'tags', 'tag',
  'settings', 'setting',
  'image_assets', 'image_asset',
  'tombstones', 'tombstone',
] as const;

export const SYNC_OPERATIONS = ['create', 'update', 'delete', 'append_event'] as const;

export const SYNC_HLC_PATTERN = /^(?:0|[1-9]\d{0,18}):(?:0|[1-9]\d{0,18})$/;

export function assertSyncProtocolVersion(headerValue: string | string[] | undefined): void {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const version = (raw || SYNC_PROTOCOL_VERSION).trim();
  if (version !== SYNC_PROTOCOL_VERSION) {
    const error = new Error(`Unsupported sync protocol version: ${version}`);
    (error as Error & { statusCode: number; code: string }).statusCode = 400;
    (error as Error & { code: string }).code = 'unsupported_sync_protocol';
    throw error;
  }
}

export function paginatePull<T extends { seqNumber: number | string }>(
  rows: T[],
  cursor: number,
  limit: number
): { records: T[]; cursor: number; hasMore: boolean } {
  const pageLimit = Math.min(500, Math.max(1, limit));
  const filtered = rows.filter((row) => Number(row.seqNumber) > cursor);
  const hasMore = filtered.length > pageLimit;
  const records = hasMore ? filtered.slice(0, pageLimit) : filtered;
  const nextCursor = records.length > 0 ? Number(records[records.length - 1].seqNumber) : cursor;
  return { records, cursor: nextCursor, hasMore };
}

/**
 * node-postgres returns BIGINT (int8) columns as JavaScript strings because
 * they can exceed Number.MAX_SAFE_INTEGER. The sync wire contract requires
 * integer JSON numbers (the Rust client deserializes seqNumber/baseRevision/
 * entityRevision/cursor as u64/i64), so normalize every int8-backed field on
 * the way out. Realistic seq numbers stay far below 2^53, so the narrowing is
 * lossless.
 */
export function normalizeSyncPullRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    seqNumber: Number(row.seqNumber ?? 0),
    baseRevision: row.baseRevision == null ? null : Number(row.baseRevision),
    entityRevision: row.entityRevision == null ? null : Number(row.entityRevision),
  };
}

export function shouldConflict(baseRevision: number | undefined, serverRevision: number): boolean {
  if (baseRevision === undefined) {
    return false;
  }
  return baseRevision !== serverRevision;
}

export function nextEntityRevision(current: number | null | undefined): number {
  return Math.max(0, Number(current || 0)) + 1;
}

export const TOMBSTONE_RETENTION_DAYS = 90;
export const MAX_SYNC_DEVICES = 10;

export function assertDeviceAllowed(
  knownDeviceIds: string[],
  incomingDeviceId: string
): void {
  if (knownDeviceIds.includes(incomingDeviceId)) {
    return;
  }
  if (knownDeviceIds.length >= MAX_SYNC_DEVICES) {
    const error = new Error(`Device limit reached (${MAX_SYNC_DEVICES})`);
    (error as Error & { statusCode: number; code: string }).statusCode = 403;
    (error as Error & { code: string }).code = 'device_limit_reached';
    throw error;
  }
}

export function assertSyncEpoch(recordEpoch: number, accountEpoch: number): void {
  if (recordEpoch !== accountEpoch) {
    const error = new Error(`Invalid sync key epoch ${recordEpoch} (account ${accountEpoch})`);
    (error as Error & { statusCode: number; code: string }).statusCode = 403;
    (error as Error & { code: string }).code = 'stale_key_epoch';
    throw error;
  }
}

export function minDeviceCursorSeq(
  rows: Array<{ last_seq?: number | string | null }>
): number {
  if (rows.length === 0) {
    return 0;
  }
  return Math.min(...rows.map((row) => Number(row.last_seq ?? 0)));
}
