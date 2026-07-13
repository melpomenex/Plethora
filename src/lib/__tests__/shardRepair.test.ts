import { describe, expect, it, vi } from "vitest";
import { createShardSnapshot } from "../sync/shardSnapshot";
import { repairShardFromSnapshot } from "../sync/shardRepair";

describe("scoped shard repair", () => {
  it("rebuilds only from a verified snapshot", async () => {
    const snapshot = await createShardSnapshot({ schemaVersion: 1, domain: "rss", shard: "rss:01:0", epoch: 0, records: [{ id: "a" }], tombstoneFrontier: "clock" });
    const replace = vi.fn().mockResolvedValue(undefined);
    expect(await repairShardFromSnapshot({ snapshot, replace })).toEqual({ repaired: true, recordCount: 1 });
    expect(replace).toHaveBeenCalledWith([{ id: "a" }]);
  });
});
