export interface DomainCutover {
  domain: string;
  schemaVersion: number;
  shardEpoch: number;
  parityHash: string;
  verifiedAt: string;
  legacyFallbackUntil: string;
}

export function canPreferShard(marker: DomainCutover, now = Date.now()): boolean {
  return marker.schemaVersion > 0 && Boolean(marker.parityHash) && now <= Date.parse(marker.legacyFallbackUntil);
}
