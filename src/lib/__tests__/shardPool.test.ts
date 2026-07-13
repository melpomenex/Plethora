import { describe, expect, it, vi } from "vitest";
import { ShardPool } from "../sync/shardPool";

describe("shard pool", () => {
  it("caps open shards and closes evicted handles", async () => {
    const pool = new ShardPool<{ id: string }>(1);
    const closeA = vi.fn();
    await pool.open("a", async () => ({ name: "a", value: { id: "a" }, close: closeA }));
    await pool.open("b", async () => ({ name: "b", value: { id: "b" }, close: vi.fn() }));
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(pool.names()).toEqual(["b"]);
  });
});
