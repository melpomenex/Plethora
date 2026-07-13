import { describe, expect, it, beforeEach } from "vitest";
import { getSyncFeatureFlags, __resetSyncFeatureFlagsForTest } from "../sync/featureFlags";

describe("sync feature flags", () => {
  beforeEach(() => {
    __resetSyncFeatureFlagsForTest();
  });

  it("keeps persistence-changing rollouts disabled by default", () => {
    const flags = getSyncFeatureFlags();
    expect(flags.progressiveScheduling).toBe(true);
    expect(flags.journaledProjection).toBe(false);
    expect(flags.shardedRooms).toBe(false);
    expect(flags.dualWriteMigration).toBe(false);
    expect(flags.compaction).toBe(false);
  });

  it("accepts a local JSON override for controlled rollout testing", () => {
    localStorage.setItem("incrementum.sync.feature-flags", JSON.stringify({ shardedRooms: true }));
    expect(getSyncFeatureFlags().shardedRooms).toBe(true);
  });
});
