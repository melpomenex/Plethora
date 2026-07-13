import { getSyncFeatureFlags } from "./featureFlags";
import { canRetireShard, type RetentionState } from "./shardRetention";

export function compactionEnabled(): boolean {
  return getSyncFeatureFlags().compaction;
}

export function canCompactEpoch(retention: RetentionState): boolean {
  return compactionEnabled() && canRetireShard(retention);
}
