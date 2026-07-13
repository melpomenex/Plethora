import { describe, expect, it } from "vitest";
import { canCompactEpoch, compactionEnabled } from "../sync/compaction";

describe("sync compaction gate", () => {
  it("stays disabled until the rollout flag is enabled", () => {
    expect(compactionEnabled()).toBe(false);
    expect(canCompactEpoch({ createdAt: 0, acknowledgedDevices: ["a"], activeDevices: ["a"], minimumRetentionMs: 0 })).toBe(false);
  });
});
