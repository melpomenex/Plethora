import { describe, expect, it } from "vitest";
import { fractionalBetween, sortSyncOrder } from "../sync/fractionalOrder";

describe("deterministic fractional ordering", () => {
  it("creates a position between neighbors", () => {
    const position = fractionalBetween("A", "C");
    expect("A" < position && position < "C").toBe(true);
  });

  it("uses stable device/id tie-breakers", () => {
    const result = sortSyncOrder([
      { id: "b", position: "M", deviceId: "B" },
      { id: "a", position: "M", deviceId: "A" },
    ]);
    expect(result.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
