export interface ShardMetrics {
  itemCount: number;
  encodedBytes: number;
  replayMs: number;
  peakMemoryBytes?: number;
  lastHeartbeatAt: number;
}

export interface ShardThresholds {
  maxItems: number;
  maxEncodedBytes: number;
  maxReplayMs: number;
}

export function shardNeedsRollover(metrics: ShardMetrics, thresholds: ShardThresholds): boolean {
  return metrics.itemCount >= thresholds.maxItems ||
    metrics.encodedBytes >= thresholds.maxEncodedBytes ||
    metrics.replayMs >= thresholds.maxReplayMs;
}

export function shardIsHealthy(metrics: ShardMetrics, now = Date.now(), heartbeatTimeoutMs = 30_000): boolean {
  return now - metrics.lastHeartbeatAt <= heartbeatTimeoutMs;
}
