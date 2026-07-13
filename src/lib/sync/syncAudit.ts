import { snapshotHash } from "./shardSnapshot";

export interface AuditResult {
  domain: string;
  recordCount: number;
  projectionHash: string;
  duplicateIds: string[];
  invalidTombstones: string[];
  ok: boolean;
}

export async function auditSyncRecords(domain: string, records: Array<Record<string, unknown>>): Promise<AuditResult> {
  const ids = new Set<string>();
  const duplicateIds: string[] = [];
  const invalidTombstones: string[] = [];
  for (const record of records) {
    const id = String(record.id ?? "");
    if (ids.has(id)) duplicateIds.push(id);
    ids.add(id);
    if (record._deleted === true && typeof record.deletedAt !== "string") invalidTombstones.push(id);
  }
  const projectionHash = await snapshotHash(records);
  return {
    domain,
    recordCount: records.length,
    projectionHash,
    duplicateIds,
    invalidTombstones,
    ok: duplicateIds.length === 0 && invalidTombstones.length === 0,
  };
}
