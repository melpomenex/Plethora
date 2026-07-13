import { describe, expect, it } from "vitest";
import { createShardSnapshot, verifyShardSnapshot } from "../sync/shardSnapshot";

describe("shard snapshots", () => {
  it("hashes and verifies records plus tombstone frontier", async () => {
    const snapshot = await createShardSnapshot({
      schemaVersion: 1, domain: "cards", shard: "cards:01:0", epoch: 0,
      records: [{ id: "1" }], tombstoneFrontier: "1700000000000.000001",
    });
    expect(await verifyShardSnapshot(snapshot)).toBe(true);
    expect(await verifyShardSnapshot({ ...snapshot, records: [{ id: "tampered" }] })).toBe(false);
  });
});
