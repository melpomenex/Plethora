import { describe, expect, it } from "vitest";
import { canRetireShard } from "../sync/shardRetention";

describe("shard retention", () => {
  it("keeps history until active devices acknowledge it and retention passes", () => {
    const state = { createdAt: 0, acknowledgedDevices: ["a"], activeDevices: ["a", "b"], minimumRetentionMs: 10 };
    expect(canRetireShard(state, 100)).toBe(false);
    expect(canRetireShard({ ...state, acknowledgedDevices: ["a", "b"] }, 100)).toBe(true);
  });
});
