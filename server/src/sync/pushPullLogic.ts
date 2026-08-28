export const SYNC_PROTOCOL_VERSION = '1';

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

export function paginatePull<T extends { seqNumber: number }>(
  rows: T[],
  cursor: number,
  limit: number
): { records: T[]; cursor: number; hasMore: boolean } {
  const pageLimit = Math.min(500, Math.max(1, limit));
  const filtered = rows.filter((row) => row.seqNumber > cursor);
  const hasMore = filtered.length > pageLimit;
  const records = hasMore ? filtered.slice(0, pageLimit) : filtered;
  const nextCursor = records.length > 0 ? records[records.length - 1].seqNumber : cursor;
  return { records, cursor: nextCursor, hasMore };
}

export function shouldConflict(baseRevision: number | undefined, serverRevision: number): boolean {
  if (baseRevision === undefined) {
    return false;
  }
  return baseRevision < serverRevision;
}

export function nextEntityRevision(current: number | null | undefined): number {
  return Math.max(0, Number(current || 0)) + 1;
}
