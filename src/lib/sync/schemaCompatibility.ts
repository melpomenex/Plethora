export interface SyncRecordEnvelope {
  schemaVersion: number;
  domain: string;
  payload: Record<string, unknown>;
}

/**
 * Older clients project known fields while retaining additive unknown fields
 * for a future re-publish. This prevents a mixed-version device from
 * destructively stripping newer UX state.
 */
export function preserveUnknownFields(
  incoming: SyncRecordEnvelope,
  knownFields: string[],
  currentSchemaVersion: number,
): SyncRecordEnvelope {
  if (incoming.schemaVersion <= currentSchemaVersion) return incoming;
  const known = new Set(knownFields);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming.payload)) {
    if (known.has(key) || key.startsWith("__")) payload[key] = value;
    else payload[`__unknown:${key}`] = value;
  }
  return { ...incoming, payload };
}

export function supportsSyncDomain(domain: string, supportedDomains: string[]): boolean {
  return supportedDomains.includes(domain);
}
