import { describe, expect, it } from "vitest";
import { canPreferShard } from "../sync/cutover";

describe("domain cutover", () => {
  it("prefers a verified shard during the rollback window", () => {
    expect(canPreferShard({ domain: "cards", schemaVersion: 1, shardEpoch: 0, parityHash: "hash", verifiedAt: "now", legacyFallbackUntil: new Date("2000-01-01").toISOString() }, Date.parse("1999-01-01"))).toBe(true);
  });
});
