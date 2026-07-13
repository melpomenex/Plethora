import { describe, expect, it } from "vitest";
import { convergeChaosOperations } from "../sync/chaosHarness";

describe("sync chaos convergence", () => {
  it("converges duplicate, reordered, delete/recreate operations deterministically", () => {
    const ops = [
      { id: "a1", key: "card", value: { due: 1 }, clock: "1" },
      { id: "delete", key: "card", value: null, deleted: true, clock: "2" },
      { id: "stale", key: "card", value: { due: 0 }, clock: "1.5" },
      { id: "recreate", key: "card", value: { due: 3 }, clock: "3" },
    ];
    const merged = convergeChaosOperations(ops);
    expect(merged.get("card")?.id).toBe("recreate");
    expect(convergeChaosOperations(ops.slice().reverse()).get("card")?.id).toBe("recreate");
  });
});
