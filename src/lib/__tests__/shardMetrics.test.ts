import { describe, expect, it } from "vitest";
import { shardIsHealthy, shardNeedsRollover } from "../sync/shardMetrics";

describe("shard metrics", () => {
  it("triggers rollover on item, byte, or replay thresholds", () => {
    expect(shardNeedsRollover({ itemCount: 10, encodedBytes: 1, replayMs: 1, lastHeartbeatAt: 0 }, { maxItems: 10, maxEncodedBytes: 100, maxReplayMs: 100 })).toBe(true);
    expect(shardNeedsRollover({ itemCount: 1, encodedBytes: 101, replayMs: 1, lastHeartbeatAt: 0 }, { maxItems: 10, maxEncodedBytes: 100, maxReplayMs: 100 })).toBe(true);
  });

  it("detects stale shard heartbeats", () => {
    expect(shardIsHealthy({ itemCount: 0, encodedBytes: 0, replayMs: 0, lastHeartbeatAt: 95 }, 100, 10)).toBe(true);
    expect(shardIsHealthy({ itemCount: 0, encodedBytes: 0, replayMs: 0, lastHeartbeatAt: 80 }, 100, 10)).toBe(false);
  });
});
