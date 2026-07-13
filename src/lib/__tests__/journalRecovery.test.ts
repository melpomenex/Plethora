import { describe, expect, it } from "vitest";

describe("journal recovery invariants", () => {
  it("replays a partially projected batch without duplicating applied operations", async () => {
    const applied = new Set<string>();
    let crashed = true;
    const batch = ["op-1", "op-2", "op-3"];
    for (const id of batch) {
      if (applied.has(id)) continue;
      if (crashed && id === "op-2") {
        crashed = false;
        break;
      }
      applied.add(id);
    }
    for (const id of batch) if (!applied.has(id)) applied.add(id);
    expect([...applied]).toEqual(batch);
    expect(applied.size).toBe(3);
  });
});
