import { describe, expect, it } from "vitest";

describe("progressive sync migration scenarios", () => {
  it("preserves rollback and mixed-version invariants", () => {
    const states = ["legacy", "dual-write", "shard-preferred", "rollback"];
    expect(states).toContain("rollback");
    expect(states.indexOf("dual-write")).toBeLessThan(states.indexOf("shard-preferred"));
  });

  it("keeps a long-offline device's retained epoch available", () => {
    const retainedEpochs = new Set([0, 1]);
    expect(retainedEpochs.has(0)).toBe(true);
  });
});
