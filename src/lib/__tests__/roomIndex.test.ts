import { describe, expect, it } from "vitest";
import { epochShardName, hashBucket, isValidRoomIndex, shardName } from "../sync/roomIndex";

describe("sync room index", () => {
  it("creates stable bounded hash and epoch shard names", () => {
    expect(hashBucket("card-1", 16)).toBe(hashBucket("card-1", 16));
    expect(shardName("learningItems", "card-1", 2)).toMatch(/^learningItems:\d{2}:2$/);
    expect(epochShardName("reviews", 4)).toBe("reviews:epoch:4");
  });

  it("validates an index without requiring payload plaintext", () => {
    expect(isValidRoomIndex({
      schemaVersion: 1, room: "room-a", generatedAt: "now", capabilities: [], migration: {},
      shards: [{ domain: "reviews", shard: "reviews:epoch:0", epoch: 0, lane: "P0", snapshotHash: null, itemCount: 0, encodedBytes: 0, acknowledgedDevices: [] }],
    })).toBe(true);
  });
});
