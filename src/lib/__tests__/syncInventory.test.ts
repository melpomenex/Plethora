import { describe, expect, it } from "vitest";
import { buildSyncInventory } from "../sync/syncInventory";

describe("sync inventory", () => {
  it("records the source and rationale for every registered domain", () => {
    const inventory = buildSyncInventory();
    expect(inventory.length).toBeGreaterThan(10);
    expect(inventory.every((entry) => entry.source && entry.classification && entry.rationale)).toBe(true);
  });
});
